// This script defines a sample flowchart for an e-commerce order processing system.
// Use this definition with the class generator to see how the tool handles
// composition, inheritance, and custom types.
// To run this, save the file and execute it with Node.js.

import { generateFromFlowchart } from "./generateFromFlowchart.js";

const flow = `
graph TD
  A[BaseService.ts{apiEndpoint: string}] ---|> B[OrderProcessing.ts];
  B[OrderProcessing.ts] --> C[Order.ts];
  C[Order.ts] --> D[LineItem.ts];
  D[LineItem.ts] --> E[Product.ts];
  F[OrderStatus.ts{status: string}] --> B[OrderProcessing.ts];

  type->Order{orderId: string, items: LineItem[], totalAmount: number}
  type->LineItem{productId: string, quantity: number, price: number}
  type->Product{productId: string, name: string, price: number}


  type->OrderStatus{status: string}

  @@OrderProcessing.constructor.code
    super();
    console.log("OrderProcessing service initialized.");
  @@OrderProcessing.constructor.end
  
  @OrderProcessing.processOrder{order: Order}: boolean
  @@OrderProcessing.processOrder.code
      // A simple method to simulate order processing.
      console.log(\`Processing order: \${order.orderId}\`);
      // In a real-world scenario, this would have more complex logic.
      return true;
  @@OrderProcessing.processOrder.end
`;

generateFromFlowchart(flow, "./src/generated");
