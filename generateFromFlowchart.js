import fs from "fs";
import path from "path";

/**
 * Parses a flowchart definition string to extract nodes, composition edges,
 * inheritance edges, and method definitions, as well as new types and interfaces.
 * @param {string} definition The flowchart definition string.
 * @returns {{
 *   nodes: object,
 *   compositionEdges: Array<Array<string>>,
 *   extendsEdges: Array<{childId: string, parentId: string}>,
 *   methods: object,
 *   types: object,
 *   interfaces: object,
 *   mainBlocks: Array<string>
 * }}
 */
function parseFlowchart(definition) {
  const compositionEdges = [];
  const extendsEdges = [];
  const nodes = {};
  const methods = {};
  const types = {};
  const interfaces = {};
  const mainBlocks = [];

  const lines = definition
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !/^graph\b/.test(l));

  // Regex to match a node with optional properties
  const nodePattern = /(\w+)\[([^\]{]+)(?:\{([^}]+)\})?\]/;
  // Regex to match a method with optional parameters and return type.
  const methodPattern = /@(\w+)\.([^\{]+)(?:\{([^}]+)\})?:\s*(.+)/;
  // Regex to match a method/ctor code block start (accepts @ or @@)
  const methodCodeStartPattern = /@{1,2}(\w+)\.([^.]+)\.code/;
  // Regex to match a method/ctor code block end (accepts @ or @@)
  const methodCodeEndPattern = /@{1,2}(\w+)\.([^.]+)\.end/;
  // Regex for new type definition
  const typePattern = /type->(\w+)\s*\{([^}]+)\}/;
  // Regex for new interface definition
  const interfacePattern = /interface->(\w+)\s*\{([^}]+)\}/;
  // Regex for main code block start (accepts @ or @@)
  const mainCodeStartPattern = /@{1,2}main\.code/;
  // Regex for main code block end (accepts @ or @@)
  const mainCodeEndPattern = /@{1,2}main\.end/;

  /**
   * Helper to add/update a node in the nodes map.
   * @param {string} id
   * @param {string} file
   * @param {string} [props]
   */
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

    // type
    const typeMatch = line.match(typePattern);
    if (typeMatch) {
      const [, typeName, props] = typeMatch;
      types[typeName] = parseProps(props);
      continue;
    }

    // interface
    const interfaceMatch = line.match(interfacePattern);
    if (interfaceMatch) {
      const [, interfaceName, props] = interfaceMatch;
      interfaces[interfaceName] = parseProps(props);
      continue;
    }

    // inheritance: A[...] ---|> B[...];
    const extendsMatch = line.match(new RegExp(`^${nodePattern.source}\\s*---\\|>\\s*${nodePattern.source}\\s*;?$`));
    if (extendsMatch) {
      const [, childId, childFile, childProps, parentId, parentFile, parentProps] = extendsMatch;
      addNode(childId, childFile, childProps);
      addNode(parentId, parentFile, parentProps);
      extendsEdges.push({ childId, parentId });
      continue;
    }

    // method signature: @Class.method{param:type}: returnType
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

    // main code block start
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

    // method/ctor code block start
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
        // Store constructor specially
        methods[className].constructor = { code: trimmed };
      } else {
        // If there was no prior signature, create a minimal one so code isn't lost
        if (!methods[className][methodName]) {
          methods[className][methodName] = { params: [], returnType: "any" };
        }
        methods[className][methodName].code = trimmed;
      }
      continue;
    }

    // composition or standalone node: A[...] --> B[...] ;   OR   A[...]{...}
    const compositionMatch = line.match(
      new RegExp(`^${nodePattern.source}(?:\\s*-->\\s*${nodePattern.source})?\\s*;?$`)
    );
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

  return { nodes, compositionEdges, extendsEdges, methods, types, interfaces, mainBlocks };
}

/**
 * Parse "a:b, c:d" → [{name:"a", type:"b"}, {name:"c", type:"d"}]
 * @param {string} propStr
 * @returns {Array<{name: string, type: string}>}
 */
function parseProps(propStr) {
  if (!propStr) return [];
  return propStr
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => {
      const [name, type] = p.split(":").map((s) => s.trim());
      return { name, type: type || "any" };
    });
}

/** Indent every line in a string by n spaces. */
function indent(code, n = 4) {
  if (!code) return "";
  const pad = " ".repeat(n);
  return code
    .split("\n")
    .map((line) => (line.length ? pad + line : line))
    .join("\n");
}

/** Remove a trailing .ts extension from a path-like string. */
function stripTs(p) {
  return p.replace(/\.ts$/i, "");
}

/**
 * Generates the class/type/interface files based on parsed data.
 * @param {string} baseDir
 * @param {{
 *   nodes: object,
 *   compositionEdges: Array<Array<string>>,
 *   extendsEdges: Array<{childId: string, parentId: string}>,
 *   methods: object,
 *   types: object,
 *   interfaces: object,
 *   mainBlocks: Array<string>
 * }} parsedData
 */
function generateFiles(baseDir, { nodes, compositionEdges, extendsEdges, methods, types, interfaces, mainBlocks }) {
  // All class names, for quick checks
  const classNames = new Set(Object.values(nodes).map((n) => path.basename(n.file, path.extname(n.file))));
  const interfaceNames = new Set(Object.keys(interfaces));
  const typeNames = new Set(Object.keys(types));

  // === Types ===
  for (const [typeName, props] of Object.entries(types)) {
    const filename = `${typeName}.ts`;
    const fields = props.map((p) => `  ${p.name}: ${p.type};`).join("\n");
    const content = `export type ${typeName} = {\n${fields}\n};`;
    const outPath = path.join(baseDir, filename);
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, content, "utf-8");
    console.log(`✅ Created type file ${outPath}`);
  }

  // === Interfaces ===
  for (const [interfaceName, props] of Object.entries(interfaces)) {
    const filename = `${interfaceName}.ts`;
    const typeOrClassImports = new Set();

    const fields = props
      .map((p) => {
        const mGeneric = p.type.match(/Array<(\w+)>/);
        const elem = mGeneric ? mGeneric[1] : p.type.replace(/\[\]$/, "");
        if (types[elem] || interfaces[elem] || classNames.has(elem)) {
          typeOrClassImports.add(elem);
        }
        return `  ${p.name}: ${p.type};`;
      })
      .join("\n");

    const importLines = Array.from(typeOrClassImports)
      .map((name) => `import type { ${name} } from "./${stripTs(name)}";`)
      .join("\n");

    const imports = importLines ? importLines + "\n\n" : "";
    const content = `${imports}export interface ${interfaceName} {\n${fields}\n}\n`;

    const outPath = path.join(baseDir, filename);
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, content, "utf-8");
    console.log(`✅ Created interface file ${outPath}`);
  }

  // === Classes ===
  for (const [id, { file: filename, props }] of Object.entries(nodes)) {
    const className = toPascalCase(path.basename(filename, path.extname(filename)));

    const parentRelationship = extendsEdges.find((r) => r.childId === id);
    let extendsClause = "";
    let parentImport = "";
    const customImports = new Set();

    if (parentRelationship) {
      const parentId = parentRelationship.parentId;
      const parentFile = nodes[parentId].file;
      const parentClassName = toPascalCase(path.basename(parentFile, path.extname(parentFile)));

      let parentPath = path.relative(path.dirname(filename), parentFile).replace(/\\/g, "/");
      if (!parentPath.startsWith(".")) parentPath = "./" + parentPath;
      parentPath = stripTs(parentPath);

      extendsClause = ` extends ${parentClassName}`;
      parentImport = `import { ${parentClassName} } from "${parentPath}";`;
    }

    const compositionImports = compositionEdges
      .filter(([from]) => from === id)
      .map(([_, to]) => {
        const depFile = nodes[to].file;
        const depClass = toPascalCase(path.basename(depFile, path.extname(depFile)));
        let depPath = path.relative(path.dirname(filename), depFile).replace(/\\/g, "/");
        if (!depPath.startsWith(".")) depPath = "./" + depPath;
        depPath = stripTs(depPath);
        return `import { ${depClass} } from "${depPath}";`;
      })
      .join("\n");

    // Imports for types/interfaces referenced in props
    for (const prop of props) {
      if (types[prop.type] || interfaces[prop.type]) {
        customImports.add(prop.type);
      }
    }

    // Imports for types/interfaces referenced in methods
    if (methods[className]) {
      for (const [mName, methodData] of Object.entries(methods[className])) {
        if (!methodData) continue;
        const rt = methodData.returnType;
        if (rt && (types[rt] || interfaces[rt])) customImports.add(rt);
        if (methodData.params) {
          for (const param of methodData.params) {
            if (types[param.type] || interfaces[param.type]) customImports.add(param.type);
          }
        }
      }
    }

    const customImportStatements = Array.from(customImports)
      .map((name) => `import type { ${name} } from "./${stripTs(name)}";`)
      .join("\n");

    const imports = [parentImport, compositionImports, customImportStatements].filter(Boolean).join("\n");

    // Fields
    const fields = props.map((p) => `  ${p.name}: ${p.type};`).join("\n");

    // Constructor
    let ctorContent = "";
    const hasCustomCtor = methods[className] && Object.prototype.hasOwnProperty.call(methods[className], "constructor");
    const ctorCode = hasCustomCtor ? (methods[className].constructor?.code || "").trim() : "";

    if (hasCustomCtor && ctorCode) {
      ctorContent = `
  constructor() {
${indent(ctorCode, 4)}
  }
`;
    } else if (props.length > 0) {
      // Auto constructor using props
      const ctorParams = props.map((p) => `${p.name}: ${p.type}`).join(", ");
      const assigns = props.map((p) => `this.${p.name} = ${p.name};`).join("\n");
      const body = parentRelationship ? `super();\n${assigns}` : assigns;
      ctorContent = `
  constructor(${ctorParams}) {
${indent(body, 4)}
  }
`;
    }
    // Else: no props and no valid custom code → no constructor emitted.

    // Methods
    let methodsContent = "";
    if (methods[className]) {
      methodsContent = Object.entries(methods[className])
        .filter(([name]) => name !== "constructor")
        .map(([methodName, methodData]) => {
          const params = (methodData.params || []).map((p) => `${p.name}: ${p.type}`).join(", ");
          const returnType = methodData.returnType || "any";
          const body = (methodData.code && methodData.code.trim()) || "// TODO: Add method logic here";
          return `
  public ${methodName}(${params}): ${returnType} {
${indent(body, 4)}
  }`;
        })
        .join("\n");
    }

    const content = `
${imports ? imports + "\n\n" : ""}export class ${className}${extendsClause} {
${fields ? fields + "\n" : ""}${ctorContent}${methodsContent}
}
`.trimStart();

    const outPath = path.join(baseDir, filename);
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, content, "utf-8");
    console.log(`✅ Created ${outPath}`);
  }

  // === Main Entry Point ===
  if (mainBlocks.length > 0) {
    const mainContent = mainBlocks.join("\n\n");
    const allNames = new Set([...classNames, ...interfaceNames, ...typeNames]);
    const imports = [];

    // Simple heuristic: if a word in the main block matches a class/type/interface name, import it.
    for (const name of allNames) {
      if (new RegExp(`\\b${name}\\b`).test(mainContent)) {
        // Find the file for classes (nodes), otherwise use name.ts
        let fileName = name + ".ts";
        for (const node of Object.values(nodes)) {
          if (path.basename(node.file, path.extname(node.file)) === name) {
            fileName = node.file;
            break;
          }
        }

        let relPath = fileName.replace(/\\/g, "/");
        if (!relPath.startsWith(".")) relPath = "./" + relPath;
        relPath = stripTs(relPath);

        if (interfaceNames.has(name) || typeNames.has(name)) {
          imports.push(`import type { ${name} } from "${relPath}";`);
        } else {
          imports.push(`import { ${name} } from "${relPath}";`);
        }
      }
    }

    const finalContent = `${imports.join("\n")}\n\n${mainContent}\n`;
    const outPath = path.join(baseDir, "main.ts");
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, finalContent, "utf-8");
    console.log(`✅ Created ${outPath}`);
  }
}

/**
 * Converts a string to PascalCase.
 * @param {string} str
 * @returns {string}
 */
function toPascalCase(str) {
  return str.replace(/[-_](.)/g, (_, c) => c.toUpperCase()).replace(/^\w/, (c) => c.toUpperCase());
}

/**
 * Generates class files from a flowchart definition.
 * @param {string} definition
 * @param {string} [outDir="./out"]
 */
export function generateFromFlowchart(definition, outDir = "./out") {
  const parsed = parseFlowchart(definition);
  generateFiles(outDir, parsed);
}
