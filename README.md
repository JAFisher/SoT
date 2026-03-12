# SoT Engine (Single Oriented Transformation)

Design systems as blueprints. Deploy them as code.
The SoT Engine is a powerful system architect tool that transforms a custom, Mermaid-inspired flowchart syntax into a fully-functional, structured TypeScript ecosystem. Define your architecture, relationships, and logic in a single text file, and watch SoT generate the boilerplate, folder structure, and package.json instantly.

🚀 Why SoT?
Visual-First Development: Design your system architecture in text, and let the engine handle the file system.

Boilerplate Zero: Generates classes, recursive imports, type-safe constructors, and package configurations automatically.

Modular Microservices: Scale from a single script to a complex microservice architecture using include-> namespaces.

Tool Agnostic: Use tsx, bun, deno, or ts-node by overriding the CLI execution layer.

## Features

- **Class Generation**: Define classes with properties and methods.
- **Inheritance & Composition**: Model relationships between your entities.
- **Type & Interface Support**: Define data structures and contracts.
- **Modular Flow Includes**: Reuse flow definitions across services with recursive `include->`.
- **External Dependencies**: Integration with NPM packages and Node built-ins via `extern->`.
- **Async Support**: Native `@async` keyword for methods and main blocks.
- **Folder-Based Namespacing**: Automatic isolation of included components into subdirectories.
- **Custom Logic**: Inject real code blocks directly into your generated methods and constructors.
- **Automated Constructors**: Automatically generates constructors based on class properties.

## Getting Started

### Installation

Ensure you have [Node.js](https://nodejs.org/) installed, then install the dependencies:

```bash
npm install
```

### Basic Usage

Import the generator and pass a flowchart string and an output directory:

```javascript
import { generateFromFlowchart } from "./generateFromFlowchart.js";

const flow = `
graph TD
  User[User.ts{name: string, age: number}]
`;

generateFromFlowchart(flow, "./src/generated");
```

## Microservices Runner (`build.js`)

For larger projects, you can organize your system into multiple independent microservices using `.flow` files.

### 1. The `flows/` Directory
Place your flowchart definitions in the `./flows` directory with a `.flow` extension (e.g., `auth.flow`, `orders.flow`).

### 2. Recursive Includes
You can include other flow files to create a modular design system.

**Syntax:** `include->shared.flow`

This will merge the definitions from `shared.flow` into your current service. Included components are isolated into their own subdirectories (e.g., `src/service/shared/`) to prevent name clashes.

### 3. Building Services
Run the `build.js` script to scan the `flows/` directory and generate code for each service:

```bash
npm run build # or node build.js
```

This will:
- Create a corresponding directory in `./src/` for each `.flow` file.
- Generate all classes, types, and the `main.ts` entry point for that service.
- Resolve relative paths and imports automatically.

### 4. Running a Service
Generated services can be run directly using the generated `npm` scripts or `tsx`:

```bash
npm run run:auth # Example script in package.json
# or
npx tsx ./src/auth/main.ts
```

## Syntax Guide

The generator uses a custom syntax that extends Mermaid flowchart definitions.

### 1. Nodes (Classes)
Nodes define classes and the files they will be generated in.

**Syntax:** `ID[FileName.ts{prop1: type, prop2: type}]`

- **ID**: A unique internal identifier (e.g., `A`, `User`).
- **FileName.ts**: The name of the file to be created.
- **Properties**: Optional properties defined inside curly braces `{}`.

### 2. Relationships

#### Inheritance (Extends)
**Syntax:** `ChildID ---|> ParentID`

This creates a class extension: `class Child extends Parent`.

#### Composition (Imports)
**Syntax:** `FromID --> ToID`

This adds an import statement in the `From` class referencing the `To` class.

### 3. Types and Interfaces
You can define standalone TypeScript types and interfaces.

**Syntax:**
- `type->TypeName{prop: type, ...}`
- `interface->InterfaceName{prop: type, ...}`

### 4. External Dependencies
Import NPM packages or Node.js built-ins directly into your flow.

**Syntax:** `extern->LibName from "package-name"`

Example:
```text
extern->chalk from "chalk"
extern->fs from "node:fs"
```

The generator automatically adds these to the generated `package.json` and manages imports in `main.ts`.

### 5. Asynchronous Support
Mark methods or main blocks as asynchronous using the `@async` keyword.

**Syntax:** `@async @ClassName.MethodName...`

### 6. Methods and Logic

#### Method Signatures
**Syntax:** `[@async] @ClassName.MethodName{param: type}: ReturnType`

#### Custom Code Blocks
To add logic to a method or constructor, use code blocks:

```text
@@ClassName.MethodName.code
  // Your TypeScript logic here
  console.log("Hello World");
@@ClassName.MethodName.end
```

> [!NOTE] 
> Use `constructor` as the MethodName to override or extend the default constructor logic. Use `@@` for the start and end of code blocks.

### 7. Main Entry Point (`@@main`)
You can define a `main` entry point directly in the flowchart. The generator will create a `main.ts` file in the output directory with **automatic imports** for any classes, types, or interfaces referenced in your code.

**Syntax:**
```text
[@async] @@main.code
  // TypeScript code that uses your generated classes
  const player = new Player();
  await player.load();
@@main.end
```

> [!TIP]
> Since the `@@main.code` block lives inside a JavaScript template literal in your generator script, avoid using backticks or `${}` inside it. Use string concatenation (`"Hi " + name`) instead.

## Full Example

```javascript
const flow = `
graph TD
  A[BaseService.ts{apiEndpoint: string}] ---|> B[OrderProcessing.ts];
  B[OrderProcessing.ts] --> C[Order.ts];
  
  type->Order{orderId: string, totalAmount: number}

  @OrderProcessing.processOrder{order: Order}: boolean
  @@OrderProcessing.processOrder.code
      console.log(\`Processing: \${order.orderId}\`);
      return true;
  @@OrderProcessing.processOrder.end
`;
```

The generated files will appear in the specified directory (e.g., `./src/generated` or `./src/auth`).

## Using the Generated Code

The generator creates TypeScript (`.ts`) files. To use them in a project, you have two main options:

### 1. In a TypeScript Project
If your project is already set up with TypeScript, you can simply import the generated classes:

```typescript
import { User } from "./src/generated/User";

const user = new User("Alice", 30);
```

### 2. In a Node.js (JavaScript) Project
To run the generated code directly in Node.js, you should use a runner like `tsx` or `ts-node` that handles TypeScript on the fly:

```bash
npx tsx run-rpg.js
```

Or transpile them to JavaScript using `tsc`.

> [!TIP]
> Check out `run-rpg.js` for a complete example of how to instantiate and link the generated RPG classes together in a simulation!

## Full Example (Modular System)

**flows/db.flow**:
```text
type->User {id: number, username: string}
DB[Database.ts]
@Database.connect: void
```

**flows/app.flow**:
```text
include->db.flow
App[App.ts]
App --> DB

@async @@main.code
  const db = new Database();
  db.connect();
  console.log("App started");
@@main.end
```

## Compiling for the Web in mind

Compiling your work for the web, using the Rollup bundler:
```text
  Rollup->{Board.ts, Tetromino.ts, Lighting.ts, ThreeApp.ts}
```

Will make a compiled.js file in the same directory with the files that are compiled so you can include them in a web project.

## Static Files and Assets

If your `.flow` file requires static assets (images, fonts, etc.) or a `public` directory (e.g., third-party scripts, `index.html`), place an `assets/` or `public/` folder next to your `.flow` file inside the `flows/[service-name]/` directory. 

The `build.js` microservices runner will automatically copy these folders to your service's output directory (`src/[service-name]/[flow-name]/assets/` and `src/[service-name]/[flow-name]/public/`) during the build process, enabling seamless inclusion in web projects.

---
*Generated by the SoT Partner Engine.*
