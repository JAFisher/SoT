import { readdir, readFile, writeFile, mkdir } from "fs/promises";
import { existsSync } from "fs";
import path from "path";

// ── Inline parser (extracted from generateFromFlowchart.js, file-writing removed) ──

function parseProps(propStr) {
    if (!propStr) return [];
    return propStr.split(",").map((p) => p.trim()).filter(Boolean).map((p) => {
        const [name, type] = p.split(":").map((s) => s.trim());
        return { name, type: type || "any" };
    });
}

function parseFlowchart(definition) {
    const compositionEdges = [];
    const extendsEdges = [];
    const nodes = {};
    const methods = {};
    const types = {};
    const interfaces = {};
    const mainBlocks = [];
    const externals = {};

    const lines = definition
        .split("\n")
        .map((l) => l.trim())
        .filter((l) => l && !/^graph\b/.test(l) && !/^%%/.test(l));

    const nodePattern = /(\w+)\[([^\]{}]+?)(?:\.ts)?\s*(?:\{([^}]+)\})?\]/;
    const methodPattern = /@(\w+)\.([^{]+)(?:\{([^}]+)\})?:\s*(.+)/;
    const methodCodeStartPattern = /@{1,2}(\w+)\.([^.]+)\.code/;
    const methodCodeEndPattern = /@{1,2}(\w+)\.([^.]+)\.end/;
    const typePattern = /type->(\w+)\s*\{([^}]+)\}/;
    const interfacePattern = /interface->(\w+)\s*\{([^}]+)\}/;
    const mainCodeStartPattern = /@{1,2}main\.code/;
    const mainCodeEndPattern = /@{1,2}main\.end/;
    const externPattern = /extern->(\w+)\s*from\s*['"]([^'"]+)['"]/;
    const webStartPattern = /web->(.+)\.code/;
    const webEndPattern = /web->(.+)\.end/;

    function addNode(id, rawFile, props) {
        const file = rawFile ? rawFile.trim().replace(/\.ts$/, "") : id;
        if (!nodes[id]) {
            nodes[id] = { file, props: parseProps(props) };
        } else {
            nodes[id].file = file;
            if (props) nodes[id].props = parseProps(props);
        }
    }

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];

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
        const typeMatch = line.match(typePattern);
        if (typeMatch) {
            types[typeMatch[1]] = parseProps(typeMatch[2]);
            continue;
        }

        // Interfaces
        const interfaceMatch = line.match(interfacePattern);
        if (interfaceMatch) {
            interfaces[interfaceMatch[1]] = parseProps(interfaceMatch[2]);
            continue;
        }

        // Inheritance: ChildID[...] ---|> ParentID[...]
        const fullNodePat = /(\w+)\[([^\]{}]+?)(?:\.ts)?\s*(?:\{([^}]+)\})?\]/;
        const extendsRegex = new RegExp(
            `^${fullNodePat.source}\\s*---\\|>\\s*${fullNodePat.source}\\s*;?$`
        );
        const extendsMatch = line.match(extendsRegex);
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
            const [, className, methodName, params, returnType] = methodMatch;
            if (!methods[className]) methods[className] = {};
            methods[className][methodName.trim()] = {
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
            const [, className, methodName] = methodCodeStartMatch;
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
                    methods[className][methodName] = { params: [], returnType: "any" };
                }
                methods[className][methodName].code = codeBlock.trim();
            }
            continue;
        }

        // Composition: simple form  A --> B  (no brackets)
        const simpleCompMatch = line.match(/^(\w+)\s*-->\s*(\w+)\s*;?\s*$/);
        if (simpleCompMatch && !line.includes("[")) {
            const [, fromId, toId] = simpleCompMatch;
            addNode(fromId, null, null);
            addNode(toId, null, null);
            compositionEdges.push([fromId, toId]);
            continue;
        }

        // Composition with node defs
        const compRegex = new RegExp(
            `^${fullNodePat.source}(?:\\s*-->\\s*${fullNodePat.source})?\\s*;?$`
        );
        const compositionMatch = line.match(compRegex);
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

// ── Convert parsed flow to Mermaid diagram string ──

function toMermaidDiagram(parsed) {
    const { nodes, compositionEdges, extendsEdges, methods, types, interfaces } = parsed;
    const lines = ["graph TD"];

    // Build node labels: ClassName with properties & methods
    for (const [id, node] of Object.entries(nodes)) {
        const className = node.file || id;
        const sections = [className];

        // Properties
        if (node.props && node.props.length > 0) {
            sections.push("─────────────────");
            for (const p of node.props) {
                sections.push(`${p.name}: ${p.type}`);
            }
        }

        // Methods for this class
        const classMethods = methods[className] || {};
        const methodNames = Object.keys(classMethods).filter(m => m !== "constructor");
        if (methodNames.length > 0) {
            sections.push("─────────────────");
            for (const m of methodNames) {
                const md = classMethods[m];
                const paramStr = (md.params || []).map(p => `${p.name}: ${p.type}`).join(", ");
                const ret = md.returnType || "void";
                sections.push(`${m}(${paramStr}): ${ret}`);
            }
        }

        const label = sections.join("\n");
        // Use the Mermaid box syntax with quotes for multi-line
        const escapedLabel = label.replace(/"/g, "#quot;");
        lines.push(`  ${id}["${escapedLabel}"]`);
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
            const fields = props.map(p => `${p.name}: ${p.type}`).join("\n");
            const label = `«type»\n${name}\n─────────────────\n${fields}`;
            const esc = label.replace(/"/g, "#quot;");
            lines.push(`    T_${name}["${esc}"]`);
        }
        lines.push("  end");
    }

    // Interfaces as separate nodes (if any)
    if (Object.keys(interfaces).length > 0) {
        lines.push("");
        lines.push("  subgraph Interfaces");
        lines.push("    direction TB");
        for (const [name, props] of Object.entries(interfaces)) {
            const fields = props.map(p => `${p.name}: ${p.type}`).join("\n");
            const label = `«interface»\n${name}\n─────────────────\n${fields}`;
            const esc = label.replace(/"/g, "#quot;");
            lines.push(`    I_${name}["${esc}"]`);
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

    const files = (await readdir(FLOWS_DIR)).filter(f => f.endsWith(".flow"));
    if (files.length === 0) {
        console.warn("⚠️  No .flow files found.");
        process.exit(0);
    }

    const result = {};

    for (const file of files) {
        const name = path.basename(file, ".flow");
        const content = await readFile(path.join(FLOWS_DIR, file), "utf-8");

        console.log(`  📦  ${name}`);

        const parsed = parseFlowchart(content);
        const diagram = toMermaidDiagram(parsed);
        const metadata = collectMetadata(parsed);

        result[name] = { diagram, metadata };
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
