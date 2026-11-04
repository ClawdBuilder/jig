// The jira section a teammate writes is laid over the company's defaults. `auth` is one choice among four, so it is
// replaced whole; `privateNames` protects against leaking an internal name in outgoing text, so a teammate's names add to
// the company's and cannot drop them.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { start } from "../../jig-core/test/support/harness.ts";
import type { Harness } from "../../jig-core/test/support/harness.ts";
import { tempState } from "../../jig-core/test/support/state.ts";
import { jigJira } from "../src/index.ts";
import { pointersIn } from "../src/pointers.ts";
import type { JiraSettings } from "../src/config.ts";

const state = tempState();
let harness: Harness | undefined;

before(() => state.start());
after(async () => {
    await harness?.shutdown();
    state.stop();
});

/** The plugin's own registration only: its tool goes to a stub, and no request is made. */
function registerPlugin(): void {
    const pi = {
        registerTool: () => {},
        registerCommand: () => {},
        on: () => () => {},
        events: { on: () => () => {}, emit: () => {} },
    } as unknown as ExtensionAPI;
    jigJira()(pi);
}

const PRIVATE = {
    jira: {
        site: "https://example.atlassian.net",
        auth: { token: "env:JIRA_TOKEN" },
        privateNames: ["corp.example.net"],
    },
};

test("a company's private names and a teammate's add up, and both are flagged", async () => {
    harness = await start({
        config: PRIVATE,
        plugins: (api) => {
            api.config.addSectionDefaults("jira", { privateNames: ["payroll"] });
            registerPlugin();
        },
    });
    const settings = harness.api.config.section("jira") as JiraSettings;
    assert.deepEqual(settings.privateNames, ["payroll", "corp.example.net"]);
    assert.deepEqual(pointersIn(["the payroll folder on corp.example.net"], settings.privateNames), [
        "private name: payroll",
        "private name: corp.example.net",
    ]);
});
