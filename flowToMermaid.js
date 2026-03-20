import { readdir, readFile, writeFile, mkdir } from "fs/promises";
import { existsSync } from "fs";
import path from "path";

// ── Inline parser (extracted from generateFromFlowchart.js, file-writing removed) ──

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
    const parts = smartSplit(propStr, ",");
    return parts.map((p) => {
        const colonIdx = p.indexOf(":");
        if (colonIdx === -1) return { name: p.trim(), type: "any" };
        const name = p.substring(0, colonIdx).trim();
        const type = p.substring(colonIdx + 1).trim();
        return { name, type: type || "any" };
    });
}

async function parseFlowchart(definition, sourceDir = "./flows") {
    const compositionEdges = [];
    const extendsEdges = [];
    const nodes = {};
    const methods = {};
    const types = {};
    const interfaces = {};
    const mainBlocks = [];
    const externals = {};
    const processedFiles = new Set();

    const nodePattern = /(\w+)(?:\[([^\]{]+)(?:\{([^}]*)\})?\])?/;
    const methodPattern = /(@async\s+)?@(\w+)\.([^{]+)(?:\{([^}]*)\})?:\s*(.+)/;
    const methodCodeStartPattern = /(@async\s+)?@{1,2}([\w.]+)\.code/;
    const methodCodeEndPattern = /@{1,2}([\w.]+)\.end/;
    const typePattern = /type->(\w+)\s*\{([^}]*)\}/;
    const interfacePattern = /interface->(\w+)\s*\{([^}]*)\}/;
    const mainCodeStartPattern = /@{1,2}main\.code/;
    const mainCodeEndPattern = /@{1,2}main\.end/;
    const externPattern = /extern->(\w+)\s*from\s*['"]([^'"]+)['"]/;
    const webStartPattern = /web->(.+)\.code/;
    const webEndPattern = /web->(.+)\.end/;
    const includePattern = /include->([^ \n]+)/;

    function addNode(id, rawFile, props) {
        const file = rawFile ? rawFile.trim().replace(/\.ts$/, "") : (nodes[id]?.file || id);
        if (!nodes[id]) {
            nodes[id] = { file, props: parseProps(props) };
        } else {
            if (rawFile) nodes[id].file = file;
            if (props) nodes[id].props = parseProps(props);
        }
    }

    async function parseWorker(lines, currentDir) {
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];

            // 0. Handle Includes
            const includeMatch = line.match(includePattern);
            if (includeMatch) {
                const includeFile = includeMatch[1];
                const fullPath = path.resolve(currentDir, includeFile);
                if (processedFiles.has(fullPath)) continue;
                processedFiles.add(fullPath);

                if (existsSync(fullPath)) {
                    const content = await readFile(fullPath, "utf-8");
                    const subLines = content.split("\n").map(l => l.trim()).filter(l => l && !/^graph\b/.test(l) && !/^%%/.test(l));
                    await parseWorker(subLines, path.dirname(fullPath));
                }
                continue;
            }

            // Skip externals
            if (externPattern.test(line)) {
                const m = line.match(externPattern);
                externals[m[1]] = m[2];
                continue;
            }

            // Skip web blocks
            if (webStartPattern.test(line)) {
                i++;
                while (i < lines.length && !webEndPattern.test(lines[i])) i++;
                continue;
            }

            // Types
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
                types[typeName] = parseProps(content);
                continue;
            }

            // Interfaces
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
                interfaces[interfaceName] = parseProps(content);
                continue;
            }

            // 5. Inheritance
            const extendsMatch = line.match(new RegExp(`^${nodePattern.source}\\s*---\\|>\\s*${nodePattern.source}\\s*;?$`));
            if (extendsMatch) {
                const [, childId, childFile, childProps, parentId, parentFile, parentProps] = extendsMatch;
                addNode(childId, childFile, childProps);
                addNode(parentId, parentFile, parentProps);
                extendsEdges.push({ childId, parentId });
                continue;
            }

            // Method signatures
            const methodMatch = line.match(new RegExp(`^${methodPattern.source}`));
            if (methodMatch) {
                const [, asyncFlag, className, methodName, params, returnType] = methodMatch;
                if (!methods[className]) methods[className] = {};
                methods[className][methodName.trim()] = {
                    async: !!asyncFlag,
                    params: parseProps(params),
                    returnType: (returnType || "").trim(),
                };
                continue;
            }

            // Main code blocks — skip content
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

            // Method code blocks — skip content but record
            const methodCodeStartMatch = line.match(new RegExp(`^${methodCodeStartPattern.source}$`));
            if (methodCodeStartMatch) {
                const [, asyncFlag, targetFull] = methodCodeStartMatch;
                const parts = targetFull.split('.');
                const methodName = parts.pop();
                const className = parts.join('.').replace(/^@+/, ""); // Strip leading @ if any remain

                let codeBlock = "";
                i++;
                while (i < lines.length && !lines[i].match(new RegExp(`^${methodCodeEndPattern.source}$`))) {
                    codeBlock += lines[i] + "\n";
                    i++;
                }
                if (!methods[className]) methods[className] = {};
                if (methodName === "constructor") {
                    methods[className].constructor = { code: codeBlock.trim() };
                } else {
                    if (!methods[className][methodName]) {
                        methods[className][methodName] = { params: [], returnType: "void" };
                    }
                    methods[className][methodName].code = codeBlock.trim();
                    if (asyncFlag) methods[className][methodName].async = true;
                }
                continue;
            }

            // 9. Composition
            const compositionMatch = line.match(new RegExp(`^${nodePattern.source}(?:\\s*-->\\s*${nodePattern.source})?\\s*;?$`));
            if (compositionMatch) {
                const [, fromId, fromFile, fromProps, toId, toFile, toProps] = compositionMatch;
                addNode(fromId, fromFile, fromProps);
                if (toId) {
                    addNode(toId, toFile, toProps);
                    compositionEdges.push([fromId, toId]);
                }
                continue;
            }
        }
    }

    processedFiles.add("ROOT");
    const rootLines = definition.split("\n").map(l => l.trim()).filter(l => l && !/^graph\b/.test(l) && !/^%%/.test(l));
    await parseWorker(rootLines, sourceDir);

    return { nodes, compositionEdges, extendsEdges, methods, types, interfaces, mainBlocks, externals };
}

function escapeHtml(str) {
    if (!str) return "";
    return str
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}

// ── Convert parsed flow to Mermaid diagram string ──

function toMermaidDiagram(parsed) {
    const { nodes, compositionEdges, extendsEdges, methods, types, interfaces } = parsed;
    const lines = ["graph TD"];

    // Build node labels: ClassName with properties & methods
    for (const [id, node] of Object.entries(nodes)) {
        const className = node.file || id;
        const sections = [escapeHtml(className)];

        // Properties
        if (node.props && node.props.length > 0) {
            sections.push("─────────────────");
            for (const p of node.props) {
                sections.push(`${escapeHtml(p.name)}: ${escapeHtml(p.type)}`);
            }
        }

        // Methods for this class
        const classMethods = methods[className] || {};
        const methodNames = Object.keys(classMethods).filter(m => m !== "constructor");
        if (methodNames.length > 0) {
            sections.push("─────────────────");
            for (const m of methodNames) {
                const md = classMethods[m];
                const paramStr = (md.params || []).map(p => `${escapeHtml(p.name)}: ${escapeHtml(p.type)}`).join(", ");
                const ret = md.returnType || "void";
                const prefix = md.async ? "⚡ " : "";
                sections.push(`${prefix}${escapeHtml(m)}(${paramStr}): ${escapeHtml(ret)}`);
            }
        }

        const label = sections.join("<br/>");
        // Use the Mermaid box syntax with quotes for multi-line
        lines.push(`  ${id}["${label}"]`);
    }

    // Inheritance edges
    for (const edge of extendsEdges) {
        lines.push(`  ${edge.childId} -->|extends| ${edge.parentId}`);
    }

    // Composition edges
    for (const [from, to] of compositionEdges) {
        lines.push(`  ${from} --> ${to}`);
    }

    // Types as separate nodes (if any)
    if (Object.keys(types).length > 0) {
        lines.push("");
        lines.push("  subgraph Types");
        lines.push("    direction TB");
        for (const [name, props] of Object.entries(types)) {
            const fields = props.map(p => `${escapeHtml(p.name)}: ${escapeHtml(p.type)}`).join("<br/>");
            const label = `«type»<br/>${escapeHtml(name)}<br/>─────────────────<br/>${fields}`;
            lines.push(`    T_${name}["${label}"]`);
        }
        lines.push("  end");
    }

    // Interfaces as separate nodes (if any)
    if (Object.keys(interfaces).length > 0) {
        lines.push("");
        lines.push("  subgraph Interfaces");
        lines.push("    direction TB");
        for (const [name, props] of Object.entries(interfaces)) {
            const fields = props.map(p => `${escapeHtml(p.name)}: ${escapeHtml(p.type)}`).join("<br/>");
            const label = `«interface»<br/>${escapeHtml(name)}<br/>─────────────────<br/>${fields}`;
            lines.push(`    I_${name}["${label}"]`);
        }
        lines.push("  end");
    }

    return lines.join("\n");
}

// ── Collect metadata for the detail panel ──

function collectMetadata(parsed) {
    const { nodes, compositionEdges, extendsEdges, methods, types, interfaces, externals } = parsed;

    const methodList = [];
    for (const [cls, clsMethods] of Object.entries(methods)) {
        for (const [name, data] of Object.entries(clsMethods)) {
            if (name === "constructor") continue;
            const params = (data.params || []).map(p => `${p.name}: ${p.type}`).join(", ");
            methodList.push({
                class: cls,
                name,
                signature: `${cls}.${name}(${params}): ${data.returnType || "void"}`,
                async: !!data.async,
                hasCode: !!data.code,
            });
        }
    }

    return {
        nodeCount: Object.keys(nodes).length,
        compositionEdgeCount: compositionEdges.length,
        inheritanceEdgeCount: extendsEdges.length,
        types: Object.fromEntries(
            Object.entries(types).map(([k, v]) => [k, v.map(p => `${p.name}: ${p.type}`)])
        ),
        interfaces: Object.fromEntries(
            Object.entries(interfaces).map(([k, v]) => [k, v.map(p => `${p.name}: ${p.type}`)])
        ),
        methods: methodList,
        externals: Object.keys(externals).length > 0 ? externals : undefined,
    };
}

// ── Main ──

async function main() {
    const FLOWS_DIR = "./flows";
    const OUT_DIR = "./viewer";

    console.log("🔍  Scanning for .flow files...");

    if (!existsSync(FLOWS_DIR)) {
        console.error("❌  No flows/ directory found.");
        process.exit(1);
    }

    const items = await readdir(FLOWS_DIR, { withFileTypes: true });
    const folders = items.filter(item => item.isDirectory());

    if (folders.length === 0) {
        console.warn("⚠️  No folders found in " + FLOWS_DIR + "/");
        process.exit(0);
    }

    const result = {};

    for (const folder of folders) {
        const folderName = folder.name;
        const folderPath = path.join(FLOWS_DIR, folderName);

        const folderItems = await readdir(folderPath, { withFileTypes: true });
        const flowFiles = folderItems.filter(f => f.isFile() && f.name.endsWith(".flow"));

        for (const file of flowFiles) {
            const name = path.basename(file.name, ".flow");
            const content = await readFile(path.join(folderPath, file.name), "utf-8");

            console.log(`  📦  ${folderName}/${name}`);

            const parsed = await parseFlowchart(content, folderPath);
            const diagram = toMermaidDiagram(parsed);
            const metadata = collectMetadata(parsed);

            result[`${folderName}/${name}`] = { diagram, metadata, rawSource: content };
        }
    }

    if (Object.keys(result).length === 0) {
        console.warn("⚠️  No .flow files found.");
        process.exit(0);
    }

    if (!existsSync(OUT_DIR)) {
        await mkdir(OUT_DIR, { recursive: true });
    }

    await writeFile(
        path.join(OUT_DIR, "flows.json"),
        JSON.stringify(result, null, 2),
        "utf-8"
    );

    console.log(`\n✅  Generated ${OUT_DIR}/flows.json with ${Object.keys(result).length} flows.`);
    console.log(`    Open viewer/index.html to view your charts.`);
}

main();
