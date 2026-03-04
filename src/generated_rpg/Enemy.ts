import { Entity } from "./Entity";
import type { Stats } from "./Stats";

export class Enemy extends Entity {
  lootTable: string[];
  stats: Stats;

  constructor(lootTable: string[], stats: Stats) {
    super();
    this.lootTable = lootTable;
    this.stats = stats;
  }

  public takeTurn(target: Player): void {
    if (!this.isAlive) { return; }
    const damage = Math.floor(this.stats.strength * 0.8);
    const mitigated = Math.max(0, damage - target.stats.defense);
    target.health -= mitigated;
    if (target.health <= 0) { target.isAlive = false; }
    console.log(this.name + " attacks " + target.name + " for " + mitigated + " damage! (" + target.name + " has " + Math.max(0, target.health) + " HP left)");
  }

  public dropLoot(): any {
    if (this.lootTable.length === 0) { return "nothing"; }
    const loot = this.lootTable[Math.floor(Math.random() * this.lootTable.length)];
    return loot;
  }
}
