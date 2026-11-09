// A crafted commit that only the tool's own fetch brings in: the first call refuses and applies nothing; the refs are local
// afterwards, so the second call plans with them, the gate asks, and yes applies.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import type { GitSettings } from "../src/config.ts";
import { planBranch } from "../src/git-branch.ts";
import { planMerge, planRebase, planSync } from "../src/git-integrate.ts";
import { setWorkingDirectory } from "../src/repo.ts";
import { git } from "./support/repos.ts";
import { makeRepo, teammateCommit } from "./support/repos.ts";
import type { Fixture } from "./support/repos.ts";
import { setupHarness } from "./support/harness.ts";
import type { Harness } from "./support/harness.ts";

let h: Harness;
let counter = 0;
before(() => {
    h = setupHarness();
});
after(() => h.cleanup());
const settings = {
    base: "main",
    protectedBranches: ["main"],
    forges: [],
    cloneHost: "github.com",
} as unknown as GitSettings;
const call = (): Parameters<typeof planSync>[1] =>
    ({ toolCallId: "t", signal: new AbortController().signal, settings }) as unknown as Parameters<typeof planSync>[1];

/** A fixture with its own origin, a feature branch checked out, and a crafted commit pushed to main afterwards. */
function setup(action: "sync" | "merge" | "rebase" | "branch"): Fixture {
    const r = makeRepo(h.sb, `late${++counter}`);
    if (action !== "sync") {
        git(r.dir, "switch", "-q", "-c", "feature/x", "--no-track", "origin/main");
        git(r.dir, "push", "-q", "-u", "origin", "feature/x");
    }
    // The commit exists only at the origin: the clone has not fetched it.
    teammateCommit(h.sb, r, "main", ".pi/settings.json", "crafted");
    return r;
}

const fresh = (action: "sync" | "merge" | "rebase" | "branch") => {
    switch (action) {
        case "sync":
            return planSync({}, call());
        case "merge":
            return planMerge({ base: "main" }, call());
        case "rebase":
            return planRebase({ base: "main" }, call());
        case "branch":
            return planBranch({ operation: "create", branch: "feature/new" }, call());
    }
};

for (const action of ["sync", "merge", "rebase", "branch"] as const) {
    test(`${action}: the first call refuses the fetch's guarded commit, the second applies it`, async () => {
        const r = setup(action);
        setWorkingDirectory(r.dir);
        const before = git(r.dir, "rev-parse", "HEAD");
        const first = await fresh(action);
        await assert.rejects(first.run(), /fetch brought changes to files Pi loads|nothing was applied/);
        assert.equal(git(r.dir, "rev-parse", "HEAD"), before, "nothing was applied");
        const second = await fresh(action);
        await second.run();
        assert.notEqual(git(r.dir, "rev-parse", "HEAD"), before, "the second call applied it");
    });
}
