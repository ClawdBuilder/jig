// The credential jig-core attaches: a plugin names a gh account and host, jig-core reads the token from gh, sets it for
// that one call, and registers it for redaction. The token never reaches plugin code, and an enterprise host gets the
// variable gh documents for it.
import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, beforeEach, test } from "node:test";
import { run, setCredentialRegistrar } from "../src/exec.ts";

const TOKEN = ["ghs", "fixture", "credential"].join("_");
let dir: string;
let savedPath: string | undefined;
let seen: string[] = [];

function script(body: string): void {
    const file = path.join(dir, "gh");
    writeFileSync(file, `#!/bin/sh\n${body}\n`);
    chmodSync(file, 0o755);
}

const PRINT =
    "console.log(process.env.GH_TOKEN ?? '-'); console.log(process.env.GH_ENTERPRISE_TOKEN ?? '-'); console.log(process.env.GH_HOST ?? '-');";

before(() => {
    dir = mkdtempSync(path.join(os.tmpdir(), "jig-credential-"));
    savedPath = process.env.PATH;
    process.env.PATH = `${dir}:${process.env.PATH ?? ""}`;
    setCredentialRegistrar((value) => seen.push(value));
});
beforeEach(() => {
    seen = [];
});
after(() => {
    if (savedPath === undefined) delete process.env.PATH;
    else process.env.PATH = savedPath;
    rmSync(dir, { recursive: true, force: true });
});

test("github.com gets GH_TOKEN for that one call, and the token is registered for redaction", async () => {
    script(`if [ "$1 $2" = "auth token" ]; then echo "${TOKEN}"; exit 0; fi\nexit 2`);
    const result = await run(process.execPath, ["-e", PRINT], {
        credential: { program: "gh", account: "acme-work", host: "github.com" },
    });
    assert.equal(result.code, 0);
    assert.deepEqual(result.stdout.trim().split("\n"), [TOKEN, "-", "-"]);
    assert.deepEqual(seen, [TOKEN]);
});

test("an enterprise host gets GH_ENTERPRISE_TOKEN and GH_HOST, not GH_TOKEN", async () => {
    script(`if [ "$1 $2" = "auth token" ]; then echo "${TOKEN}"; exit 0; fi\nexit 2`);
    const result = await run(process.execPath, ["-e", PRINT], {
        credential: { program: "gh", account: "acme-work", host: "ghe.example.com" },
    });
    assert.deepEqual(result.stdout.trim().split("\n"), ["-", TOKEN, "ghe.example.com"]);
    assert.deepEqual(seen, [TOKEN]);
});

test("a gh too old for --user says so", async () => {
    script(`echo "unknown flag: --user" >&2; exit 1`);
    await assert.rejects(
        run(process.execPath, ["-e", "0"], {
            credential: { program: "gh", account: "acme-work", host: "github.com" },
        }),
        /gh is too old to choose an account/,
    );
});

test("an account with no token says how to sign in, and the failed call never runs", async () => {
    script(`echo "no oauth token for acme-work" >&2; exit 1`);
    await assert.rejects(
        run(process.execPath, ["-e", "0"], {
            credential: { program: "gh", account: "acme-work", host: "github.com" },
        }),
        (error: Error) => {
            assert.match(error.message, /account "acme-work" has no token/);
            assert.match(error.message, /gh auth login --hostname github\.com/);
            return true;
        },
    );
    assert.deepEqual(seen, []);
});
