import { generateFromFlowchart } from "./generateFromFlowchart.js";

// NOTE: The ---|> arrow means "child extends parent", so the LEFT side is the child.
//   ChildClass[Child.ts] ---|> ParentClass[Parent.ts]
//
// NOTE: Template literals (backticks + ${}) cannot be used inside code blocks
//   because the entire flowchart lives in a JS template literal.
//   Use string concatenation instead: "Hello " + name
const rpgFlow = `
graph TD
  %% ---- Base Class ----
  Entity[Entity.ts{id: string, name: string, health: number, isAlive: boolean}]

  %% ---- Inheritance: Player and Enemy extend Entity ----
  Player[Player.ts{level: number, experience: number, weapon: Weapon, inventory: Inventory}] ---|> Entity[Entity.ts];
  Enemy[Enemy.ts{lootTable: string[], stats: Stats}] ---|> Entity[Entity.ts];

  %% ---- Composition ----
  Player[Player.ts{stats: Stats}] --> Weapon[Weapon.ts{name: string, damage: number, type: string}];
  Player[Player.ts] --> Inventory[Inventory.ts{items: Item[], capacity: number}];
  Inventory[Inventory.ts] --> Item[Item.ts{name: string, description: string, value: number, quantity: number}];

  %% ---- Types and Interfaces ----
  type->Stats{strength: number, agility: number, intelligence: number, defense: number}
  interface->IActivatable{cooldown: number, lastUsed: number}

  %% ---- Entity Constructor ----
  @@Entity.constructor.code
    this.id = Math.random().toString(36).substr(2, 9);
    this.health = 100;
    this.isAlive = true;
    console.log("Entity " + this.name + " created with ID: " + this.id);
  @@Entity.constructor.end

  %% ---- Player: attack method ----
  @Player.attack{target: Enemy}: number
  @@Player.attack.code
    if (!this.isAlive) { console.log(this.name + " can't attack - they are defeated!"); return 0; }
    const baseDamage = this.stats.strength * 1.5;
    const weaponBonus = this.weapon ? this.weapon.damage : 0;
    const damage = Math.floor(baseDamage + weaponBonus);
    target.health -= damage;
    if (target.health <= 0) { target.isAlive = false; }
    console.log(this.name + " attacks " + target.name + " for " + damage + " damage! (" + target.name + " has " + Math.max(0, target.health) + " HP left)");
    return damage;
  @@Player.attack.end

  %% ---- Player: gainExperience method ----
  @Player.gainExperience{amount: number}: void
  @@Player.gainExperience.code
    this.experience += amount;
    const xpToLevel = this.level * 100;
    if (this.experience >= xpToLevel) {
      this.level++;
      this.experience = 0;
      this.stats.strength += 2;
      this.stats.defense += 1;
      console.log(this.name + " leveled up to level " + this.level + "!");
    }
  @@Player.gainExperience.end

  %% ---- Enemy: AI turn ----
  @Enemy.takeTurn{target: Player}: void
  @@Enemy.takeTurn.code
    if (!this.isAlive) { return; }
    const damage = Math.floor(this.stats.strength * 0.8);
    const mitigated = Math.max(0, damage - target.stats.defense);
    target.health -= mitigated;
    if (target.health <= 0) { target.isAlive = false; }
    console.log(this.name + " attacks " + target.name + " for " + mitigated + " damage! (" + target.name + " has " + Math.max(0, target.health) + " HP left)");
  @@Enemy.takeTurn.end

  %% ---- Enemy: drop loot ----
  @Enemy.dropLoot{}: string
  @@Enemy.dropLoot.code
    if (this.lootTable.length === 0) { return "nothing"; }
    const loot = this.lootTable[Math.floor(Math.random() * this.lootTable.length)];
    return loot;
  @@Enemy.dropLoot.end

  %% ---- Inventory: addItem ----
  @Inventory.addItem{item: Item}: boolean
  @@Inventory.addItem.code
    if (this.items.length >= this.capacity) {
      console.log("Inventory full! Could not add " + item.name);
      return false;
    }
    this.items.push(item);
    console.log("Added " + item.name + " x" + item.quantity + " to inventory.");
    return true;
  @@Inventory.addItem.end

  %% ---- Inventory: removeItem ----
  @Inventory.removeItem{itemName: string}: boolean
  @@Inventory.removeItem.code
    const index = this.items.findIndex((i) => i.name === itemName);
    if (index === -1) { console.log(itemName + " not found in inventory."); return false; }
    this.items.splice(index, 1);
    console.log(itemName + " removed from inventory.");
    return true;
  @@Inventory.removeItem.end

  %% ---- Main Entry Point ----
  @@main.code
  async function startBattle() {
    console.log("=== RPG Battle Simulation (Auto-Generated) ===");

    const player = new Player();
    player.name = "Hero";
    player.level = 1;
    player.experience = 0;
    player.stats = { strength: 15, agility: 10, intelligence: 8, defense: 5 };

    const sword = new Weapon();
    sword.name = "Excalibur";
    sword.damage = 10;
    sword.type = "sword";
    player.weapon = sword;

    const inventory = new Inventory();
    inventory.capacity = 10;
    inventory.items = [];
    player.inventory = inventory;

    const enemy = new Enemy();
    enemy.name = "Goblin King";
    enemy.stats = { strength: 12, agility: 5, intelligence: 2, defense: 2 };
    enemy.lootTable = ["Gold Coin", "Old Dagger", "Health Potion"];

    console.log("Starting Health:");
    console.log(player.name + " (Lvl " + player.level + "): " + player.health + " HP");
    console.log(enemy.name + ": " + enemy.health + " HP");
    console.log("");

    let round = 1;
    while (player.isAlive && enemy.isAlive && round <= 10) {
      console.log("--- Round " + round + " ---");
      player.attack(enemy);
      if (enemy.isAlive) { enemy.takeTurn(player); }
      round++;
    }

    console.log("");
    if (!enemy.isAlive) {
      const loot = enemy.dropLoot();
      console.log("Victory! " + player.name + " defeated " + enemy.name + "!");
      console.log(enemy.name + " dropped: " + loot);
      player.gainExperience(150);
      const healthPotion = new Item();
      healthPotion.name = "Health Potion";
      healthPotion.description = "Restores 50 HP";
      healthPotion.value = 25;
      healthPotion.quantity = 3;
      player.inventory.addItem(healthPotion);
    } else if (!player.isAlive) {
      console.log("Defeat! " + player.name + " was slain by " + enemy.name + ".");
    } else {
      console.log("Battle ended after " + (round - 1) + " rounds.");
    }
  }
  startBattle();
  @@main.end
`;

console.log("Generating RPG Battle System (with main.ts)...");
generateFromFlowchart(rpgFlow, "./src/generated_rpg");
console.log("Done! Run: npx tsx ./src/generated_rpg/main.ts");
