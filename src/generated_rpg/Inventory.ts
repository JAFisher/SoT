import { Item } from "./Item";

export class Inventory {
  items: Item[];
  capacity: number;

  constructor(items: Item[], capacity: number) {
    this.items = items;
    this.capacity = capacity;
  }

  public addItem(item: Item): boolean {
    if (this.items.length >= this.capacity) {
    console.log("Inventory full! Could not add " + item.name);
    return false;
    }
    this.items.push(item);
    console.log("Added " + item.name + " x" + item.quantity + " to inventory.");
    return true;
  }

  public removeItem(itemName: string): boolean {
    const index = this.items.findIndex((i) => i.name === itemName);
    if (index === -1) { console.log(itemName + " not found in inventory."); return false; }
    this.items.splice(index, 1);
    console.log(itemName + " removed from inventory.");
    return true;
  }
}
