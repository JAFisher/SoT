import { Player } from "./Player";
import { Enemy } from "./Enemy";
import { Weapon } from "./Weapon";
import { Inventory } from "./Inventory";
import { Item } from "./Item";

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
