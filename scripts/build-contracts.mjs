// Regenerates contracts/palettes.json from jig-theme's theme files. `--check` fails if it is stale.
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
const root = path.resolve(import.meta.dirname, "..");
const themes = path.join(root, "plugins/jig-theme/themes");
const file = path.join(root, "contracts/palettes.json");
const palettes = Object.fromEntries(
    readdirSync(themes)
        .sort()
        .map((name) => [name, JSON.parse(readFileSync(path.join(themes, name), "utf8"))]),
);
const text = `${JSON.stringify(palettes, null, 4)}\n`;
if (process.argv.includes("--check")) {
    if (readFileSync(file, "utf8") !== text) {
        console.error("contracts/palettes.json is stale: run node scripts/build-contracts.mjs");
        process.exit(1);
    }
    console.log("contracts/palettes.json is current");
} else {
    writeFileSync(file, text);
    console.log(`wrote ${Object.keys(palettes).length} palettes`);
}
