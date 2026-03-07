import fs from "fs";
import path from "path";

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
    const webBlocks = [];
    const externals = {};
    const cliScripts = {};
    const pkgOverrides = {};
    const processedFiles = new Set();

    const nodePattern = /(\w+)(?:\[([^\]{]+)(?:\{([^}]*)\})?\])?/;
    const webStartPattern = /web->(.+)\.code/;
    const webEndPattern = /web->(.+)\.end/;
    const methodPattern = /(@async\s+)?@(\w+)\.([^\{:]+)(?:\{([^}]*)\})?(?:\s*:\s*(.+))?/;
    const methodCodeStartPattern = /(@async\s+)?@{1,2}([\w.]+)\.code/;
    const methodCodeEndPattern = /@{1,2}([\w.]+)\.end/;
    const typePattern = /type->(\w+)\s*\{([^}]*)\}/;
    const interfacePattern = /interface->(\w+)\s*\{([^}]*)\}/;
    const mainCodeStartPattern = /(@async\s+)?@{1,2}main\.code/;
    const mainCodeEndPattern = /@{1,2}main\.end/;
    const externPattern = /extern->(\w+)\s*from\s*['"]([^'"]+)['"]/;
    const includePattern = /include->([^ \n]+)/;
    const cliScriptPattern = /cliscripts->(\w+)\s+(.+)/;
    const pkgOverridePattern = /pkg->(\w+)\s+(.+)/;

    function addNode(id, file, props, namespace) {
        if (!nodes[id]) {
            const fileName = (file || id + ".ts").trim();
            nodes[id] = { file: fileName, props: parseProps(props), namespace };
        } else {
            if (file) nodes[id].file = file.trim();
            if (props) nodes[id].props = parseProps(props);
            if (namespace !== undefined) nodes[id].namespace = namespace;
        }
    }

    function parseWorker(lines, currentDir, namespace) {
        for (let i = 0; i < lines.length; i++) {
            let line = lines[i];

            // Helper to check bracket balance
            const count = (str, char) => (str.match(new RegExp("\\" + char, "g")) || []).length;

            // Detect multiline node/composition/inheritance starts
            // If it has '[' but no matching ']', or '---' / '-->' at the end
            if (line.includes('[') && count(line, '[') > count(line, ']')) {
                while (i + 1 < lines.length && count(line, '[') > count(line, ']')) {
                    i++;
                    line += " " + lines[i];
                }
            }

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
                    const baseNamespace = namespace === "root" ? "" : namespace;
                    const subNamespace = path.join(baseNamespace, path.dirname(includeFile), path.basename(includeFile, ".flow")).replace(/\\/g, "/").replace(/^\//, "").replace(/\/$/, "");
                    parseWorker(subLines, path.dirname(fullPath), subNamespace || "root");
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
            const typeAliasMatch = line.match(/type->(\w+)\s*=\s*(.+)/);
            if (typeAliasMatch) {
                const [, typeName, typeDef] = typeAliasMatch;
                types[typeName] = { alias: typeDef.trim(), namespace };
                continue;
            }

            const typeStartMatch = line.match(/type->(\w+)\s*\{/);
            if (typeStartMatch) {
                const typeName = typeStartMatch[1];
                let content = line.substring(line.indexOf('{') + 1);
                if (!content.includes('}')) {
                    i++;
                    while (i < lines.length && !lines[i].includes('}')) {
                        content += lines[i] + " ";
                        i++;
                    }
                    if (i < lines.length) content += lines[i].substring(0, lines[i].indexOf('}'));
                } else {
                    content = content.substring(0, content.indexOf('}'));
                }
                types[typeName] = { props: parseProps(content), namespace };
                continue;
            }

            // 4. Interfaces
            const interfaceStartMatch = line.match(/interface->(\w+)\s*\{/);
            if (interfaceStartMatch) {
                const interfaceName = interfaceStartMatch[1];
                let content = line.substring(line.indexOf('{') + 1);
                if (!content.includes('}')) {
                    i++;
                    while (i < lines.length && !lines[i].includes('}')) {
                        content += lines[i] + " ";
                        i++;
                    }
                    if (i < lines.length) content += lines[i].substring(0, lines[i].indexOf('}'));
                } else {
                    content = content.substring(0, content.indexOf('}'));
                }
                interfaces[interfaceName] = { props: parseProps(content), namespace };
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
                    returnType: (returnType || "void").trim(),
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
                    if (!methods[className].constructor) {
                        methods[className].constructor = { params: [], returnType: "void" };
                    }
                    methods[className].constructor.code = trimmed;
                } else {
                    if (!methods[className][methodName]) {
                        methods[className][methodName] = { params: [], returnType: "void" };
                    }
                    methods[className][methodName].code = trimmed;
                    if (asyncFlag) methods[className][methodName].async = true;
                }
                continue;
            }

            // 8.5 Web Blocks
            const webStartMatch = line.match(new RegExp(`^${webStartPattern.source}$`));
            if (webStartMatch) {
                const filename = webStartMatch[1];
                let codeBlock = "";
                i++;
                while (i < lines.length && !lines[i].match(new RegExp(`^${webEndPattern.source}$`))) {
                    codeBlock += lines[i] + "\n";
                    i++;
                }
                webBlocks.push({ filename, code: codeBlock.trim() });
                continue;
            }

            // 9. Composition
            const compositionMatch = line.match(new RegExp(`^${nodePattern.source}(?:\\s*-->\\s*${nodePattern.source})?\\s*;?$`));
            if (compositionMatch) {
                const [, fromId, fromFile, fromProps, toId, toFile, toProps] = compositionMatch;
                addNode(fromId, fromFile, fromProps, namespace);
                if (toId) {
                    addNode(toId, toFile, toProps, namespace);
                    compositionEdges.push([fromId, toId]);
                }
                continue;
            }

            // 10. CLI Scripts (package.json scripts)
            const cliScriptMatch = line.match(cliScriptPattern);
            if (cliScriptMatch) {
                const [, scriptName, scriptCommand] = cliScriptMatch;
                cliScripts[scriptName] = scriptCommand;
                continue;
            }

            // 11. Package Overrides (package.json top-level fields)
            const pkgOverrideMatch = line.match(pkgOverridePattern);
            if (pkgOverrideMatch) {
                const [, fieldName, fieldValue] = pkgOverrideMatch;
                pkgOverrides[fieldName] = fieldValue;
                continue;
            }
        }
    }

    const rootLines = definition.split("\n").map(l => l.trim()).filter(l => l && !/^graph\b/.test(l));
    parseWorker(rootLines, "./flows", "");

    return { nodes, compositionEdges, extendsEdges, methods, types, interfaces, mainBlocks, webBlocks, externals, cliScripts, pkgOverrides };
}

/** Helper functions: parseProps, indent, stripTs, toPascalCase (identical to your original) **/
function smartSplit(str, separator, limit = -1) {
    const result = [];
    let current = "";
    let depth = 0;
    const pairs = { '(': ')', '[': ']', '{': '}', '<': '>' };
    const closeToOpen = Object.fromEntries(Object.entries(pairs).map(([k, v]) => [v, k]));

    for (let i = 0; i < str.length; i++) {
        const char = str[i];
        if (pairs[char]) depth++;
        else if (closeToOpen[char]) depth--;

        if (depth === 0 && char === separator && (limit === -1 || result.length < limit)) {
            result.push(current.trim());
            current = "";
        } else {
            current += char;
        }
    }
    result.push(current.trim());
    return result.filter(s => s.length > 0);
}

function parseProps(propStr) {
    if (!propStr) return [];
    // Split by top-level commas only
    const parts = smartSplit(propStr, ",");
    return parts.map((p) => {
        // Split by the first colon only (to support return types like (): void)
        const colonIdx = p.indexOf(":");
        if (colonIdx === -1) return { name: p.trim(), type: "any" };
        const name = p.substring(0, colonIdx).trim();
        const type = p.substring(colonIdx + 1).trim();
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
function generateFiles(baseDir, { nodes, compositionEdges, extendsEdges, methods, types, interfaces, mainBlocks, webBlocks, externals, cliScripts, pkgOverrides }) {
    // === Pre-calculate all component names (for cross-namespace imports) ===
    const allClassNames = new Set(Object.entries(nodes).map(([id, n]) => toPascalCase(path.basename(n.file || id, ".ts"))));
    const allInterfaceNames = new Set(Object.keys(interfaces));
    const allTypeNames = new Set(Object.keys(types));

    // === 0. Web Blocks (Static Files) ===
    for (const web of webBlocks) {
        const outPath = path.join(baseDir, web.filename);
        fs.mkdirSync(path.dirname(outPath), { recursive: true });
        fs.writeFileSync(outPath, web.code, "utf-8");
        console.log("📄 Web file generated: " + web.filename);
    }

    function getRelativeImport(fromNamespace, toNamespace, filename) {
        const fromDir = path.join(baseDir, fromNamespace);
        const toDir = path.join(baseDir, toNamespace);
        let rel = path.relative(fromDir, path.join(toDir, stripTs(filename))).replace(/\\/g, "/");
        if (!rel.startsWith(".")) rel = "./" + rel;
        return rel;
    }

    // 1. Types
    for (const [typeName, data] of Object.entries(types)) {
        const { props, alias, namespace } = data;
        const typeOrClassImports = new Set();
        let content = "";

        if (alias) {
            for (const ref of extractReferencedTypes(alias)) {
                if (types[ref] || interfaces[ref] || allClassNames.has(ref)) {
                    if (ref !== typeName) typeOrClassImports.add(ref);
                }
            }
            const importLines = Array.from(typeOrClassImports).map((name) => {
                const target = types[name] || interfaces[name] || Object.values(nodes).find(n => toPascalCase(path.basename(n.file, ".ts")) === name);
                const targetNamespace = target.namespace || "";
                const targetFile = target.file || (name + ".ts");
                const relPath = getRelativeImport(namespace, targetNamespace, targetFile);
                return `import type { ${name} } from "${relPath}";`;
            }).join("\n");
            content = `${importLines ? importLines + "\n\n" : ""}export type ${typeName} = ${alias};`;
        } else {
            const fields = props.map((p) => {
                for (const ref of extractReferencedTypes(p.type)) {
                    if (types[ref] || interfaces[ref] || allClassNames.has(ref)) {
                        if (ref !== typeName) typeOrClassImports.add(ref);
                    }
                }
                const cleanType = p.type.includes("):") ? p.type.replace(/\):/g, ") =>") : p.type;
                return `  ${p.name}: ${cleanType};`;
            }).join("\n");

            const importLines = Array.from(typeOrClassImports).map((name) => {
                const target = types[name] || interfaces[name] || Object.values(nodes).find(n => toPascalCase(path.basename(n.file, ".ts")) === name);
                const targetNamespace = target.namespace || "";
                const targetFile = target.file || (name + ".ts");
                const relPath = getRelativeImport(namespace, targetNamespace, targetFile);
                return `import type { ${name} } from "${relPath}";`;
            }).join("\n");

            content = `${importLines ? importLines + "\n\n" : ""}export type ${typeName} = {\n${fields}\n};`;
        }

        const outPath = path.join(baseDir, namespace, `${typeName}.ts`);
        fs.mkdirSync(path.dirname(outPath), { recursive: true });
        fs.writeFileSync(outPath, content, "utf-8");
    }

    // 2. Interfaces
    for (const [interfaceName, { props, namespace }] of Object.entries(interfaces)) {
        const typeOrClassImports = new Set();
        const fields = props.map((p) => {
            for (const ref of extractReferencedTypes(p.type)) {
                if (types[ref] || interfaces[ref] || classNames.has(ref)) {
                    if (ref !== interfaceName) typeOrClassImports.add(ref);
                }
            }

            // Fix: convert "(): void" to "() => void" for interfaces
            const cleanType = p.type.includes("):") ? p.type.replace(/\):/g, ") =>") : p.type;
            return `  ${p.name}: ${cleanType};`;
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
                if ((types[ref] || interfaces[ref]) && !allClassNames.has(ref)) {
                    customImports.add(ref);
                } else if (allClassNames.has(ref)) {
                    customImports.add("__class__" + ref);
                }
            }
        }

        // Scan methods for both internal AND external dependencies
        if (methods[className]) {
            for (const methodData of Object.values(methods[className])) {
                if (!methodData) continue;

                // Scan Method Signature (Params & ReturnType)
                if (methodData.params) {
                    for (const p of methodData.params) {
                        for (const ref of extractReferencedTypes(p.type)) {
                            if ((types[ref] || interfaces[ref]) && !allClassNames.has(ref)) customImports.add(ref);
                            else if (allClassNames.has(ref)) customImports.add("__class__" + ref);
                        }
                    }
                }
                if (methodData.returnType) {
                    for (const ref of extractReferencedTypes(methodData.returnType)) {
                        if ((types[ref] || interfaces[ref]) && !allClassNames.has(ref)) customImports.add(ref);
                        else if (allClassNames.has(ref)) customImports.add("__class__" + ref);
                    }
                }

                if (!methodData.code) continue;
                const allKnownNames = [...allClassNames, ...Object.keys(types), ...Object.keys(interfaces)];
                for (const name of allKnownNames) {
                    if (name === className) continue;
                    if (new RegExp(`\\b${name}\\b`).test(methodData.code)) {
                        if (types[name] || interfaces[name]) customImports.add(name);
                        else if (allClassNames.has(name)) customImports.add("__class__" + name);
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
        const hasCustomCtor = methods[className] && methods[className].constructor && methods[className].constructor.code;
        if (hasCustomCtor) {
            const paramsStr = (methods[className].constructor.params || []).map(p => `${p.name}: ${p.type}`).join(', ');
            ctorContent = `\n  constructor(${paramsStr}) {\n${indent(methods[className].constructor.code, 4)}\n  }\n`;
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
        scripts: {
            "build": "tsc main.ts --outDir dist",
            "start": "node dist/main.js",
            ...cliScripts
        },
        ...pkgOverrides,
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

        for (const name of [...allClassNames, ...allInterfaceNames, ...allTypeNames]) {
            if (new RegExp(`\\b${name}\\b`).test(fullMainCode)) {
                // Find the source component regardless of its namespace
                let target = types[name] || interfaces[name];
                if (!target) {
                    // Search nodes by ID or by PascalCase(file)
                    const nodeEntry = Object.entries(nodes).find(([id, n]) => id === name || toPascalCase(path.basename(n.file || id, ".ts")) === name);
                    if (nodeEntry) target = nodeEntry[1];
                }

                if (target) {
                    const fileName = target.file || (name + ".ts");
                    const relPath = getRelativeImport("", target.namespace, fileName);
                    mainImports.add(`import ${allInterfaceNames.has(name) || allTypeNames.has(name) ? 'type ' : ''}{ ${name} } from "${relPath}";`);
                }
            }
        }
        for (const [libName, libPath] of Object.entries(externals)) {
            if (new RegExp(`\\b${libName}\\b`).test(fullMainCode)) {
                mainImports.add(`import * as ${libName} from "${libPath}";`);
            }
        }
        const finalMainContent = `${Array.from(mainImports).sort().join("\n")}\n\n${mainContent}\n`;
        fs.writeFileSync(path.join(baseDir, "main.ts"), finalMainContent, "utf-8");
    }
}

function extractReferencedTypes(typeStr) {
    if (!typeStr) return [];
    // Find all PascalCase words (potential types)
    const matches = typeStr.match(/\b[A-Z]\w*\b/g) || [];
    // Exclude built-in generics like Promise and Array
    const builtIns = new Set(["Promise", "Array", "Record", "Partial", "Pick", "Omit"]);
    return matches.filter(m => !builtIns.has(m));
}

export function generateFromFlowchart(definition, outDir = "./out") {
    const parsed = parseFlowchart(definition);
    generateFiles(outDir, parsed);
}