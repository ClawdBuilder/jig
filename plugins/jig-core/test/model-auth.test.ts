import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { modelAuthState, modelProviderLine, modelSignInLine } from "../src/model-auth.ts";

function home(): string {
    return mkdtempSync(path.join(tmpdir(), "jig-model-auth-"));
}

test("the sign-in line shortens the home it names", () => {
    assert.match(modelSignInLine(path.join(homedir(), ".jig")), /signed in for ~\/\.jig\./);
});

test("no auth file and no extension is missing, and the doctor warns with the next step", () => {
    const dir = home();
    assert.deepEqual(modelAuthState(dir, {}), { kind: "missing" });
    const line = modelProviderLine(dir, {});
    assert.equal(line.level, "warn");
    assert.match(line.fix ?? "", /jig auth login <provider>/);
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
