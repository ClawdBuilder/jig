// The secret probe behind `/jig doctor`: found, missing, locked, unknown or invalid, and never a value.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, test } from "node:test";
import { probeSecret, shorten } from "../src/secret-status.ts";
import type { SecretProbeOptions } from "../src/secret-status.ts";

let home: string;
let options: SecretProbeOptions;

beforeEach(() => {
    home = mkdtempSync(path.join(tmpdir(), "jig-probe-"));
    mkdirSync(path.join(home, "agent"));
    mkdirSync(path.join(home, "pass", "work"), { recursive: true });
    writeFileSync(path.join(home, "pass", "work", "token.gpg"), "");
    options = {
        env: {},
        passStoreDir: path.join(home, "pass"),
        agentDir: path.join(home, "agent"),
        home,
        platform: "linux",
    };
});

afterEach(() => {
    rmSync(home, { recursive: true, force: true });
});

describe("probeSecret", () => {
    test("a pass entry is found when its file is there, and missing when it is not", () => {
        assert.deepEqual(probeSecret("pass:work/token", options), {
            status: "found",
            backend: "pass",
            store: "pass",
            detail: "found (the store may ask to unlock)",
        });
        const missing = probeSecret("pass:work/other", options);
        assert.equal(missing.status, "missing");
        assert.equal(missing.fix, "pass insert work/other");
        assert.ok(!missing.detail?.includes("pass:work/other"));
    });

    test("an entry name that pass would refuse is invalid, and the input is not repeated", () => {
        const probe = probeSecret("pass:../secret", options);
        assert.equal(probe.status, "invalid");
        assert.equal(probe.backend, "pass");
        assert.ok(!JSON.stringify(probe).includes("pass:../secret"));
    });

    test("an environment variable is found only when this process has it, and the name is not a value", () => {
        assert.deepEqual(probeSecret("env:TOKEN", { ...options, env: { TOKEN: "abc" } }), {
            status: "found",
            backend: "env",
            store: "an environment variable",
            detail: "found in this session's environment",
        });
        const missing = probeSecret("env:TOKEN", { ...options, env: {} });
        assert.equal(missing.status, "missing");
        assert.equal(missing.detail, "TOKEN is not set");
        assert.match(missing.fix ?? "", /Set TOKEN .* restart Pi/);
        assert.equal(probeSecret("env:1BAD", options).status, "invalid");
    });

    test("a file is found by its size, and an empty one is missing", () => {
        writeFileSync(path.join(home, "token"), "abc\n");
        assert.equal(probeSecret(`file:${path.join(home, "token")}`, options).status, "found");

        writeFileSync(path.join(home, "empty"), "");
        const empty = probeSecret(`file:${path.join(home, "empty")}`, options);
        assert.equal(empty.status, "missing");
        assert.equal(empty.detail, "the file is empty");

        const missing = probeSecret(`file:${path.join(home, "gone")}`, options);
        assert.equal(missing.status, "missing");
        assert.match(missing.fix ?? "", /Create .*gone/);
    });

    test("a file inside Pi's agent folder is refused, and a relative path is invalid", () => {
        writeFileSync(path.join(home, "agent", "inside"), "abc\n");
        const inside = probeSecret(`file:${path.join(home, "agent", "inside")}`, options);
        assert.equal(inside.status, "invalid");
        assert.match(inside.detail ?? "", /inside Pi's agent folder/);

        assert.equal(probeSecret("file:relative/token", options).status, "invalid");
        assert.equal(probeSecret(`file:${home}`, options).status, "invalid");
    });

    test("the keychain is only on macOS, and is not opened anywhere", () => {
        assert.equal(probeSecret("keychain:svc/account", options).status, "invalid");
        assert.equal(probeSecret("keychain:svc/account", { ...options, platform: "darwin" }).status, "unknown");
    });

    test("a command and 1Password are not checked yet, and say so", () => {
        for (const ref of ["cmd:gh", "op://Work/Item/token"]) {
            const probe = probeSecret(ref, options);
            assert.equal(probe.status, "unknown");
            assert.match(probe.detail ?? "", /does not read this store/);
            assert.ok(!JSON.stringify(probe).includes("gh"));
            assert.ok(!JSON.stringify(probe).includes("Work"));
        }
    });

    test("text that is not a reference is invalid, and is never repeated", () => {
        for (const ref of ["not-a-reference", "pass:", "https://example.com/token"]) {
            const probe = probeSecret(ref, options);
            assert.equal(probe.status, "invalid");
            assert.ok(!JSON.stringify(probe).includes(ref));
        }
    });

    test("shorten writes the home folder as ~", () => {
        assert.equal(shorten(path.join(home, "a", "b"), home), "~/a/b");
        assert.equal(shorten("/elsewhere", home), "/elsewhere");
    });
});
