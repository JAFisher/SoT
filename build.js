import { readdir, readFile } from "fs/promises";
import { existsSync, mkdirSync } from "fs";
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

    const files = (await readdir(FLOWS_DIR)).filter((f) => f.endsWith(".flow"));

    if (files.length === 0) {
        console.warn("⚠️  No .flow files found in " + FLOWS_DIR + "/");
        process.exit(0);
    }

    const results = { success: [], failed: [] };

    for (const file of files) {
        const serviceName = path.basename(file, ".flow");
        const flowPath = path.join(FLOWS_DIR, file);
        const outPath = path.join(OUT_DIR, serviceName);

        try {
            const content = await readFile(flowPath, "utf-8");
            console.log("📦 Building service:  " + serviceName);
            console.log("   Source:  " + flowPath);
            console.log("   Output:  " + outPath);

            mkdirSync(outPath, { recursive: true });
            generateFromFlowchart(content, outPath);

            results.success.push(serviceName);
        } catch (err) {
            console.error("❌ Failed to build " + serviceName + ": " + err.message);
            results.failed.push(serviceName);
        }

        console.log("");
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
