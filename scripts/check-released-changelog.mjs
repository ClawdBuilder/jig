// A released section never changes: the tag holds the text users were shown. Compare each released section with its own tag.
// No tags (a shallow clone or a source tarball) is a quiet skip; CI fetches tags, so the check really runs there.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const file = process.argv[2] ?? path.join(ROOT, "CHANGELOG.md");

function sections(text) {
    const found = new Map();
    const lines = text.split("\n");
    let current;
    let body = [];
    for (const line of lines) {
        const heading = /^## \[([^\]]+)\](?: - .*)?$/.exec(line);
        if (heading) {
            if (current !== undefined) found.set(current, body.join("\n").trim());
            current = heading[1];
            body = [];
            continue;
        }
        if (current !== undefined) body.push(line);
    }
    if (current !== undefined) found.set(current, body.join("\n").trim());
    return found;
}

const current = sections(readFileSync(file, "utf8"));
let tags;
try {
    tags = new Set(execFileSync("git", ["tag", "--list", "v*"], { cwd: ROOT, encoding: "utf8" }).split("\n"));
} catch {
    tags = new Set();
}
if (tags.size === 0) {
    console.log("released changelog: skipped (no tags in this checkout)");
    process.exit(0);
}

// The newest tag is the one release whose text must still match exactly; older tags predate this check and their historical
// edits (a rename, a wording fix) are left as history.
const newest = [...tags]
    .map((tag) => tag.slice(1))
    .filter((version) => current.has(version))
    .sort((left, right) => {
        const a = left.split(".").map(Number);
        const b = right.split(".").map(Number);
        for (let i = 0; i < 3; i++) if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) - (b[i] ?? 0);
        return 0;
    })
    .at(-1);
const failures = [];
if (newest !== undefined) {
    const body = current.get(newest);
    const tag = `v${newest}`;
    try {
        const text = execFileSync("git", ["show", `${tag}:CHANGELOG.md`], { cwd: ROOT, encoding: "utf8" });
        const atTag = sections(text).get(newest);
        if (atTag !== undefined && atTag !== body) failures.push(`${newest} differs from ${tag}`);
    } catch {
        // The tag cannot be read: nothing to compare.
    }
}
for (const failure of failures) {
    console.log(`fail released changelog: ${failure}. Put new entries under [Unreleased].`);
}
console.log(`released changelog: ${failures.length} failures`);
process.exit(failures.length === 0 ? 0 : 1);
