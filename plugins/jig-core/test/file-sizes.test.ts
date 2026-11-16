// Growth made visible, and bounded. A source file of more than 500 lines is a lot for a newcomer to hold in their head,
// so the files that are already over it are listed, with their size, in `scripts/file-sizes-baseline.json`. This test
// fails when a file new to the list crosses 500, or when a listed file grows; a file that shrinks passes and says to
// lower the baseline. The rule of thumb is one job for each file; `docs/decisions.md` says how the big ones were split.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
// @ts-expect-error the ratchet is plain JavaScript
import { LIMIT, ratchet, sourceFiles } from "../../../scripts/file-sizes.mjs";

const ROOT = path.resolve(import.meta.dirname, "../../..");

test(`no source file is new over ${LIMIT} lines, and none of the listed ones grew`, (t) => {
    const baseline = JSON.parse(readFileSync(path.join(ROOT, "scripts", "file-sizes-baseline.json"), "utf8"));
    const { failures, notes } = ratchet(sourceFiles(ROOT), baseline);
    for (const note of notes) t.diagnostic(note);
    for (const failure of failures) {
        // GitHub Actions turns this line into an annotation on the file.
        if (process.env.GITHUB_ACTIONS === "true") console.log(`::error::${failure}`);
    }
    assert.deepEqual(failures, [], "the 500-line ratchet turned the wrong way");
});
