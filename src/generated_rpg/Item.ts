export class Item {
  name: string;
  description: string;
  value: number;
  quantity: number;

  constructor(name: string, description: string, value: number, quantity: number) {
    this.name = name;
    this.description = description;
    this.value = value;
    this.quantity = quantity;
  }

}
