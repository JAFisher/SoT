import fs from "fs";
import path from "path";



/**
 * Parses a flowchart definition string to extract nodes, composition edges,
 * inheritance edges, methods, types, interfaces, main blocks, and EXTERNALS.
 */
function parseFlowchart(definition) {
    const compositionEdges = [];
    const extendsEdges = [];
    const nodes = {};
    const methods = {};
    const types = {};
    const interfaces = {};
    const mainBlocks = [];
    const externals = {}; // NEW: The Toolbox

    const lines = definition
        .split("\n")
        .map((l) => l.trim())
        .filter((l) => l && !/^graph\b/.test(l));

    const nodePattern = /(\w+)\[([^\]{]+)(?:\{([^}]+)\})?\]/;
    const methodPattern = /@(\w+)\.([^\{]+)(?:\{([^}]+)\})?:\s*(.+)/;
    const methodCodeStartPattern = /@{1,2}(\w+)\.([^.]+)\.code/;
    const methodCodeEndPattern = /@{1,2}(\w+)\.([^.]+)\.end/;
    const typePattern = /type->(\w+)\s*\{([^}]+)\}/;
    const interfacePattern = /interface->(\w+)\s*\{([^}]+)\}/;
    const mainCodeStartPattern = /@{1,2}main\.code/;
    const mainCodeEndPattern = /@{1,2}main\.end/;

    // NEW: Regex for external imports: extern->http from 'node:http'
    const externPattern = /extern->(\w+)\s*from\s*['"]([^'"]+)['"]/;

    function addNode(id, file, props) {
        if (!nodes[id]) {
            nodes[id] = { file: file.trim(), props: parseProps(props) };
        } else {
            nodes[id].file = file.trim();
            if (props) nodes[id].props = parseProps(props);
        }
    }

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];

        // Handle Externals
        const externMatch = line.match(externPattern);
        if (externMatch) {
            const [, libName, libPath] = externMatch;
            externals[libName] = libPath;
            continue;
        }

        // Handle Types
        const typeMatch = line.match(typePattern);
        if (typeMatch) {
            const [, typeName, props] = typeMatch;
            types[typeName] = parseProps(props);
            continue;
        }

        // Handle Interfaces
        const interfaceMatch = line.match(interfacePattern);
        if (interfaceMatch) {
            const [, interfaceName, props] = interfaceMatch;
            interfaces[interfaceName] = parseProps(props);
            continue;
        }

        // Handle Inheritance
        const extendsMatch = line.match(new RegExp(`^${nodePattern.source}\\s*---\\|>\\s*${nodePattern.source}\\s*;?$`));
        if (extendsMatch) {
            const [, childId, childFile, childProps, parentId, parentFile, parentProps] = extendsMatch;
            addNode(childId, childFile, childProps);
            addNode(parentId, parentFile, parentProps);
            extendsEdges.push({ childId, parentId });
            continue;
        }

        // Handle Method Signatures
        const methodMatch = line.match(new RegExp(`^${methodPattern.source}`));
        if (methodMatch) {
            const [, className, methodName, params, returnType] = methodMatch;
            if (!methods[className]) methods[className] = {};
            methods[className][methodName] = {
                params: parseProps(params),
                returnType: (returnType || "").trim(),
            };
            continue;
        }

        // Handle Main Code Blocks
        if (line.match(new RegExp(`^${mainCodeStartPattern.source}$`))) {
            let codeBlock = "";
            i++;
            while (i < lines.length && !lines[i].match(new RegExp(`^${mainCodeEndPattern.source}$`))) {
                codeBlock += lines[i] + "\n";
                i++;
            }
            mainBlocks.push(codeBlock.trim());
            continue;
        }

        // Handle Method Code Blocks
        const methodCodeStartMatch = line.match(new RegExp(`^${methodCodeStartPattern.source}$`));
        if (methodCodeStartMatch) {
            const [, className, methodName] = methodCodeStartMatch;
            let codeBlock = "";
            i++;
            while (i < lines.length && !lines[i].match(new RegExp(`^${methodCodeEndPattern.source}$`))) {
                codeBlock += lines[i] + "\n";
                i++;
            }
            if (!methods[className]) methods[className] = {};
            const trimmed = codeBlock.trim();
            if (methodName === "constructor") {
                methods[className].constructor = { code: trimmed };
            } else {
                if (!methods[className][methodName]) {
                    methods[className][methodName] = { params: [], returnType: "any" };
                }
                methods[className][methodName].code = trimmed;
            }
            continue;
        }

        // Handle Composition
        const compositionMatch = line.match(new RegExp(`^${nodePattern.source}(?:\\s*-->\\s*${nodePattern.source})?\\s*;?$`));
        if (compositionMatch) {
            const [, fromId, fromFile, fromProps, toId, toFile, toProps] = compositionMatch;
            addNode(fromId, fromFile, fromProps);
            if (toId && toFile) {
                addNode(toId, toFile, toProps);
                compositionEdges.push([fromId, toId]);
            }
            continue;
        }
    }

    return { nodes, compositionEdges, extendsEdges, methods, types, interfaces, mainBlocks, externals };
}

/** Helper functions: parseProps, indent, stripTs, toPascalCase (identical to your original) **/
function parseProps(propStr) {
    if (!propStr) return [];
    return propStr.split(",").map((p) => p.trim()).filter(Boolean).map((p) => {
        const [name, type] = p.split(":").map((s) => s.trim());
        return { name, type: type || "any" };
    });
}
function indent(code, n = 4) {
    if (!code) return "";
    const pad = " ".repeat(n);
    return code.split("\n").map((line) => (line.length ? pad + line : line)).join("\n");
}
function stripTs(p) { return p.replace(/\.ts$/i, ""); }
function toPascalCase(str) { return str.replace(/[-_](.)/g, (_, c) => c.toUpperCase()).replace(/^\w/, (c) => c.toUpperCase()); }

/**
 * GENERATE FILES
 */
function generateFiles(baseDir, { nodes, compositionEdges, extendsEdges, methods, types, interfaces, mainBlocks, externals }) {
    const classNames = new Set(Object.values(nodes).map((n) => path.basename(n.file, path.extname(n.file))));
    const interfaceNames = new Set(Object.keys(interfaces));
    const typeNames = new Set(Object.keys(types));

    // 1. Types
    for (const [typeName, props] of Object.entries(types)) {
        const fields = props.map((p) => `  ${p.name}: ${p.type};`).join("\n");
        const content = `export type ${typeName} = {\n${fields}\n};`;
        const outPath = path.join(baseDir, `${typeName}.ts`);
        fs.mkdirSync(path.dirname(outPath), { recursive: true });
        fs.writeFileSync(outPath, content, "utf-8");
    }

    // 2. Interfaces
    for (const [interfaceName, props] of Object.entries(interfaces)) {
        const typeOrClassImports = new Set();
        const fields = props.map((p) => {
            const mGeneric = p.type.match(/Array<(\w+)>/);
            const elem = mGeneric ? mGeneric[1] : p.type.replace(/\[\]$/, "");
            if (types[elem] || interfaces[elem] || classNames.has(elem)) typeOrClassImports.add(elem);
            return `  ${p.name}: ${p.type};`;
        }).join("\n");
        const importLines = Array.from(typeOrClassImports).map((name) => `import type { ${name} } from "./${stripTs(name)}";`).join("\n");
        const content = `${importLines ? importLines + "\n\n" : ""}export interface ${interfaceName} {\n${fields}\n}\n`;
        fs.writeFileSync(path.join(baseDir, `${interfaceName}.ts`), content, "utf-8");
    }

    // 3. Classes
    for (const [id, { file: filename, props }] of Object.entries(nodes)) {
        const className = toPascalCase(path.basename(filename, path.extname(filename)));
        const parentRelationship = extendsEdges.find((r) => r.childId === id);
        let extendsClause = "";
        let parentImport = "";
        const customImports = new Set();
        const externalImportLines = new Set(); // NEW: External logic

        if (parentRelationship) {
            const parentId = parentRelationship.parentId;
            const parentFile = nodes[parentId].file;
            const parentClassName = toPascalCase(path.basename(parentFile, path.extname(parentFile)));
            let parentPath = path.relative(path.dirname(filename), parentFile).replace(/\\/g, "/");
            if (!parentPath.startsWith(".")) parentPath = "./" + parentPath;
            extendsClause = ` extends ${parentClassName}`;
            parentImport = `import { ${parentClassName} } from "${stripTs(parentPath)}";`;
        }

        const compositionImports = compositionEdges.filter(([from]) => from === id).map(([_, to]) => {
            const depFile = nodes[to].file;
            const depClass = toPascalCase(path.basename(depFile, path.extname(depFile)));
            let depPath = path.relative(path.dirname(filename), depFile).replace(/\\/g, "/");
            if (!depPath.startsWith(".")) depPath = "./" + depPath;
            return `import { ${depClass} } from "${stripTs(depPath)}";`;
        }).join("\n");

        // Scan methods for both internal AND external dependencies
        if (methods[className]) {
            for (const methodData of Object.values(methods[className])) {
                if (!methodData || !methodData.code) continue;

                // Internal Body Scanning
                const allKnownNames = [...classNames, ...Object.keys(types), ...Object.keys(interfaces)];
                for (const name of allKnownNames) {
                    if (name === className) continue;
                    if (new RegExp(`\\b${name}\\b`).test(methodData.code)) {
                        if (types[name] || interfaces[name]) customImports.add(name);
                        else if (classNames.has(name)) customImports.add("__class__" + name);
                    }
                }

                // External Body Scanning (NEW)
                for (const [libName, libPath] of Object.entries(externals)) {
                    if (new RegExp(`\\b${libName}\\b`).test(methodData.code)) {
                        externalImportLines.add(`import * as ${libName} from "${libPath}";`);
                    }
                }
            }
        }

        const customImportStatements = Array.from(customImports).map((entry) => {
            if (entry.startsWith("__class__")) {
                const name = entry.slice(9);
                let fn = name + ".ts";
                for (const n of Object.values(nodes)) if (toPascalCase(path.basename(n.file, ".ts")) === name) fn = n.file;
                let rp = path.relative(path.dirname(filename), fn).replace(/\\/g, "/");
                if (!rp.startsWith(".")) rp = "./" + rp;
                return `import { ${name} } from "${stripTs(rp)}";`;
            }
            return `import type { ${entry} } from "./${stripTs(entry)}";`;
        }).join("\n");

        const allImports = [...new Set([parentImport, compositionImports, customImportStatements, ...externalImportLines])]
            .filter(Boolean).join("\n");

        // Build the class string (Fields, Ctor, Methods)
        const fields = props.map((p) => `  ${p.name}: ${p.type};`).join("\n");
        let ctorContent = "";
        const hasCustomCtor = methods[className] && methods[className].constructor;
        if (hasCustomCtor) {
            ctorContent = `\n  constructor() {\n${indent(methods[className].constructor.code, 4)}\n  }\n`;
        } else if (props.length > 0) {
            ctorContent = `\n  constructor(${props.map(p => `${p.name}: ${p.type}`).join(', ')}) {\n${indent(parentRelationship ? 'super();\n' : '', 4)}${indent(props.map(p => `this.${p.name} = ${p.name};`).join('\n'), 4)}\n  }\n`;
        }

        const methodsContent = Object.entries(methods[className] || {})
            .filter(([name]) => name !== "constructor")
            .map(([mName, mData]) => `\n  public ${mName}(${(mData.params || []).map(p => `${p.name}: ${p.type}`).join(', ')}): ${mData.returnType || 'any'} {\n${indent(mData.code || '', 4)}\n  }`).join("");

        const content = `${allImports ? allImports + "\n\n" : ""}export class ${className}${extendsClause} {\n${fields}${ctorContent}${methodsContent}\n}`;
        fs.writeFileSync(path.join(baseDir, filename), content.trimStart(), "utf-8");
        // === 5. Package.json Generator ===
        // === 5. Package.json Generator ===
        const pkgPath = path.join(baseDir, "package.json");
        const dependencies = {};

        // Debugging: console.log("Current Externals:", externals);

        for (const [libName, libPath] of Object.entries(externals)) {
            // 1. Remove any 'node:' prefix to check if it's a built-in
            const cleanPath = libPath.replace(/^node:/, "");

            // 2. List of standard Node built-ins to ignore
            const builtIns = ["http", "https", "fs", "path", "os", "readline", "crypto", "events", "util", "buffer", "child_process"];

            // 3. If it's NOT a built-in and NOT a relative local file path, it's an NPM package
            if (!builtIns.includes(cleanPath) && !libPath.startsWith(".") && !libPath.startsWith("/")) {
                // Use the libPath as the package name (e.g., 'commander' or 'chalk')
                dependencies[cleanPath] = "latest";
            }
        }

        const packageJson = {
            name: "sot-generated-project",
            version: "1.0.0",
            main: "main.ts",
            scripts: {
                "build": "tsc main.ts --outDir dist",
                "start": "node dist/main.js"
            },
            dependencies: dependencies, // Should now have 'commander', etc.
            devDependencies: {
                "ts-node": "^10.9.1",
                "typescript": "^5.0.0",
                "@types/node": "^20.0.0"
            }
        };

        fs.writeFileSync(pkgPath, JSON.stringify(packageJson, null, 2), "utf-8");

        // === 6. .gitignore Generator ===
        const gitignoreContent = `
node_modules/
dist/
*.log
.DS_Store
`.trim();
        fs.writeFileSync(path.join(baseDir, ".gitignore"), gitignoreContent, "utf-8");

        // === 7. README.md Generator ===
        const readmeContent = `
# SoT Generated Project

This project was automatically generated using the **Single Oriented Transformation (SoT)** engine.

## Quick Start

1. **Install Dependencies:**
   \`\`\`bash
   npm install
   \`\`\`

2. **Run the Project:**
   \`\`\`bash
   npm start
   \`\`\`

## System Overview
- **Entry Point:** \`main.ts\`
- **Architecture:** Managed via Mermaid-to-TypeScript DSL.
- **Dependencies:** ${Object.keys(dependencies).join(', ') || 'None'}

---
*Generated by the SoT Partner Engine.*
`.trim();
        fs.writeFileSync(path.join(baseDir, "README.md"), readmeContent, "utf-8");

        console.log("🏁 Project fully hydrated with .gitignore and README.md");
    }

    // 4. Main.ts
    if (mainBlocks.length > 0) {
        const mainContent = mainBlocks.join("\n\n");
        const mainImports = new Set();
        // Scan main for classes/types
        for (const name of [...classNames, ...interfaceNames, ...typeNames]) {
            if (new RegExp(`\\b${name}\\b`).test(mainContent)) {
                let fn = name + ".ts";
                for (const n of Object.values(nodes)) if (path.basename(n.file, ".ts") === name) fn = n.file;
                let rp = fn.startsWith(".") ? fn : "./" + fn;
                mainImports.add(`import ${interfaceNames.has(name) || typeNames.has(name) ? 'type ' : ''}{ ${name} } from "${stripTs(rp)}";`);
            }
        }
        // Scan main for Externals
        for (const [libName, libPath] of Object.entries(externals)) {
            if (new RegExp(`\\b${libName}\\b`).test(mainContent)) {
                mainImports.add(`import * as ${libName} from "${libPath}";`);
            }
        }
        fs.writeFileSync(path.join(baseDir, "main.ts"), `${Array.from(mainImports).join("\n")}\n\n${mainContent}\n`, "utf-8");
    }


}

export function generateFromFlowchart(definition, outDir = "./out") {
    const parsed = parseFlowchart(definition);
    generateFiles(outDir, parsed);
}