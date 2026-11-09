// The real CLI loader builds the state setup reads: load the repository's plugins as jig setup does, in a temp HOME.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { loadHeadless } from "../src/cli/headless.ts";
import { setupStateFrom } from "../src/setup.ts";

const ROOT = path.resolve(import.meta.dirname, "../../..");

test("the plugin loader builds a state setup reads, with the declared methods", { timeout: 90_000 }, async () => {
    const home = mkdtempSync(path.join(tmpdir(), "jig-setup-loader-"));
    try {
        const agent = path.join(home, ".pi/agent");
        mkdirSync(agent, { recursive: true });
        writeFileSync(path.join(agent, "settings.json"), JSON.stringify({ packages: [ROOT] }));
        writeFileSync(path.join(agent, "jig.json"), "{}");
        const env = { ...process.env, HOME: home, PI_CODING_AGENT_DIR: agent };
        const loaded = await loadHeadless({ agentDir: agent, workingDir: home, env });
        const methods = setupStateFrom(loaded.state).onboardingMethods;
        assert.ok(methods?.has("jira"), [...(methods?.keys() ?? [])].join(", "));
        assert.ok(methods?.has("logs"));
        assert.ok(methods?.has("ops"));
        assert.ok(methods?.has("api"));
    } finally {
        rmSync(home, { recursive: true, force: true });
    }
});
