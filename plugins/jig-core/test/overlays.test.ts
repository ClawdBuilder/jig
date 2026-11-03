// Skill overlays: reading the overlay folder, the text of a merged skill, the copy of the generic skill's other files (so its
// relative links still resolve), and the turn's skill list.
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, test } from "node:test";
import { applyToPrompt, mergedText, readOverlays, syncOverlays } from "../src/overlays.ts";

let root: string;
let saved: string | undefined;
beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), "jig-overlays-"));
    saved = process.env.JIG_STATE_DIR;
    process.env.JIG_STATE_DIR = path.join(root, "state");
});
afterEach(() => {
    if (saved === undefined) delete process.env.JIG_STATE_DIR;
    else process.env.JIG_STATE_DIR = saved;
    rmSync(root, { recursive: true, force: true });
});

function skill(name: string, files: Record<string, string> = {}): string {
    const dir = path.join(root, "skills", name);
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, "SKILL.md"), `---\nname: ${name}\ndescription: d\n---\n# ${name}\n`);
    for (const [file, text] of Object.entries(files)) {
        mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
        writeFileSync(path.join(dir, file), text);
    }
    return path.join(dir, "SKILL.md");
}

function overlays(files: Record<string, string>): string {
    const dir = path.join(root, "overlays");
    mkdirSync(dir, { recursive: true });
    for (const [file, text] of Object.entries(files)) writeFileSync(path.join(dir, file), text);
    return dir;
}

describe("the overlay folder", () => {
    test("reads <skill>.md files, skips other names, big files and non-Markdown", () => {
        const folder = overlays({
            "jira.md": "a",
            "Bad_Name.md": "b",
            "notes.txt": "c",
            "big.md": "x".repeat(70 * 1024),
        });
        const { overlays: found, skipped } = readOverlays(folder);
        assert.deepEqual([...found.keys()], ["jira"]);
        assert.deepEqual(skipped.sort(), ["Bad_Name.md", "big.md"]);
        assert.deepEqual(readOverlays(path.join(root, "missing")).overlays.size, 0);
    });
});

describe("the merged text", () => {
    test("is the generic text unchanged, then a heading with the company's name, then the overlay", () => {
        const text = mergedText("---\nname: a\n---\nbody\n\n", "Acme Corp", "﻿rule one\n\n");
        assert.equal(text, "---\nname: a\n---\nbody\n\n## Acme Corp rules\n\nrule one\n");
    });

    test("a display name cannot break out of its heading", () => {
        assert.match(mergedText("g", "A\n# B", "o"), /\n## A # B rules\n/);
    });
});

describe("syncing", () => {
    test("writes SKILL.md and copies the other files, so a relative link resolves from the merged copy", () => {
        const generic = skill("jira", { "references/guide.md": "guide", "scripts/run.sh": "echo" });
        const result = syncOverlays("acme", { folder: overlays({ "jira.md": "rule" }), display: "Acme" }, [
            { name: "jira", filePath: generic },
        ]);
        const merged = result.merged.get("jira");
        assert.ok(merged?.endsWith(path.join("skills", "acme", "jira", "SKILL.md")));
        assert.ok(merged !== undefined);
        assert.match(readFileSync(merged, "utf8"), /## Acme rules\n\nrule\n$/);
        assert.equal(readFileSync(path.join(path.dirname(merged), "references", "guide.md"), "utf8"), "guide");
        assert.equal(readFileSync(path.join(path.dirname(merged), "scripts", "run.sh"), "utf8"), "echo");
        assert.deepEqual(result.notes, []);
    });

    test("a symbolic link in the skill is not followed or copied", () => {
        const generic = skill("jira");
        writeFileSync(path.join(root, "secret.txt"), "s");
        symlinkSync(path.join(root, "secret.txt"), path.join(path.dirname(generic), "link.txt"));
        const { merged } = syncOverlays("acme", { folder: overlays({ "jira.md": "r" }), display: "Acme" }, [
            { name: "jira", filePath: generic },
        ]);
        assert.ok(!existsSync(path.join(path.dirname(merged.get("jira") as string), "link.txt")));
    });

    test("an overlay with no generic skill is a note, and a skill too big to copy stays as it is", () => {
        const big = skill("big", { "a.bin": "x".repeat(9 * 1024 * 1024) });
        const result = syncOverlays("acme", { folder: overlays({ "ghost.md": "r", "big.md": "r" }), display: "Acme" }, [
            { name: "big", filePath: big },
        ]);
        assert.equal(result.merged.size, 0);
        assert.ok(result.notes.some((note) => /ghost\.md has no generic skill/.test(note)));
        assert.ok(result.notes.some((note) => /big was not merged: the skill's folder is too big/.test(note)));
    });

    test("a copy of a skill that is no longer overlaid is removed, and a file already merged is not merged twice", () => {
        const generic = skill("jira");
        const folder = overlays({ "jira.md": "one" });
        const first = syncOverlays("acme", { folder, display: "Acme" }, [{ name: "jira", filePath: generic }]);
        const merged = first.merged.get("jira") as string;
        const again = syncOverlays("acme", { folder, display: "Acme" }, [{ name: "jira", filePath: merged }]);
        assert.equal(again.merged.get("jira"), merged);
        assert.equal((readFileSync(merged, "utf8").match(/## Acme rules/g) ?? []).length, 1);
        rmSync(path.join(folder, "jira.md"));
        syncOverlays("acme", { folder, display: "Acme" }, [{ name: "jira", filePath: generic }]);
        assert.ok(!existsSync(path.dirname(merged)));
    });

    test("a profile name that is not a safe folder name merges nothing", () => {
        const generic = skill("jira");
        const result = syncOverlays("../x", { folder: overlays({ "jira.md": "r" }), display: "A" }, [
            { name: "jira", filePath: generic },
        ]);
        assert.equal(result.merged.size, 0);
        assert.equal(result.notes.length, 1);
    });
});

describe("the turn's list", () => {
    test("swaps paths, drops dormant skills, keeps order and other fields, and returns a new list", () => {
        const list = [
            { name: "a", filePath: "/g/a/SKILL.md", baseDir: "/g/a", extra: 1 },
            { name: "b", filePath: "/g/b/SKILL.md", baseDir: "/g/b", extra: 2 },
            { name: "c", filePath: "/g/c/SKILL.md", baseDir: "/g/c", extra: 3 },
        ];
        const out = applyToPrompt(list, new Map([["a", "/m/a/SKILL.md"]]), new Set(["c"]));
        assert.deepEqual(out, [
            { name: "a", filePath: "/m/a/SKILL.md", baseDir: "/m/a", extra: 1 },
            { name: "b", filePath: "/g/b/SKILL.md", baseDir: "/g/b", extra: 2 },
        ]);
        assert.equal(list[0]?.filePath, "/g/a/SKILL.md");
    });
});
