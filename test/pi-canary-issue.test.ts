// The canary's issue step, against a fake `gh`: one issue when none is open, a comment on the open one, and a dry run
// that calls nothing. The workflow runs the same script on a red canary.
import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { test } from "node:test";

const SCRIPT = path.resolve(import.meta.dirname, "../scripts/pi-canary-issue.mjs");

/** A fake `gh` on PATH: it logs its arguments, and answers the list call with `list`. */
function fakeGh(list: unknown[]): { dir: string; log: string } {
    const dir = mkdtempSync(path.join(tmpdir(), "jig-canary-"));
    const log = path.join(dir, "calls.log");
    const gh = path.join(dir, "gh");
    writeFileSync(log, "");
    writeFileSync(
        gh,
        `#!/bin/sh\nprintf '%s\\n' "$@" >> "${log}"\nif [ "$2" = "repos/o/r/issues?state=open&per_page=100" ]; then printf '%s' '${JSON.stringify(list)}'; fi\n`,
    );
    chmodSync(gh, 0o755);
    return { dir, log };
}

function run(t: { after: (fn: () => void) => void }, fake: { dir: string; log: string }, env: Record<string, string>) {
    const result = spawnSync(process.execPath, [SCRIPT], {
        encoding: "utf8",
        env: {
            PATH: `${fake.dir}:${process.env.PATH ?? ""}`,
            GITHUB_REPOSITORY: "o/r",
            GITHUB_RUN_ID: "42",
            PI_VERSION: "1.6.0",
            ...env,
        },
    });
    t.after(() => rmSync(fake.dir, { recursive: true, force: true }));
    return { ...result, calls: readFileSync(fake.log, "utf8") };
}

test("with no open issue, it opens one with the Pi version and the run link", (t) => {
    const fake = fakeGh([]);
    const { status, stdout, calls } = run(t, fake, {});
    assert.equal(status, 0, stdout);
    assert.match(calls, /--method\nPOST\n-f\ntitle=Pi canary red/);
    assert.match(calls, /-f\nlabels\[\]=bug/);
    assert.match(calls, /Pi: 1\.6\.0/);
    assert.match(calls, /actions\/runs\/42/);
    assert.match(stdout, /opened/);
});

test("with the issue already open, it comments instead of opening a second one", (t) => {
    const fake = fakeGh([
        { number: 7, title: "Pi canary red", pull_request: undefined },
        { number: 8, title: "Other" },
    ]);
    const { status, stdout, calls } = run(t, fake, {});
    assert.equal(status, 0, stdout);
    assert.doesNotMatch(calls, /--method\nPOST\n-f\ntitle=/);
    assert.match(calls, /issues\/7\/comments/);
    assert.match(calls, /actions\/runs\/42/);
    assert.match(stdout, /#7/);
});

test("a dry run calls nothing", (t) => {
    const fake = fakeGh([]);
    const { status, stdout, calls } = run(t, fake, { DRY_RUN: "1" });
    assert.equal(status, 0, stdout);
    assert.equal(calls.trim(), "");
    assert.match(stdout, /dry run: gh api repos\/o\/r\/issues --method POST/);
});
