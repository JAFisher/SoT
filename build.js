import { readdir, readFile } from "fs/promises";
import { existsSync, mkdirSync, cpSync } from "fs";
import path from "path";
import { generateFromFlowchart } from "./generateFromFlowchart.js";

const FLOWS_DIR = "./flows";
const OUT_DIR = "./src";

async function build() {
    console.log("🔨 Flow Builder — scanning " + FLOWS_DIR + " for .flow files...\n");

    if (!existsSync(FLOWS_DIR)) {
        console.error("❌ No flows/ directory found. Create it and add .flow files.");
        process.exit(1);
    }

    const items = await readdir(FLOWS_DIR, { withFileTypes: true });
    const folders = items.filter(item => item.isDirectory());

    if (folders.length === 0) {
        console.warn("⚠️  No folders found in " + FLOWS_DIR + "/");
        process.exit(0);
    }

    const results = { success: [], failed: [] };

    for (const folder of folders) {
        const folderName = folder.name;
        const folderPath = path.join(FLOWS_DIR, folderName);

        const folderItems = await readdir(folderPath, { withFileTypes: true });
        const flowFiles = folderItems.filter(f => f.isFile() && f.name.endsWith(".flow"));

        if (flowFiles.length === 0) {
            console.warn("⚠️  No .flow files found in " + folderPath + "/");
            continue;
        }

        for (const file of flowFiles) {
            const serviceName = path.basename(file.name, ".flow");
            const flowPath = path.join(folderPath, file.name);
            const outPath = path.join(OUT_DIR, folderName, serviceName);

            try {
                const content = await readFile(flowPath, "utf-8");
                console.log("📦 Building flow:  " + serviceName + " (in " + folderName + ")");
                console.log("   Source:  " + flowPath);
                console.log("   Output:  " + outPath);

                mkdirSync(outPath, { recursive: true });
                generateFromFlowchart(content, outPath, folderPath);

                // Tier 1: Shared Tier (category level)
                // e.g., flows/twitter/public/ -> src/twitter/server/public/
                const sharedAssets = path.join(folderPath, "assets");
                if (existsSync(sharedAssets)) {
                    cpSync(sharedAssets, path.join(outPath, "assets"), { recursive: true });
                    console.log(`   Copied shared assets: ${sharedAssets}`);
                }
                const sharedPublic = path.join(folderPath, "public");
                if (existsSync(sharedPublic)) {
                    cpSync(sharedPublic, path.join(outPath, "public"), { recursive: true });
                    console.log(`   Copied shared public: ${sharedPublic}`);
                }

                // Tier 2: Specific Tier (flow-namespaced level)
                // e.g., if serviceName is "server", looks in flows/twitter/server/public/
                const specificAssets = path.join(folderPath, serviceName, "assets");
                if (existsSync(specificAssets)) {
                    cpSync(specificAssets, path.join(outPath, "assets"), { recursive: true });
                    console.log(`   Copied specific assets: ${specificAssets}`);
                }
                const specificPublic = path.join(folderPath, serviceName, "public");
                if (existsSync(specificPublic)) {
                    cpSync(specificPublic, path.join(outPath, "public"), { recursive: true });
                    console.log(`   Copied specific public: ${specificPublic}`);
                }

                results.success.push(`${folderName}/${serviceName}`);
            } catch (err) {
                console.error("❌ Failed to build " + serviceName + " in " + folderName + ": " + err.message);
                results.failed.push(`${folderName}/${serviceName}`);
            }

            console.log("");
        }
    }

    // Summary
    console.log("━".repeat(50));
    console.log("✅ Built:  " + results.success.join(", "));
    if (results.failed.length > 0) {
        console.log("❌ Failed: " + results.failed.join(", "));
    }
    console.log("");
    console.log("📁 Generated services in " + OUT_DIR + "/:");
    for (const name of results.success) {
        console.log("   npx tsx ./" + OUT_DIR + "/" + name + "/main.ts");
    }
}

console.time("build");
await build();
console.timeEnd("build");
