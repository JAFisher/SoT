# Flowchart Code Generator

A powerful utility that transforms a custom Mermaid-inspired flowchart syntax into structured TypeScript classes, interfaces, and types. This tool allows you to design your system architecture visually (in text) and generate the boilerplate code instantly.

## Features

- **Class Generation**: Define classes with properties and methods.
- **Inheritance & Composition**: Model relationships between your entities.
- **Type & Interface Support**: Define data structures and contracts.
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

### 4. Methods and Logic

#### Method Signatures
**Syntax:** `@ClassName.MethodName{param: type}: ReturnType`

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

### 5. Main Entry Point (`@@main`)
You can define a `main` entry point directly in the flowchart. The generator will create a `main.ts` file in the output directory with **automatic imports** for any classes, types, or interfaces referenced in your code.

**Syntax:**
```text
@@main.code
  // TypeScript code that uses your generated classes
  const player = new Player();
  player.attack(enemy);
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

## Running the Generator

Simply execute your script with Node.js:

```bash
node index.js
```

The generated files will appear in the specified directory (e.g., `./src/generated`).

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
