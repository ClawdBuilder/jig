// The package version is one fact in five places users see: package.json, package-lock.json, the two files of the Claude Code
// plugin (`.claude-plugin/plugin.json` and `marketplace.json`) and install examples. A historical sentence such as "the 0.4.2
// floor" is not an install example and is left alone.
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(process.env.JIG_VERSION_PINS_ROOT ?? path.join(import.meta.dirname, ".."));
const parse = (text) => text.split(".").map(Number);
const older = (a, b) => {
    const left = parse(a);
    const right = parse(b);
    for (let index = 0; index < 3; index++)
        if ((left[index] ?? 0) !== (right[index] ?? 0)) return (left[index] ?? 0) < (right[index] ?? 0);
    return false;
};
function walk(dir, out = []) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === "node_modules" || entry.name === ".git") continue;
        const file = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(file, out);
        else if (entry.name.endsWith(".md")) out.push(file);
    }
    return out;
}

const manifest = JSON.parse(readFileSync(path.join(ROOT, "package.json"), "utf8"));
const lock = JSON.parse(readFileSync(path.join(ROOT, "package-lock.json"), "utf8"));
const failures = [];
if (lock.version !== manifest.version)
    failures.push(`package-lock.json version ${lock.version} differs from package.json ${manifest.version}`);
const locked = lock.packages?.[""]?.version;
if (locked !== manifest.version)
    failures.push(`package-lock.json packages[""] version ${locked} differs from package.json ${manifest.version}`);

/** Each file of the Claude Code plugin, and the versions it names: the plugin's own, or each plugin the marketplace lists. */
const PLUGIN_FILES = [
    [".claude-plugin/plugin.json", (json) => [json.version]],
    [
        ".claude-plugin/marketplace.json",
        (json) => (Array.isArray(json.plugins) ? json.plugins.map((one) => one?.version) : []),
    ],
];
for (const [rel, versionsOf] of PLUGIN_FILES) {
    let versions;
    try {
        versions = versionsOf(JSON.parse(readFileSync(path.join(ROOT, rel), "utf8")));
    } catch {
        failures.push(`${rel} is missing or is not JSON`);
        continue;
    }
    if (versions.length === 0) failures.push(`${rel} names no version`);
    for (const version of versions) {
        if (version !== manifest.version)
            failures.push(`${rel} version ${version} differs from package.json ${manifest.version}`);
    }
}

for (const file of [path.join(ROOT, "README.md"), ...walk(path.join(ROOT, "docs"))]) {
    const text = readFileSync(file, "utf8");
    const rel = path.relative(ROOT, file);
    for (const [index, line] of text.split("\n").entries()) {
        for (const match of line.matchAll(/@clawdbuilder\/jig@(\d+\.\d+\.\d+)/g)) {
            if (older(match[1], manifest.version))
                failures.push(`${rel}:${index + 1} install example pins ${match[1]}, older than ${manifest.version}`);
        }
        for (const match of line.matchAll(/Jig — (\d+\.\d+\.\d+)/g)) {
            if (match[1] !== manifest.version)
                failures.push(
                    `${rel}:${index + 1} captured Jig — ${match[1]} but package.json is ${manifest.version}; re-capture the doctor block`,
                );
        }
        if (/\b(npm install|pi install)\b/.test(line)) {
            for (const match of line.matchAll(/(?<![\w./-])@(\d+\.\d+\.\d+)/g)) {
                if (older(match[1], manifest.version))
                    failures.push(
                        `${rel}:${index + 1} install example pins ${match[1]}, older than ${manifest.version}`,
                    );
            }
        }
    }
}
for (const failure of failures) console.log(`fail ${failure}`);
console.log(`version pins: ${failures.length} failures`);
process.exit(failures.length === 0 ? 0 : 1);
