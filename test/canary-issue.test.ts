// The canaries' issue step, against a fake `gh`: one issue when none is open, a comment on the open one, and a dry run
// that calls nothing. The Pi canary and the Claude Code canary run the same script, and each has an issue of its own.
import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { test } from "node:test";

const SCRIPT = path.resolve(import.meta.dirname, "../scripts/canary-issue.mjs");

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

test("a dry run for Pi opens an issue named for Pi, in the words it has always used", (t) => {
    const fake = fakeGh([]);
    const { status, stdout } = run(t, fake, { DRY_RUN: "1" });
    assert.equal(status, 0, stdout);
    assert.match(stdout, /-f title=Pi canary red -f labels\[\]=bug -f body=/);
    assert.ok(stdout.includes("The scheduled Pi canary failed: the newest Pi on npm does not pass Jig's checks."));
    assert.ok(stdout.includes("- Pi: 1.6.0\n- Run: https://github.com/o/r/actions/runs/42"));
    assert.ok(
        stdout.includes('A red run means "look at the new Pi", not that a change is bad (docs/compatibility.md).'),
    );
});

test("a dry run for Claude Code names Claude Code in the title and the body, and takes its version from CANARY_VERSION", (t) => {
    const fake = fakeGh([]);
    const { status, stdout } = run(t, fake, { DRY_RUN: "1", CANARY_AGENT: "Claude Code", CANARY_VERSION: "2.1.400" });
    assert.equal(status, 0, stdout);
    assert.match(stdout, /-f title=Claude Code canary red -f labels\[\]=bug -f body=/);
    assert.ok(
        stdout.includes(
            "The scheduled Claude Code canary failed: the newest Claude Code on npm does not pass Jig's checks.",
        ),
    );
    assert.ok(stdout.includes("- Claude Code: 2.1.400\n- Run: https://github.com/o/r/actions/runs/42"));
    assert.ok(stdout.includes('"look at the new Claude Code"'));
    assert.doesNotMatch(stdout, /\bPi\b|1\.6\.0/, "PI_VERSION is only the fallback, and Pi is not named");
});

test("with no version given, the body says the newest one was tried", (t) => {
    const fake = fakeGh([]);
    const { stdout } = run(t, fake, { DRY_RUN: "1", PI_VERSION: "", CANARY_AGENT: "Claude Code" });
    assert.ok(stdout.includes("- Claude Code: the newest on npm"));
});

test("each canary comments on its own open issue, and never on the other one", (t) => {
    const open = [
        { number: 7, title: "Pi canary red" },
        { number: 9, title: "Claude Code canary red" },
    ];
    const claude = run(t, fakeGh(open), { CANARY_AGENT: "Claude Code", CANARY_VERSION: "2.1.400" });
    assert.equal(claude.status, 0, claude.stdout);
    assert.match(claude.calls, /issues\/9\/comments/);
    assert.doesNotMatch(claude.calls, /issues\/7\/comments/);
    assert.match(claude.calls, /Claude Code: 2\.1\.400/);
    const pi = run(t, fakeGh(open), {});
    assert.equal(pi.status, 0, pi.stdout);
    assert.match(pi.calls, /issues\/7\/comments/);
    assert.doesNotMatch(pi.calls, /issues\/9\/comments/);
});

test("with only the Pi issue open, a Claude Code canary opens an issue of its own", (t) => {
    const { status, calls } = run(t, fakeGh([{ number: 7, title: "Pi canary red" }]), { CANARY_AGENT: "Claude Code" });
    assert.equal(status, 0);
    assert.match(calls, /--method\nPOST\n-f\ntitle=Claude Code canary red/);
    assert.doesNotMatch(calls, /issues\/7\/comments/);
});
