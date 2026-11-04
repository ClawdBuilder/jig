// What the README says about the review records: the agent's file tools can read them but not write them, and the
// sandbox's shell cannot reach them. The claim is jig-core's floor, so this test asks jig-core's own check.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { checkFileTool, defaultProtectedPaths } from "../../jig-core/src/protected-paths.ts";
import { workspaceDirFor } from "../src/settings.ts";

test("a review record is the agent's to read, not to write, and the sandbox's shell cannot reach it", (t) => {
    const home = mkdtempSync(path.join(os.tmpdir(), "jig-review-home-"));
    const agentDir = path.join(home, ".pi", "agent");
    const root = mkdtempSync(path.join(os.tmpdir(), "jig-review-records-"));
    t.after(() => {
        rmSync(home, { recursive: true, force: true });
        rmSync(root, { recursive: true, force: true });
    });

    const record = path.join(workspaceDirFor(path.join(agentDir, "jig-review"), root), "reviews", "r1.json");
    const entries = defaultProtectedPaths({ agentDir, home, env: {} });
    const context = { entries, cwd: root, home };

    // The README's wording: readable (the guarded agent folder), never writable.
    assert.equal(checkFileTool("read", { path: record }, context), undefined);
    const write = checkFileTool("write", { path: record }, context);
    assert.notEqual(write, undefined);
    assert.match(write?.reason ?? "", /guarded/);
    // The sandbox hides the same entry, which is what keeps the shell out.
    assert.ok(entries.some((entry) => entry.kind === "guarded" && record.startsWith(entry.path)));
});
