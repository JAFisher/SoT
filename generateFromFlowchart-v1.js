import fs from "fs";
import path from "path";

/**
 * Parses a flowchart definition string to extract nodes, composition edges,
 * inheritance edges, and method definitions, as well as new types and interfaces.
 * @param {string} definition The flowchart definition string.
 * @returns {{nodes: object, compositionEdges: Array<Array<string>>, extendsEdges: Array<{childId: string, parentId: string}>, methods: object, types: object, interfaces: object}}
 */
function parseFlowchart(definition) {
  const compositionEdges = [];
  const extendsEdges = [];
  const nodes = {};
  const methods = {};
  const types = {};
  const interfaces = {};

  const lines = definition
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("graph"));

  // Regex to match a node with optional properties
  const nodePattern = /(\w+)\[([^\]{]+)(?:\{([^}]+)\})?\]/;
  // Regex to match a method with optional parameters and return type.
  const methodPattern = /@(\w+)\.([^\{]+)(?:\{([^}]+)\})?:\s*(.+)/;
  // Regex to match a method code block start
  const methodCodeStartPattern = /@@(\w+)\.([^\{]+)\.code/;
  // Regex to match a method code block end
  const methodCodeEndPattern = /@@(\w+)\.([^\{]+)\.end/;
  // Regex for new type definition
  const typePattern = /type->(\w+)\s*\{([^}]+)\}/;
  // Regex for new interface definition
  const interfacePattern = /interface->(\w+)\s*\{([^}]+)\}/;

  /**
   * Helper function to add or update a node in the nodes object.
   * Ensures the ID and filename are correctly associated.
   * @param {string} id The node's ID (e.g., A, B, C).
   * @param {string} file The node's filename (e.g., Order.ts).
   * @param {string} [props] The properties string for the node.
   */
  function addNode(id, file, props) {
    if (!nodes[id]) {
      nodes[id] = { file: file.trim(), props: parseProps(props) };
    } else {
      // If the node already exists, update its file and props if they are defined
      nodes[id].file = file.trim();
      if (props) {
        nodes[id].props = parseProps(props);
      }
    }
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Check for new type definition
    const typeMatch = line.match(typePattern);
    if (typeMatch) {
      const [, typeName, props] = typeMatch;
      types[typeName] = parseProps(props);
      continue;
    }

    // Check for new interface definition
    const interfaceMatch = line.match(interfacePattern);
    if (interfaceMatch) {
      const [, interfaceName, props] = interfaceMatch;
      interfaces[interfaceName] = parseProps(props);
      continue;
    }

    // Check for inheritance relationship: A[...]---|>B[...]
    const extendsMatch = line.match(new RegExp(`^${nodePattern.source}\\s*---\\|>\\s*${nodePattern.source}\\s*;?$`));
    if (extendsMatch) {
      const [, childId, childFile, childProps, parentId, parentFile, parentProps] = extendsMatch;
      addNode(childId, childFile, childProps);
      addNode(parentId, parentFile, parentProps);
      extendsEdges.push({ childId, parentId });
      continue;
    }

    // Check for method definition: @Class.method{param:type}: returnType
    const methodMatch = line.match(new RegExp(`^${methodPattern.source}`));
    if (methodMatch) {
      const [, className, methodName, params, returnType] = methodMatch;
      if (!methods[className]) {
        methods[className] = {};
      }
      methods[className][methodName] = { params: parseProps(params), returnType: returnType.trim() };
      continue;
    }

    // Handle method code blocks with explicit end tags
    const methodCodeStartMatch = line.match(new RegExp(`^${methodCodeStartPattern.source}`));
    if (methodCodeStartMatch) {
      const [, className, methodName] = methodCodeStartMatch;
      let codeBlock = "";
      i++;
      while (i < lines.length && !lines[i].match(new RegExp(`^${methodCodeEndPattern.source}`))) {
        codeBlock += lines[i] + "\n";
        i++;
      }

      if (methods[className] && methods[className][methodName]) {
        methods[className][methodName].code = codeBlock.trim();
      }
      continue;
    }

    // Check for composition relationship: A[...]-->B[...] or A[...]{...}
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

  return { nodes, compositionEdges, extendsEdges, methods, types, interfaces };
}

/**
 * Parses a string of properties into an array of objects.
 * @param {string} propStr The properties string (e.g., "name:string,age:number").
 * @returns {Array<{name: string, type: string}>}
 */
function parseProps(propStr) {
  if (!propStr) return [];
  return propStr.split(",").map((p) => {
    const [name, type] = p.split(":").map((s) => s.trim());
    return { name, type: type || "any" };
  });
}

/**
 * Generates the class files based on the parsed flowchart data.
 * @param {string} baseDir The base directory to create files in.
 * @param {{nodes: object, compositionEdges: Array<Array<string>>, extendsEdges: Array<{childId: string, parentId: string}>, methods: object, types: object, interfaces: object}} parsedData The parsed flowchart data.
 */
function generateFiles(baseDir, { nodes, compositionEdges, extendsEdges, methods, types, interfaces }) {
  // Create a set of all definable class names for easy lookup
  const classNames = new Set(Object.values(nodes).map((n) => path.basename(n.file, path.extname(n.file))));

  // Generate type files
  for (const [typeName, props] of Object.entries(types)) {
    const filename = `${typeName}.ts`;
    const fields = props.map((p) => `  ${p.name}: ${p.type};`).join("\n");
    const content = `export type ${typeName} = {\n${fields}\n};`;
    const outPath = path.join(baseDir, filename);
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, content, "utf-8");
    console.log(`✅ Created type file ${outPath}`);
  }

  // Generate interface files
  for (const [interfaceName, props] of Object.entries(interfaces)) {
    const filename = `${interfaceName}.ts`;
    const customImports = new Set();
    const fields = props
      .map((p) => {
        const typeToCheck = p.type.match(/Array<(\w+)>/)?.[1] || p.type;

        if (types[typeToCheck]) {
          customImports.add(typeToCheck);
        }
        if (classNames.has(typeToCheck)) {
          customImports.add(typeToCheck);
        }
        return `  ${p.name}: ${p.type};`;
      })
      .join("\n");

    const customImportStatements = Array.from(customImports)
      .map((name) => {
        const importPath = `./${name}.ts`;
        return `import { ${name} } from "${importPath}";`;
      })
      .join("\n");

    const imports = customImportStatements.length > 0 ? customImportStatements + "\n" : "";

    const content = `
${imports}
export interface ${interfaceName} {\n${fields}\n}
    `.trimStart();
    const outPath = path.join(baseDir, filename);
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, content, "utf-8");
    console.log(`✅ Created interface file ${outPath}`);
  }

  // Generate class files
  for (const [id, { file: filename, props }] of Object.entries(nodes)) {
    const className = toPascalCase(path.basename(filename, path.extname(filename)));

    const parentRelationship = extendsEdges.find((r) => r.childId === id);
    let extendsClause = "";
    let parentImport = "";
    let superCall = "";
    const customImports = new Set();

    if (parentRelationship) {
      const parentId = parentRelationship.parentId;
      const parentFile = nodes[parentId].file;
      const parentClassName = toPascalCase(path.basename(parentFile, path.extname(parentFile)));

      // Calculate the correct relative path for the parent class import
      let parentPath = path.relative(path.dirname(filename), parentFile).replace(/\\/g, "/");
      if (!parentPath.startsWith(".")) {
        parentPath = "./" + parentPath;
      }

      extendsClause = ` extends ${parentClassName}`;
      parentImport = `import { ${parentClassName} } from "${parentPath}";`;
      superCall = `      super();\n`;
    }

    const compositionImports = compositionEdges
      .filter(([from]) => from === id)
      .map(([_, to]) => {
        const depFile = nodes[to].file;
        const depClass = toPascalCase(path.basename(depFile, path.extname(depFile)));

        // Calculate the correct relative path for the composition import
        let depPath = path.relative(path.dirname(filename), depFile).replace(/\\/g, "/");
        if (!depPath.startsWith(".")) {
          depPath = "./" + depPath;
        }

        return `import { ${depClass} } from "${depPath}";`;
      })
      .join("\n");

    // Check for custom types and interfaces in properties
    for (const prop of props) {
      if (types[prop.type]) {
        customImports.add(prop.type);
      }
      if (interfaces[prop.type]) {
        customImports.add(prop.type);
      }
    }

    // Check for custom types and interfaces in methods
    if (methods[className]) {
      for (const methodName in methods[className]) {
        const methodData = methods[className][methodName];
        if (types[methodData.returnType]) {
          customImports.add(methodData.returnType);
        }
        if (interfaces[methodData.returnType]) {
          customImports.add(methodData.returnType);
        }
        for (const param of methodData.params) {
          if (types[param.type]) {
            customImports.add(param.type);
          }
          if (interfaces[param.type]) {
            customImports.add(param.type);
          }
        }
      }
    }

    // Generate custom imports
    const customImportStatements = Array.from(customImports)
      .map((name) => {
        const importPath = `./${name}.ts`;
        return `import { ${name} } from "${importPath}";`;
      })
      .join("\n");

    const imports = [parentImport, compositionImports, customImportStatements].filter(Boolean).join("\n");

    // Class properties
    const fields = props.map((p) => `  ${p.name}: ${p.type};`).join("\n");

    // Method generation
    let methodsContent = "";
    if (methods[className]) {
      methodsContent = Object.entries(methods[className])
        .map(([methodName, methodData]) => {
          const params = methodData.params.map((p) => `${p.name}: ${p.type}`).join(", ");
          const returnType = methodData.returnType || "any";
          const methodBody = methodData.code ? methodData.code : "// TODO: Add method logic here";

          return `
  public ${methodName}(${params}): ${returnType} {
    ${methodBody}
  }`;
        })
        .join("\n");
    }

    // Constructor assigns defaults (optional)
    const ctorParams = props.map((p) => `${p.name}: ${p.type}`).join(", ");
    const ctorBody = props.map((p) => `      this.${p.name} = ${p.name};`).join("\n");

    const content = `
${imports}

export class ${className}${extendsClause} {
${fields ? fields + "\n" : ""}
  constructor(${ctorParams}) {
${superCall}${ctorBody || "      // init here"}
  }
${methodsContent}
}
    `.trimStart();

    const outPath = path.join(baseDir, filename);
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, content, "utf-8");
    console.log(`✅ Created ${outPath}`);
  }
}

/**
 * Converts a string to PascalCase.
 * @param {string} str The string to convert.
 * @returns {string} The PascalCase string.
 */
function toPascalCase(str) {
  return str.replace(/[-_](.)/g, (_, c) => c.toUpperCase()).replace(/^\w/, (c) => c.toUpperCase());
}

/**
 * Generates class files from a flowchart definition.
 * @param {string} definition The flowchart definition string.
 * @param {string} [outDir="./out"] The output directory.
 */
export function generateFromFlowchart(definition, outDir = "./out") {
  const parsed = parseFlowchart(definition);
  generateFiles(outDir, parsed);
}
