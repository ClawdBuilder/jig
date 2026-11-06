// Docs that are read as specifications: every plugin README keeps its shape, every local link and anchor resolves, every
// fenced block is tagged, and no install example names a deprecated version. Long paragraphs, cells and READMEs are
// warnings only. No dependency: GitHub's heading slugs are simple enough to compute here.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const DEPRECATED = ["0.4.0", "0.4.1"];
const MAX_PARAGRAPH = 350;
const MAX_CELL = 100;
const MAX_README = 120;

function walk(dir, out = []) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === "node_modules" || entry.name === ".git") continue;
        const file = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(file, out);
        else if (entry.name.endsWith(".md")) out.push(file);
    }
    return out;
}

const slug = (text) =>
    text
        .trim()
        .toLowerCase()
        .replace(/[`*_~]/g, "")
        .replace(/[^\p{L}\p{N}\s-]/gu, "")
        .replace(/\s+/g, "-")
        .replace(/-+/g, "-");

function anchors(text) {
    const found = new Set();
    let fence = false;
    for (const line of text.split("\n")) {
        if (/^\s*```/.test(line)) {
            fence = !fence;
            continue;
        }
        if (fence) continue;
        const heading = /^(#{1,6})\s+(.+)$/.exec(line);
        if (heading) found.add(slug(heading[2] ?? ""));
    }
    return found;
}

export function checkDocs(root) {
    const failures = [];
    const warnings = [];
    for (const file of walk(root)) {
        const rel = path.relative(root, file).split(path.sep).join("/");
        const text = readFileSync(file, "utf8");
        const lines = text.split("\n");
        const isPluginReadme = /^plugins\/[^/]+\/README\.md$/.test(rel);
        if (isPluginReadme) {
            if (!/^# jig-[^:]+: .+/.test(lines[0] ?? "")) failures.push(`${rel}:1 title must be "# jig-x: ..."`);
            const second = lines.slice(1).find((line) => line.trim() !== "");
            if (!second?.startsWith("**Status:")) failures.push(`${rel}:2 status line must follow the title`);
            if (lines.length > MAX_README) warnings.push(`${rel}: ${lines.length} lines (about ${MAX_README})`);
        }
        const headingAnchors = anchors(text);
        let fence = false;
        let fenceStart = 0;
        for (let index = 0; index < lines.length; index++) {
            const line = lines[index] ?? "";
            if (/^\s*```/.test(line)) {
                if (!fence) {
                    const tag = line.trim().slice(3).trim();
                    if (tag === "") failures.push(`${rel}:${index + 1} code block has no language tag`);
                    fence = true;
                    fenceStart = index + 1;
                } else fence = false;
                continue;
            }
            const installs =
                /(?:^|[^\w])(?:npm (?:install|i)\b|pi install\b)/.test(line) ||
                (/\binstall\b/i.test(line) && /`@\d+\.\d+\.\d+`/.test(line));
            if (installs) {
                for (const version of DEPRECATED) {
                    if (line.includes(`@${version}`)) failures.push(`${rel}:${index + 1} install example names ${version}`);
                }
            }
            if (fence) continue;
            if (/^\s*\|/.test(line)) {
                for (const cell of line.split("|")) {
                    if (cell.trim().length > MAX_CELL) warnings.push(`${rel}:${index + 1} table cell is long`);
                }
            }
            const plain = line.replace(/`[^`]*`/g, "");
            for (const match of plain.matchAll(/\]\(([^)\s]+)\)/g)) {
                const target = match[1] ?? "";
                if (/^[a-z]+:/i.test(target)) continue;
                const [pathPart, anchor] = target.split("#");
                if (!pathPart) {
                    if (anchor && !headingAnchors.has(anchor)) {
                        failures.push(`${rel}:${index + 1} anchor does not resolve: ${target}`);
                    }
                    continue;
                }
                const resolved = path.resolve(path.dirname(file), pathPart);
                if (!existsSync(resolved)) {
                    failures.push(`${rel}:${index + 1} link does not resolve: ${target}`);
                    continue;
                }
                if (anchor && statSync(resolved).isFile() && resolved.endsWith(".md")) {
                    if (!anchors(readFileSync(resolved, "utf8")).has(anchor)) {
                        failures.push(`${rel}:${index + 1} anchor does not resolve: ${target}`);
                    }
                }
            }
            if (line.trim() !== "" && !/^\s*[|#>*\-\d]/.test(line)) {
                if (line.length > MAX_PARAGRAPH) warnings.push(`${rel}:${index + 1} paragraph is long`);
            }
        }
        if (fence) failures.push(`${rel}:${fenceStart} unclosed code block`);
    }
    return { failures, warnings };
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
    const root = process.argv[2] ?? path.resolve(import.meta.dirname, "..");
    const { failures, warnings } = checkDocs(root);
    for (const warning of warnings) console.log(`warn ${warning}`);
    for (const failure of failures) console.log(`fail ${failure}`);
    console.log(`docs: ${failures.length} failures, ${warnings.length} warnings`);
    process.exit(failures.length === 0 ? 0 : 1);
}
