import { Entity } from "./Entity";
import { Weapon } from "./Weapon";
import { Inventory } from "./Inventory";
import type { Stats } from "./Stats";

export class Player extends Entity {
  stats: Stats;

  constructor(stats: Stats) {
    super();
    this.stats = stats;
  }

  public attack(target: Enemy): number {
    if (!this.isAlive) { console.log(this.name + " can't attack - they are defeated!"); return 0; }
    const baseDamage = this.stats.strength * 1.5;
    const weaponBonus = this.weapon ? this.weapon.damage : 0;
    const damage = Math.floor(baseDamage + weaponBonus);
    target.health -= damage;
    if (target.health <= 0) { target.isAlive = false; }
    console.log(this.name + " attacks " + target.name + " for " + damage + " damage! (" + target.name + " has " + Math.max(0, target.health) + " HP left)");
    return damage;
  }

  public gainExperience(amount: number): void {
    this.experience += amount;
    const xpToLevel = this.level * 100;
    if (this.experience >= xpToLevel) {
    this.level++;
    this.experience = 0;
    this.stats.strength += 2;
    this.stats.defense += 1;
    console.log(this.name + " leveled up to level " + this.level + "!");
    }
  }
}
