// The sandbox section a teammate writes is laid over the company's defaults: objects merge, a list named `union` adds up.
// `env.remove` is such a list, so a teammate's own removal names extend the company's instead of replacing them — dropping
// the company's would quietly readmit a credential the company had kept out.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { start } from "../../jig-core/test/support/harness.ts";
import type { Harness } from "../../jig-core/test/support/harness.ts";
import { tempState } from "../../jig-core/test/support/state.ts";
import { sandbox } from "../src/index.ts";
import { DEFAULT_SETTINGS, settingsFrom } from "../src/config.ts";
import type { SandboxSettings } from "../src/config.ts";
import { scrubEnvironment } from "../src/env.ts";
import { fakePi } from "./support/fake-pi.ts";

const state = tempState();
let harness: Harness | undefined;

before(() => state.start());
after(async () => {
    await harness?.shutdown();
    state.stop();
});

/** The sandbox's registration only: its own Pi is never started, so no broker or session is involved. */
function registerOnly(): void {
    const pi = fakePi();
    sandbox({
        env: { PATH: process.env.PATH ?? "/usr/bin" },
        platform: "linux",
        wuid: undefined,
        home: () => "/tmp",
        uid: 1000,
        tmpRoot: "/tmp",
        agentDir: () => "/tmp/agent",
        settings: () => DEFAULT_SETTINGS,
        protectedPaths: () => [],
        runtimePaths: () => [],
    } as never)(pi.pi);
}

const removeOf = (h: Harness): string[] =>
    ((h.api.config.section("sandbox") as SandboxSettings).env.remove ?? []).slice();

test("a company's env.remove and a teammate's add up, rather than the teammate's replacing the company's", async () => {
    harness = await start({
        config: { sandbox: { env: { remove: ["*_SECRETX"] } } },
        plugins: (api) => {
            api.config.addSectionDefaults("sandbox", { env: { remove: ["ACME_*"] } });
            registerOnly();
        },
    });
    assert.deepEqual(removeOf(harness), ["ACME_*", "*_SECRETX"]);
    // And the merged list is what a command is scrubbed with: both families are gone, nothing else is.
    const settings = settingsFrom(harness.api.config.section("sandbox"));
    const scrubbed = scrubEnvironment(
        { ACME_SESSION: "acme-value", VENDOR_SECRETX: "vendor-value", LANG: "C.UTF-8" },
        { keep: settings.env.keep, remove: settings.env.remove },
    );
    assert.deepEqual(scrubbed.env, { LANG: "C.UTF-8" });
    assert.deepEqual(scrubbed.removed, ["ACME_SESSION", "VENDOR_SECRETX"]);
});

test("with no section of their own, a teammate gets the company's list whole", async () => {
    harness = await start({
        config: {},
        plugins: (api) => {
            api.config.addSectionDefaults("sandbox", { env: { remove: ["COMPANY_SECRET"] } });
            registerOnly();
        },
    });
    assert.deepEqual(removeOf(harness), ["COMPANY_SECRET"]);
});
