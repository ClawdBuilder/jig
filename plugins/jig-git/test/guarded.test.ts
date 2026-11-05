// The shared guard resolver, against a real repository: the same refs the operations use, and every parent of a stash.
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { after, before, test } from "node:test";
import { guardedChanges, guardedPathsFor, guardedStashChanges, guardedTargets, guardedRelative } from "../src/guarded.ts";
import type { GitSettings } from "../src/config.ts";
import { git, makeRepo, writeFile } from "./support/repos.ts";
import { setupHarness } from "./support/harness.ts";
import type { Harness } from "./support/harness.ts";

const settings = { base: "main", protectedBranches: ["main"], forges: [], cloneHost: "github.com" } as unknown as GitSettings;
let h: Harness;
let counter = 0;
before(() => {
    h = setupHarness();
});
after(() => h.cleanup());

const rev = (dir: string, ref: string): string => git(dir, "rev-parse", ref).trim();

test("guardedChanges finds the project files Pi loads, and not ordinary ones", async () => {
    const r = makeRepo(h.sb, `guard${++counter}`);
    const base = rev(r.dir, "HEAD");
    git(r.dir, "switch", "-q", "-c", "evil");
    mkdirSync(path.join(r.dir, ".pi"), { recursive: true });
    writeFileSync(path.join(r.dir, ".pi/settings.json"), "{}");
    writeFileSync(path.join(r.dir, "README.md"), "normal\n");
    git(r.dir, "add", "-A");
    git(r.dir, "commit", "-qm", "evil");
    const tip = rev(r.dir, "HEAD");
    assert.deepEqual(await guardedChanges(r.dir, base, tip), [".pi/settings.json"]);
    assert.equal(guardedRelative("README.md"), false);
    assert.equal(guardedRelative(".vscode/tasks.json"), true);
});

test("a stash's untracked third parent is seen", async () => {
    const r = makeRepo(h.sb, `stash${++counter}`);
    writeFile(r.dir, "tracked.txt", "one\n");
    git(r.dir, "add", "-A");
    git(r.dir, "commit", "-qm", "tracked");
    mkdirSync(path.join(r.dir, ".pi"), { recursive: true });
    writeFileSync(path.join(r.dir, ".pi/settings.json"), "{}");
    git(r.dir, "add", "-A");
    git(r.dir, "stash", "push", "-q", "-u", "-m", "with untracked");
    const stash = rev(r.dir, "stash@{0}");
    assert.ok((await guardedStashChanges(r.dir, stash)).includes(".pi/settings.json"));
});

test("the resolver reads @{upstream}, the real branch, and the stash index", async () => {
    const r = makeRepo(h.sb, `resolve${++counter}`);
    git(r.dir, "checkout", "-q", "-b", "feature/x", "--no-track", "origin/main");
    git(r.dir, "push", "-q", "-u", "origin", "feature/x");
    writeFile(r.dir, "up.txt", "up\n");
    git(r.dir, "add", "-A");
    git(r.dir, "commit", "-qm", "up");
    git(r.dir, "push", "-q", "origin", "feature/x");
    const sync = await guardedTargets("sync", {}, r.dir, settings);
    assert.equal(sync?.targets[0]?.sha, rev(r.dir, "@{upstream}"));
    const target = await guardedTargets("branch", { operation: "switch", branch: "main" }, r.dir, settings);
    assert.equal(target?.targets[0]?.sha, rev(r.dir, "refs/heads/main"));
    mkdirSync(path.join(r.dir, ".pi"), { recursive: true });
    writeFileSync(path.join(r.dir, ".pi/settings.json"), "{}");
    git(r.dir, "add", "-A");
    git(r.dir, "commit", "-qm", "stash me");
    writeFileSync(path.join(r.dir, ".pi/settings.json"), "{\"x\":1}");
    git(r.dir, "stash", "push", "-q");
    const stash = await guardedTargets("stash", { operation: "pop", index: 0 }, r.dir, settings);
    assert.equal(stash?.targets[0]?.label, "stash@{0}");
});

test("every tree-moving action in the gate resolves a target through this resolver", async () => {
    const { CHANGING } = await import("../src/runs-later-gate.ts");
    const r = makeRepo(h.sb, `all${++counter}`);
    // A crafted commit on main and origin/main, a stash with .pi, and a feature branch to apply them onto.
    mkdirSync(path.join(r.dir, ".pi"), { recursive: true });
    writeFileSync(path.join(r.dir, ".pi/settings.json"), "{}");
    git(r.dir, "add", "-A");
    git(r.dir, "commit", "-qm", "crafted");
    git(r.dir, "push", "-q", "origin", "main");
    const crafted = rev(r.dir, "HEAD");
    git(r.dir, "switch", "-q", "-c", "feature/x", "--no-track", "origin/main");
    git(r.dir, "branch", "-q", "--set-upstream-to=origin/main", "feature/x");
    writeFileSync(path.join(r.dir, "README.md"), "feature\n");
    git(r.dir, "add", "-A");
    git(r.dir, "commit", "-qm", "feature");
    writeFileSync(path.join(r.dir, ".pi/settings.json"), '{"x":1}');
    git(r.dir, "stash", "push", "-q");
    const inputs: Record<string, Record<string, unknown>> = {
        branch: { operation: "switch", branch: "main" },
        merge: { branch: "main" },
        sync: {},
        rebase: { base: "main" },
        cherry_pick: { revs: [crafted] },
        stash: { operation: "pop", index: 0 },
    };
    assert.deepEqual([...CHANGING].sort(), Object.keys(inputs).sort());
    for (const action of CHANGING) {
        const target = await guardedTargets(action, inputs[action] ?? {}, r.dir, settings);
        assert.ok(target !== undefined, `${action} has a target`);
        assert.equal(typeof target?.from, "string", `${action} has HEAD`);
        assert.ok((target?.targets.length ?? 0) > 0, `${action} has a target commit`);
    }
});
