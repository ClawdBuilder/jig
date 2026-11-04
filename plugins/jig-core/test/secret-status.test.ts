// The secret probe behind `/jig doctor` and `/jig setup`: found, missing, locked, unknown or invalid, and never a value.
import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, test } from "node:test";
import type { RunResult } from "../src/contract.ts";
import { probeSecret, shorten } from "../src/secret-status.ts";
import type { ProbeRun, SecretProbeOptions } from "../src/secret-status.ts";

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

function result(overrides: Partial<RunResult> = {}): RunResult {
    return { code: 0, stdout: "", stderr: "", timedOut: false, ...overrides };
}

/** A fake program that records every call, so a test can prove what was and was not run. */
function runner(handler: (file: string, args: readonly string[]) => RunResult | Promise<RunResult> = () => result()): {
    run: ProbeRun;
    calls: Array<{ file: string; args: string[] }>;
} {
    const calls: Array<{ file: string; args: string[] }> = [];
    return {
        calls,
        run: async (file, args) => {
            calls.push({ file, args: [...args] });
            return handler(file, args);
        },
    };
}

describe("probeSecret", () => {
    test("a pass entry is found when its file is there, and missing when it is not", async () => {
        assert.deepEqual(await probeSecret("pass:work/token", options), {
            status: "found",
            backend: "pass",
            store: "pass",
            detail: "found (the store may ask to unlock)",
        });
        const missing = await probeSecret("pass:work/other", options);
        assert.equal(missing.status, "missing");
        assert.equal(missing.fix, "pass insert work/other");
        assert.ok(!missing.detail?.includes("pass:work/other"));
    });

    test("an entry name that pass would refuse is invalid, and the input is not repeated", async () => {
        const probe = await probeSecret("pass:../secret", options);
        assert.equal(probe.status, "invalid");
        assert.equal(probe.backend, "pass");
        assert.ok(!JSON.stringify(probe).includes("pass:../secret"));
    });

    test("an environment variable is found only when this process has it, and neither its value nor its length is shown", async () => {
        const found = await probeSecret("env:TOKEN", { ...options, env: { TOKEN: "abc" } });
        assert.deepEqual(found, {
            status: "found",
            backend: "env",
            store: "an environment variable",
            detail: "found in this session's environment",
        });
        assert.ok(!JSON.stringify(found).includes("abc"));
        const missing = await probeSecret("env:TOKEN", { ...options, env: {} });
        assert.equal(missing.status, "missing");
        assert.equal(missing.detail, "TOKEN is not set");
        assert.match(missing.fix ?? "", /Set TOKEN .* restart Pi/);
        assert.equal((await probeSecret("env:1BAD", options)).status, "invalid");
    });

    test("a file is found by its size, and an empty one is missing", async () => {
        writeFileSync(path.join(home, "token"), "abc\n", { mode: 0o600 });
        chmodSync(path.join(home, "token"), 0o600);
        assert.equal((await probeSecret(`file:${path.join(home, "token")}`, options)).status, "found");

        writeFileSync(path.join(home, "empty"), "");
        const empty = await probeSecret(`file:${path.join(home, "empty")}`, options);
        assert.equal(empty.status, "missing");
        assert.equal(empty.detail, "the file is empty");

        const missing = await probeSecret(`file:${path.join(home, "gone")}`, options);
        assert.equal(missing.status, "missing");
        assert.match(missing.fix ?? "", /Create .*gone/);
    });

    test("a file other users can read warns, and a private one does not", async () => {
        const file = path.join(home, "token");
        writeFileSync(file, "abc\n");
        if (process.platform !== "win32") {
            chmodSync(file, 0o644);
            assert.match((await probeSecret(`file:${file}`, options)).warning ?? "", /other users can read/);
            chmodSync(file, 0o600);
            assert.equal((await probeSecret(`file:${file}`, options)).warning, undefined);
        }
    });

    test("a file inside Pi's agent folder is refused, and a relative path is invalid", async () => {
        writeFileSync(path.join(home, "agent", "inside"), "abc\n");
        const inside = await probeSecret(`file:${path.join(home, "agent", "inside")}`, options);
        assert.equal(inside.status, "invalid");
        assert.match(inside.detail ?? "", /inside Pi's agent folder/);

        assert.equal((await probeSecret("file:relative/token", options)).status, "invalid");
        assert.equal((await probeSecret(`file:${home}`, options)).status, "invalid");
    });

    test("the Keychain is asked without -w or -g, and is only on macOS", async () => {
        const linux = await probeSecret("keychain:svc/account", options);
        assert.equal(linux.status, "invalid");
        assert.match(linux.detail ?? "", /only on macOS/);

        const fake = runner(() => result({ code: 0 }));
        const found = await probeSecret("keychain:svc/account", { ...options, platform: "darwin", run: fake.run });
        assert.equal(found.status, "found");
        assert.deepEqual(fake.calls[0], {
            file: "security",
            args: ["find-generic-password", "-s", "svc", "-a", "account"],
        });
        assert.ok(!fake.calls[0]?.args.includes("-w"));
        assert.ok(!fake.calls[0]?.args.includes("-g"));

        const missing = await probeSecret("keychain:svc/account", {
            ...options,
            platform: "darwin",
            run: runner(() => result({ code: 1, stderr: "The specified item could not be found in the keychain." }))
                .run,
        });
        assert.equal(missing.status, "missing");
        assert.match(missing.fix ?? "", /security add-generic-password -s 'svc' -a 'account' -w/);

        const locked = await probeSecret("keychain:svc/account", {
            ...options,
            platform: "darwin",
            run: runner(() => result({ code: 1, stderr: "User interaction is not allowed." })).run,
        });
        assert.equal(locked.status, "locked");
        assert.match(locked.fix ?? "", /Unlock/);
    });

    test("1Password is asked for an item list, never an item or a value", async () => {
        const fake = runner(() => result({ stdout: JSON.stringify([{ title: "Jira" }, { title: "Other" }]) }));
        const found = await probeSecret("op://Work/Jira/token", { ...options, run: fake.run });
        assert.equal(found.status, "found");
        assert.match(found.detail ?? "", /field is not verified/);
        assert.deepEqual(fake.calls[0]?.args, ["item", "list", "--vault", "Work", "--format", "json"]);
        for (const call of fake.calls) {
            assert.equal(call.file, "op");
            assert.ok(!call.args.includes("get"));
            assert.ok(!call.args.includes("read"));
        }

        const missing = await probeSecret("op://Work/Jira/token", {
            ...options,
            run: runner(() => result({ stdout: JSON.stringify([{ title: "Other" }]) })).run,
        });
        assert.equal(missing.status, "missing");
        assert.match(missing.fix ?? "", /op item create .*Jira.*Work/);

        const locked = await probeSecret("op://Work/Jira/token", {
            ...options,
            run: runner(() => result({ code: 1, stderr: "You are not signed in." })).run,
        });
        assert.equal(locked.status, "locked");
        assert.equal(locked.fix, "Sign in with: op signin");
    });

    test("a login command is checked with its own status, and no token", async () => {
        const fake = runner(() => result({ code: 0 }));
        assert.equal((await probeSecret("cmd:gh", { ...options, run: fake.run })).status, "found");
        assert.deepEqual(fake.calls[0], { file: "gh", args: ["auth", "status", "--no-refresh"] });

        const missing = await probeSecret("cmd:glab", {
            ...options,
            run: runner(() => result({ code: 1 })).run,
        });
        assert.equal(missing.status, "missing");
        assert.equal(missing.fix, "glab auth login");

        const unknown = await probeSecret("cmd:acme-sso", { ...options, run: fake.run });
        assert.equal(unknown.status, "unknown");
        assert.equal(fake.calls.length, 1, "an unknown command is not run");
    });

    test("text that is not a reference is invalid, and is never repeated", async () => {
        for (const ref of ["not-a-reference", "pass:", "https://example.com/token"]) {
            const probe = await probeSecret(ref, options);
            assert.equal(probe.status, "invalid");
            assert.ok(!JSON.stringify(probe).includes(ref));
        }
    });

    test("shorten writes the home folder as ~", () => {
        assert.equal(shorten(path.join(home, "a", "b"), home), "~/a/b");
        assert.equal(shorten("/elsewhere", home), "/elsewhere");
    });
});
