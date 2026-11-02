// Which git working tree holds each output, and the per-kind cap.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { TestContext } from "node:test";
import { test } from "node:test";
import { Activity, MAX_OUTPUTS } from "../src/activity.ts";

function world(t: TestContext) {
    const root = realpathSync(mkdtempSync(path.join(tmpdir(), "jig-outputs-")));
    t.after(() => rmSync(root, { recursive: true, force: true }));
    const activity = new Activity();
    let n = 0;
    const write = (file: string) => {
        mkdirSync(path.dirname(file), { recursive: true });
        writeFileSync(file, "x\n");
        const id = `c${++n}`;
        activity.called(id, "write", { path: file }, root);
        activity.ended(id, "write", false);
    };
    return { root, activity, write };
}

test("an output records the root of the git working tree that holds it, or null", (t) => {
    const { root, activity, write } = world(t);
    mkdirSync(path.join(root, "app", ".git"), { recursive: true });
    mkdirSync(path.join(root, "wt"), { recursive: true });
    writeFileSync(path.join(root, "wt", ".git"), "gitdir: /elsewhere\n");
    write(path.join(root, "tickets", "PROJ-1", "notes.md"));
    write(path.join(root, "app", "README.md"));
    write(path.join(root, "app", "src", "deep", "a.ts"));
    write(path.join(root, "wt", "src", "b.ts"));
    const repoOf = (name: string) => activity.outputs.find((o) => o.path.endsWith(name))?.repo;
    assert.equal(repoOf("notes.md"), null);
    assert.equal(repoOf("README.md"), path.join(root, "app"));
    assert.equal(repoOf("a.ts"), path.join(root, "app"));
    assert.equal(repoOf("b.ts"), path.join(root, "wt"));
});

test("the cap of 50 applies to files outside repositories and files in repositories separately", (t) => {
    const { root, activity, write } = world(t);
    mkdirSync(path.join(root, "app", ".git"), { recursive: true });
    write(path.join(root, "notes", "first.md"));
    for (let i = 0; i < MAX_OUTPUTS + 5; i++) write(path.join(root, "app", `f${i}.ts`));
    for (let i = 0; i < MAX_OUTPUTS + 5; i++) write(path.join(root, "notes", `n${i}.md`));
    const loose = activity.outputs.filter((o) => o.repo === null);
    const inRepo = activity.outputs.filter((o) => o.repo !== null);
    assert.equal(loose.length, MAX_OUTPUTS);
    assert.equal(inRepo.length, MAX_OUTPUTS);
    assert.ok(loose[0]?.path.endsWith(`n${MAX_OUTPUTS + 4}.md`), "newest first");
    assert.ok(
        !activity.outputs.some((o) => o.path.endsWith("first.md")),
        "the oldest loose file fell off the loose list",
    );
});

test("ticket files survive any number of repository edits", (t) => {
    const { root, activity, write } = world(t);
    mkdirSync(path.join(root, "app", ".git"), { recursive: true });
    write(path.join(root, "notes", "plan.md"));
    for (let i = 0; i < MAX_OUTPUTS * 2; i++) write(path.join(root, "app", `f${i}.ts`));
    assert.ok(activity.outputs.some((o) => o.path.endsWith("plan.md")));
});
