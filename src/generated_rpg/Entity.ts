export class Entity {
  id: string;
  name: string;
  health: number;
  isAlive: boolean;

  constructor() {
    this.id = Math.random().toString(36).substr(2, 9);
    this.health = 100;
    this.isAlive = true;
    console.log("Entity " + this.name + " created with ID: " + this.id);
  }

}
