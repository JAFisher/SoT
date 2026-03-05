import fs from "fs";
import path from "path";

/**
 * PARSER: Extracts Nodes, Methods, Web Blocks, and Externals
 */
function parseFlowchart(definition) {
    const nodes = {};
    const methods = {};
    const mainBlocks = [];
    const externals = {};
    const webFiles = {};

    const lines = definition
        .split("\n")
        .map((l) => l.trim())
        .filter((l) => l && !/^graph\b/.test(l));

    // Regex patterns
    const externPattern = /^extern->(\w+)\s*from\s*['"]([^'"]+)['"]/;
    const webStartPattern = /^web->([\w.]+)\.code/;
    const webEndPattern = /^web->([\w.]+)\.end/;
    const nodePattern = /^(\w+)\[([^\]{]+)(?:\{([^}]+)\})?\]/;
    const methodBlockStart = /^@{1,2}(\w+)\.([^.]+)\.code/;
    const methodBlockEnd = /^@{1,2}(\w+)\.([^.]+)\.end/;
    const mainStartPattern = /^@{1,2}main\.code/;
    const mainEndPattern = /^@{1,2}main\.end/;

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];

        // 1. WEB BLOCKS (HTML/CSS/JS)
        const webMatch = line.match(webStartPattern);
        if (webMatch) {
            const filename = webMatch[1];
            let content = ""; i++;
            while (i < lines.length && !lines[i].match(webEndPattern)) {
                content += lines[i] + "\n"; i++;
            }
            webFiles[filename] = content.trim();
            continue;
        }

        // 2. EXTERNALS (npm packages)
        const externMatch = line.match(externPattern);
        if (externMatch) {
            externals[externMatch[1]] = externMatch[2];
            continue;
        }

        // 3. MAIN CODE (Entry point)
        if (line.match(mainStartPattern)) {
            let content = ""; i++;
            while (i < lines.length && !lines[i].match(mainEndPattern)) {
                content += lines[i] + "\n"; i++;
            }
            mainBlocks.push(content.trim());
            continue;
        }

        // 4. METHOD BLOCKS (Class logic)
        const mbMatch = line.match(methodBlockStart);
        if (mbMatch) {
            const [_, className, methodName] = mbMatch;
            let content = ""; i++;
            while (i < lines.length && !lines[i].match(methodBlockEnd)) {
                content += lines[i] + "\n"; i++;
            }
            if (!methods[className]) methods[className] = {};
            if (methodName === "constructor") {
                methods[className].constructor = { code: content.trim() };
            } else {
                if (!methods[className][methodName]) methods[className][methodName] = { params: [], returnType: "any" };
                methods[className][methodName].code = content.trim();
            }
            continue;
        }

        // 5. NODES (Mapping ID to Filename)
        const nMatch = line.match(nodePattern);
        if (nMatch) {
            const [_, id, file, props] = nMatch;
            nodes[id] = { file: file.trim(), props: parseProps(props) };
            continue;
        }
    }
    return { nodes, methods, mainBlocks, externals, webFiles };
}

/**
 * GENERATOR: Writes the project structure to disk
 */
function generateFiles(baseDir, data) {
    const { nodes, methods, mainBlocks, externals, webFiles } = data;
    if (!fs.existsSync(baseDir)) fs.mkdirSync(baseDir, { recursive: true });

    // 1. WEB ASSETS
    for (const [name, code] of Object.entries(webFiles)) {
        fs.writeFileSync(path.join(baseDir, name), code);
    }

    // 2. CLASSES
    for (const [id, node] of Object.entries(nodes)) {
        const className = toPascalCase(id); // ID determines the class name
        const fileName = node.file;         // Label determines the filename

        const extImports = new Set();
        if (methods[className]) {
            for (const m of Object.values(methods[className])) {
                for (const [lName, lPath] of Object.entries(externals)) {
                    if (new RegExp(`\\b${lName}\\b`).test(m.code || "")) {
                        extImports.add(`import * as ${lName} from "${lPath}";`);
                    }
                }
            }
        }

        const fields = node.props.map(p => `  ${p.name}: ${p.type};`).join("\n");
        const ctor = methods[className]?.constructor
            ? `\n  constructor() {\n${indent(methods[className].constructor.code, 4)}\n  }`
            : "";

        const mBody = Object.entries(methods[className] || {})
            .filter(([k]) => k !== 'constructor')
            .map(([k, v]) => `\n  public ${k}(${(v.params || []).map(p => `${p.name}: ${p.type}`).join(', ')}): ${v.returnType || 'any'} {\n${indent(v.code, 4)}\n  }`).join("");

        const content = `${Array.from(extImports).join("\n")}\n\nexport class ${className} {\n${fields}\n${ctor}${mBody}\n}`;
        fs.writeFileSync(path.join(baseDir, fileName), content);
    }

    // 3. MAIN.TS (Entry Point)
    if (mainBlocks.length > 0) {
        const code = mainBlocks.join("\n\n");
        const imps = new Set();

        // Scan for external libs used in main
        for (const [n, p] of Object.entries(externals)) {
            if (new RegExp(`\\b${n}\\b`).test(code)) imps.add(`import * as ${n} from "${p}";`);
        }

        // Import classes based on Node IDs
        for (const [id, n] of Object.entries(nodes)) {
            const className = toPascalCase(id);
            const fileRef = stripTs(n.file);
            imps.add(`import { ${className} } from "./${fileRef}";`);
        }

        fs.writeFileSync(path.join(baseDir, "main.ts"), `${Array.from(imps).join("\n")}\n\n${code}`);
    }

    // 4. PACKAGE.JSON & DOCS
    const dependencies = {};
    for (const p of Object.values(externals)) {
        const clean = p.replace("node:", "");
        if (!["http", "fs", "path", "readline", "os"].includes(clean)) dependencies[clean] = "latest";
    }

    fs.writeFileSync(path.join(baseDir, "package.json"), JSON.stringify({
        name: "sot-project",
        version: "1.0.0",
        scripts: { start: " node dist/main.js", build: "tsc main.ts --outDir dist" },
        dependencies
    }, null, 2));

    fs.writeFileSync(path.join(baseDir, "README.md"), "# Generated by SoT\nRun `npm install` and `npm start`.");
    console.log(`🚀 Project generated in ${baseDir}`);
}

// HELPERS
function parseProps(s) { return (s || "").split(",").map(p => p.trim()).filter(Boolean).map(p => ({ name: p.split(":")[0], type: p.split(":")[1] || "any" })); }
function indent(c, n = 4) { return c ? c.split("\n").map(l => " ".repeat(n) + l).join("\n") : ""; }
function stripTs(p) { return p.replace(/\.ts$/i, ""); }
function toPascalCase(s) { return s.replace(/[-_](.)/g, (_, c) => c.toUpperCase()).replace(/^\w/, c => c.toUpperCase()); }

export function generateFromFlowchart(definition, outDir = "./out") {
    const parsed = parseFlowchart(definition);
    generateFiles(outDir, parsed);
}