import fs from "fs";
import path from "path";



/**
 * Parses a flowchart definition string to extract nodes, composition edges,
 * inheritance edges, methods, types, interfaces, main blocks, and EXTERNALS.
 */
/**
 * Parses a flowchart definition string to extract nodes, composition edges,
 * inheritance edges, methods, types, interfaces, main blocks, and EXTERNALS.
 * Supports recursive includes via include->filename.flow
 */
function parseFlowchart(definition) {
    const compositionEdges = [];
    const extendsEdges = [];
    const nodes = {};
    const methods = {};
    const types = {};
    const interfaces = {};
    const mainBlocks = [];
    const externals = {};
    const processedFiles = new Set();

    const nodePattern = /(\w+)\[([^\]{]+)(?:\{([^}]+)\})?\]/;
    const methodPattern = /(@async\s+)?@(\w+)\.([^\{]+)(?:\{([^}]+)\})?:\s*(.+)/;
    const methodCodeStartPattern = /(@async\s+)?@{1,2}([\w.]+)\.code/;
    const methodCodeEndPattern = /@{1,2}([\w.]+)\.end/;
    const typePattern = /type->(\w+)\s*\{([^}]+)\}/;
    const interfacePattern = /interface->(\w+)\s*\{([^}]+)\}/;
    const mainCodeStartPattern = /(@async\s+)?@{1,2}main\.code/;
    const mainCodeEndPattern = /@{1,2}main\.end/;
    const externPattern = /extern->(\w+)\s*from\s*['"]([^'"]+)['"]/;
    const includePattern = /include->([^ \n]+)/;

    function addNode(id, file, props, namespace) {
        if (!nodes[id]) {
            nodes[id] = { file: file.trim(), props: parseProps(props), namespace };
        } else {
            nodes[id].file = file.trim();
            if (props) nodes[id].props = parseProps(props);
            nodes[id].namespace = namespace;
        }
    }

    function parseWorker(lines, currentDir, namespace) {
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];

            // 1. Includes
            const includeMatch = line.match(includePattern);
            if (includeMatch) {
                const includeFile = includeMatch[1];
                const fullPath = path.resolve(currentDir, includeFile);
                if (processedFiles.has(fullPath)) continue;
                processedFiles.add(fullPath);

                if (fs.existsSync(fullPath)) {
                    const content = fs.readFileSync(fullPath, "utf-8");
                    const subLines = content.split("\n").map(l => l.trim()).filter(l => l && !/^graph\b/.test(l));
                    // Namespace is the relative path from the flows root or just the filename
                    const subNamespace = path.join(namespace, path.dirname(includeFile), path.basename(includeFile, ".flow")).replace(/\\/g, "/").replace(/^\.\//, "");
                    parseWorker(subLines, path.dirname(fullPath), subNamespace);
                } else {
                    console.warn(`⚠️  Include not found: ${fullPath}`);
                }
                continue;
            }

            // 2. Externals
            const externMatch = line.match(externPattern);
            if (externMatch) {
                const [, libName, libPath] = externMatch;
                externals[libName] = libPath;
                continue;
            }

            // 3. Types
            const typeMatch = line.match(typePattern);
            if (typeMatch) {
                const [, typeName, props] = typeMatch;
                types[typeName] = { props: parseProps(props), namespace };
                continue;
            }

            // 4. Interfaces
            const interfaceMatch = line.match(interfacePattern);
            if (interfaceMatch) {
                const [, interfaceName, props] = interfaceMatch;
                interfaces[interfaceName] = { props: parseProps(props), namespace };
                continue;
            }

            // 5. Inheritance
            const extendsMatch = line.match(new RegExp(`^${nodePattern.source}\\s*---\\|>\\s*${nodePattern.source}\\s*;?$`));
            if (extendsMatch) {
                const [, childId, childFile, childProps, parentId, parentFile, parentProps] = extendsMatch;
                addNode(childId, childFile, childProps, namespace);
                addNode(parentId, parentFile, parentProps, namespace);
                extendsEdges.push({ childId, parentId });
                continue;
            }

            // 6. Method Signatures
            const methodMatch = line.match(new RegExp(`^${methodPattern.source}`));
            if (methodMatch) {
                const [, asyncFlag, className, methodName, params, returnType] = methodMatch;
                if (!methods[className]) methods[className] = {};
                methods[className][methodName] = {
                    async: !!asyncFlag,
                    params: parseProps(params),
                    returnType: (returnType || "").trim(),
                };
                continue;
            }

            // 7. Main Code Blocks
            const mainMatch = line.match(new RegExp(`^${mainCodeStartPattern.source}$`));
            if (mainMatch) {
                const [, asyncFlag] = mainMatch;
                let codeBlock = "";
                i++;
                while (i < lines.length && !lines[i].match(new RegExp(`^${mainCodeEndPattern.source}$`))) {
                    codeBlock += lines[i] + "\n";
                    i++;
                }
                mainBlocks.push({ async: !!asyncFlag, code: codeBlock.trim() });
                continue;
            }

            // 8. Method Code Blocks
            const methodCodeStartMatch = line.match(new RegExp(`^${methodCodeStartPattern.source}$`));
            if (methodCodeStartMatch) {
                const [, asyncFlag, targetFull] = methodCodeStartMatch;
                const parts = targetFull.split('.');
                const methodName = parts.pop();
                const className = parts.join('.').replace(/^@+/, "");

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
                    if (asyncFlag) methods[className][methodName].async = true;
                }
                continue;
            }

            // 9. Composition
            const compositionMatch = line.match(new RegExp(`^${nodePattern.source}(?:\\s*-->\\s*${nodePattern.source})?\\s*;?$`));
            if (compositionMatch) {
                const [, fromId, fromFile, findProps, toId, toFile, toProps] = compositionMatch;
                addNode(fromId, fromFile, findProps, namespace);
                if (toId && toFile) {
                    addNode(toId, toFile, toProps, namespace);
                    compositionEdges.push([fromId, toId]);
                }
                continue;
            }
        }
    }

    const rootLines = definition.split("\n").map(l => l.trim()).filter(l => l && !/^graph\b/.test(l));
    parseWorker(rootLines, "./flows", "");

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
    const classNames = new Set(Object.values(nodes).map((n) => toPascalCase(path.basename(n.file, path.extname(n.file)))));
    const interfaceNames = new Set(Object.keys(interfaces));
    const typeNames = new Set(Object.keys(types));

    function getRelativeImport(fromNamespace, toNamespace, filename) {
        const fromDir = path.join(baseDir, fromNamespace);
        const toDir = path.join(baseDir, toNamespace);
        let rel = path.relative(fromDir, path.join(toDir, stripTs(filename))).replace(/\\/g, "/");
        if (!rel.startsWith(".")) rel = "./" + rel;
        return rel;
    }

    // 1. Types
    for (const [typeName, { props, namespace }] of Object.entries(types)) {
        const fields = props.map((p) => `  ${p.name}: ${p.type};`).join("\n");
        const content = `export type ${typeName} = {\n${fields}\n};`;
        const outPath = path.join(baseDir, namespace, `${typeName}.ts`);
        fs.mkdirSync(path.dirname(outPath), { recursive: true });
        fs.writeFileSync(outPath, content, "utf-8");
    }

    // 2. Interfaces
    for (const [interfaceName, { props, namespace }] of Object.entries(interfaces)) {
        const typeOrClassImports = new Set();
        const fields = props.map((p) => {
            const mGeneric = p.type.match(/Array<(\w+)>/);
            const elem = mGeneric ? mGeneric[1] : p.type.replace(/\[\]$/, "");
            if (types[elem] || interfaces[elem] || classNames.has(elem)) typeOrClassImports.add(elem);
            return `  ${p.name}: ${p.type};`;
        }).join("\n");

        const importLines = Array.from(typeOrClassImports).map((name) => {
            const target = types[name] || interfaces[name] || Object.values(nodes).find(n => toPascalCase(path.basename(n.file, ".ts")) === name);
            const targetNamespace = target.namespace || "";
            const targetFile = target.file || (name + ".ts");
            const relPath = getRelativeImport(namespace, targetNamespace, targetFile);
            return `import type { ${name} } from "${relPath}";`;
        }).join("\n");

        const content = `${importLines ? importLines + "\n\n" : ""}export interface ${interfaceName} {\n${fields}\n}\n`;
        const outPath = path.join(baseDir, namespace, `${interfaceName}.ts`);
        fs.mkdirSync(path.dirname(outPath), { recursive: true });
        fs.writeFileSync(outPath, content, "utf-8");
    }

    // 3. Classes
    for (const [id, { file: filename, props, namespace }] of Object.entries(nodes)) {

        const className = toPascalCase(path.basename(filename, path.extname(filename)));
        const parentRelationship = extendsEdges.find((r) => r.childId === id);
        let extendsClause = "";
        let parentImport = "";
        const customImports = new Set();
        const externalImportLines = new Set();

        if (parentRelationship) {
            const parentId = parentRelationship.parentId;
            const parent = nodes[parentId];
            const parentClassName = toPascalCase(path.basename(parent.file, path.extname(parent.file)));
            const relPath = getRelativeImport(namespace, parent.namespace, parent.file);
            extendsClause = ` extends ${parentClassName}`;
            parentImport = `import { ${parentClassName} } from "${relPath}";`;
        }

        const compositionImports = compositionEdges.filter(([from]) => from === id).map(([_, to]) => {
            const dep = nodes[to];
            const depClass = toPascalCase(path.basename(dep.file, path.extname(dep.file)));
            const relPath = getRelativeImport(namespace, dep.namespace, dep.file);
            return `import { ${depClass} } from "${relPath}";`;
        });

        for (const p of props) {
            for (const ref of extractReferencedTypes(p.type)) {
                if ((types[ref] || interfaces[ref]) && !classNames.has(ref)) {
                    customImports.add(ref);
                }
            }
        }

        if (methods[className]) {
            for (const methodData of Object.values(methods[className])) {
                if (!methodData || !methodData.code) continue;
                const allKnownNames = [...classNames, ...Object.keys(types), ...Object.keys(interfaces)];
                for (const name of allKnownNames) {
                    if (name === className) continue;
                    if (new RegExp(`\\b${name}\\b`).test(methodData.code)) {
                        if (types[name] || interfaces[name]) customImports.add(name);
                        else if (classNames.has(name)) customImports.add("__class__" + name);
                    }
                }
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
                const target = Object.values(nodes).find(n => toPascalCase(path.basename(n.file, ".ts")) === name);
                const relPath = getRelativeImport(namespace, target.namespace, target.file);
                return `import { ${name} } from "${relPath}";`;
            }
            const target = types[entry] || interfaces[entry];
            const relPath = getRelativeImport(namespace, target.namespace, entry + ".ts");
            return `import type { ${entry} } from "${relPath}";`;
        });

        const allImports = [...new Set([parentImport, ...compositionImports, ...customImportStatements, ...externalImportLines])]
            .filter(Boolean);

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
            .map(([mName, mData]) => `\n  public ${mData.async ? 'async ' : ''}${mName}(${(mData.params || []).map(p => `${p.name}: ${p.type}`).join(', ')}): ${mData.returnType || 'any'} {\n${indent(mData.code || '', 4)}\n  }`).join("");

        const content = `${allImports.join("\n")}${allImports.length ? "\n\n" : ""}export class ${className}${extendsClause} {\n${fields}${ctorContent}${methodsContent}\n}`;
        const outPath = path.join(baseDir, namespace, filename);
        fs.mkdirSync(path.dirname(outPath), { recursive: true });
        fs.writeFileSync(outPath, content.trimStart(), "utf-8");
        console.log("🏁 Class generated: " + className + " in " + (namespace || "root"));
    }

    // === 5. Package.json Generator ===
    const pkgPath = path.join(baseDir, "package.json");
    const dependencies = {};
    for (const [libName, libPath] of Object.entries(externals)) {
        const cleanPath = libPath.replace(/^node:/, "");
        const builtIns = ["http", "https", "fs", "path", "os", "readline", "crypto", "events", "util", "buffer", "child_process"];
        if (!builtIns.includes(cleanPath) && !libPath.startsWith(".") && !libPath.startsWith("/")) {
            dependencies[cleanPath] = "latest";
        }
    }

    const packageJson = {
        name: "sot-generated-project",
        version: "1.0.0",
        main: "main.ts",
        scripts: { "build": "tsc main.ts --outDir dist", "start": "node dist/main.js" },
        dependencies: dependencies,
        devDependencies: { "ts-node": "^10.9.1", "typescript": "^5.0.0", "@types/node": "^20.0.0" }
    };
    fs.writeFileSync(pkgPath, JSON.stringify(packageJson, null, 2), "utf-8");

    // === 6. .gitignore & README ===
    fs.writeFileSync(path.join(baseDir, ".gitignore"), "node_modules/\ndist/\n*.log\n.DS_Store\n", "utf-8");
    fs.writeFileSync(path.join(baseDir, "README.md"), "# SoT Generated Project\n\nGenerated by the SoT Partner Engine.\n", "utf-8");

    // === 4. Main.ts ===
    if (mainBlocks.length > 0) {
        const mainContent = mainBlocks.map(b => b.async ? `(async () => {\n${indent(b.code)}\n})();` : b.code).join("\n\n");
        const mainImports = new Set();
        const fullMainCode = mainBlocks.map(b => b.code).join("\n");

        // Use a map to track name collisions for aliasing
        const nameToComponent = new Map();

        for (const name of [...classNames, ...interfaceNames, ...typeNames]) {
            if (new RegExp(`\\b${name}\\b`).test(fullMainCode)) {
                const target = types[name] || interfaces[name] || Object.values(nodes).find(n => toPascalCase(path.basename(n.file, ".ts")) === name);
                const relPath = getRelativeImport("", target.namespace, target.file || (name + ".ts"));
                mainImports.add(`import ${interfaceNames.has(name) || typeNames.has(name) ? 'type ' : ''}{ ${name} } from "${relPath}";`);
            }
        }
        for (const [libName, libPath] of Object.entries(externals)) {
            if (new RegExp(`\\b${libName}\\b`).test(fullMainCode)) {
                mainImports.add(`import * as ${libName} from "${libPath}";`);
            }
        }
        fs.writeFileSync(path.join(baseDir, "main.ts"), `${Array.from(mainImports).sort().join("\n")}\n\n${mainContent}\n`, "utf-8");
    }
}

function extractReferencedTypes(typeStr) {
    if (!typeStr) return [];
    // Match Array<Foo>, Foo[], Foo, etc.
    const matches = [];
    // Array<Foo>
    const genericMatch = typeStr.match(/Array<(\w+)>/);
    if (genericMatch) matches.push(genericMatch[1]);
    // Foo[]
    const arrayMatch = typeStr.match(/^(\w+)\[\]$/);
    if (arrayMatch) matches.push(arrayMatch[1]);
    // Single type
    if (/^\w+$/.test(typeStr)) matches.push(typeStr);
    return matches;
}

export function generateFromFlowchart(definition, outDir = "./out") {
    const parsed = parseFlowchart(definition);
    generateFiles(outDir, parsed);
}