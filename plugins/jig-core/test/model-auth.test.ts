import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { modelAuthState, modelCountText, modelProviderLine, modelSignInLine, modelStatus } from "../src/model-auth.ts";

function home(): string {
    return mkdtempSync(path.join(tmpdir(), "jig-model-auth-"));
}

/** Runs `work` with `dir` as the Jig home, which is how the module tells the home from any other Pi folder. */
function asHome<T>(dir: string, work: () => T): T {
    const saved = process.env.JIG_HOME;
    process.env.JIG_HOME = dir;
    try {
        return work();
    } finally {
        if (saved === undefined) delete process.env.JIG_HOME;
        else process.env.JIG_HOME = saved;
    }
}

/** What Pi's model registry gives a session, as far as Jig reads it. */
const registry = (count: number) => ({ getAvailable: () => Array.from({ length: count }, (_, index) => ({ index })) });

test("the sign-in line shortens the folder it names", () => {
    assert.match(modelSignInLine(path.join(homedir(), ".jig")), /signed in for ~\/\.jig\./);
});

test("no auth file and no extension is missing, and the doctor warns with the next step", () => {
    const dir = home();
    assert.deepEqual(modelAuthState(dir, {}), { kind: "missing" });
    const line = asHome(dir, () => modelProviderLine(dir, {}));
    assert.equal(line.level, "warn");
    assert.match(line.detail ?? "", /not signed in for this Jig home/);
    assert.match(line.fix ?? "", /jig auth login <provider>/);
});

test("in a Pi folder that is not the Jig home the line names the folder and /login, and no terminal command", () => {
    const dir = home();
    const line = modelProviderLine(dir, {});
    assert.equal(line.level, "warn");
    assert.match(line.detail ?? "", /not signed in for this Pi folder/);
    assert.equal(line.fix, "Type /login to choose one.");
    assert.doesNotMatch(modelSignInLine(dir), /jig auth|inside jig|Jig home/);
    assert.match(modelSignInLine(dir), /^No model provider is signed in for .*\. Type \/login to choose one\.$/);
});

test("an auth.json provider is ready and the line names the provider, never the key", () => {
    const dir = home();
    writeFileSync(path.join(dir, "auth.json"), JSON.stringify({ anthropic: { type: "api_key", key: "secret-key" } }));
    assert.deepEqual(modelAuthState(dir, {}), { kind: "ready", providers: ["anthropic"] });
    const line = modelProviderLine(dir, {});
    assert.equal(line.level, "ok");
    assert.match(line.detail ?? "", /anthropic/);
    assert.doesNotMatch(JSON.stringify(line), /secret-key/);
});

test("Jig's own tarball is not mistaken for an extension", () => {
    const dir = home();
    writeFileSync(
        path.join(dir, "settings.json"),
        JSON.stringify({ packages: ["npm:/tmp/pack/clawdbuilder-jig-0.5.6.tgz"] }),
    );
    assert.deepEqual(modelAuthState(dir, {}), { kind: "missing" });
});

test("an extension package is skipped, because its provider cannot be checked here", () => {
    const dir = home();
    writeFileSync(
        path.join(dir, "settings.json"),
        JSON.stringify({ packages: ["npm:@clawdbuilder/jig@0.5.5", "npm:@acme/provider"] }),
    );
    assert.equal(modelAuthState(dir, {}).kind, "unknown");
    const line = modelProviderLine(dir, {});
    assert.equal(line.level, "skip");
    assert.match(line.detail ?? "", /extension package/);
});

test("Jig and jig-bedrock listed together are not missing: jig-bedrock is a provider package, not Jig", () => {
    for (const bedrock of [
        "npm:@clawdbuilder/jig-bedrock",
        "npm:@clawdbuilder/jig-bedrock@0.7.1",
        "npm:/tmp/pack/clawdbuilder-jig-bedrock-0.7.1.tgz",
    ]) {
        const dir = home();
        writeFileSync(
            path.join(dir, "settings.json"),
            JSON.stringify({ packages: ["npm:@clawdbuilder/jig@0.5.10", { source: bedrock }] }),
        );
        const state = modelAuthState(dir, {});
        assert.equal(state.kind, "unknown", bedrock);
        assert.match((state as { reason: string }).reason, /jig-bedrock/);
    }
    // A folder whose package.json names Jig is Jig, however it is listed (a checkout, or the copy a home installed).
    const folder = home();
    writeFileSync(path.join(folder, "package.json"), JSON.stringify({ name: "@clawdbuilder/jig", version: "0.5.10" }));
    const listed = home();
    writeFileSync(path.join(listed, "settings.json"), JSON.stringify({ packages: [folder] }));
    assert.deepEqual(modelAuthState(listed, {}), { kind: "missing" });
    const other = home();
    writeFileSync(path.join(other, "package.json"), JSON.stringify({ name: "@acme/provider", version: "1.0.0" }));
    writeFileSync(path.join(listed, "settings.json"), JSON.stringify({ packages: [folder, other] }));
    assert.equal(modelAuthState(listed, {}).kind, "unknown");
    // Jig alone, as an object entry or by tarball, is still only Jig.
    const alone = home();
    writeFileSync(
        path.join(alone, "settings.json"),
        JSON.stringify({
            packages: [{ source: "npm:@clawdbuilder/jig@0.5.10", extensions: ["plugins/jig-core/index.ts"] }],
        }),
    );
    assert.deepEqual(modelAuthState(alone, {}), { kind: "missing" });
});

test("in a session, Pi's own count is the line: one wording for /jig and for the doctor", () => {
    const dir = home();
    assert.equal(modelCountText(3), "3 models available");
    assert.equal(modelCountText(1), "1 model available");
    assert.equal(modelCountText(0), "none available. Type /login.");

    const some = modelProviderLine(dir, {}, registry(3));
    assert.deepEqual(
        [some.id, some.level, some.title, some.detail],
        ["logins.model", "ok", "Model", "3 models available"],
    );
    const none = modelProviderLine(dir, {}, registry(0));
    assert.deepEqual(
        [none.level, none.title, none.detail, none.fix],
        ["warn", "Model", "none available. Type /login.", "Type /login."],
    );
    assert.equal(some.fix, undefined);

    assert.deepEqual(modelStatus(dir, {}, registry(2)), { line: "Model — 2 models available", missing: false });
    assert.deepEqual(modelStatus(dir, {}, registry(0)), {
        line: "Model — none available. Type /login.",
        missing: true,
    });
});

test("the registry is believed over the files: a folder with no auth.json still has models when Pi says so", () => {
    const dir = home();
    assert.deepEqual(modelAuthState(dir, {}), { kind: "missing" });
    assert.equal(modelStatus(dir, {}, registry(4))?.missing, false);
    assert.equal(modelProviderLine(dir, {}, registry(4)).level, "ok");
});

test("a registry that cannot say falls back to the files, and with no registry and a signed-in folder /jig says nothing", () => {
    const dir = home();
    const broken = {
        getAvailable: () => {
            throw new Error("registry is not ready");
        },
    };
    assert.equal(modelStatus(dir, {}, broken)?.missing, true);
    assert.equal(modelProviderLine(dir, {}, broken).title, "Model provider");
    writeFileSync(path.join(dir, "auth.json"), JSON.stringify({ anthropic: { type: "api_key", key: "x" } }));
    assert.equal(modelStatus(dir, {}), undefined);
    assert.equal(modelStatus("", {}), undefined);
});
