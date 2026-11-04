// The agents section a teammate writes is laid over the company's defaults. Three lists add up rather than being replaced:
// the roles' `ask`, the folders role files are read from, and the names a child's environment keeps. A teammate who adds a
// folder or a variable name therefore keeps the company's roles and the company's variable names too.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { start } from "../../jig-core/test/support/harness.ts";
import type { Harness } from "../../jig-core/test/support/harness.ts";
import { tempState } from "../../jig-core/test/support/state.ts";
import { agents } from "../src/index.ts";
import { childEnvironment } from "../src/launch.ts";
import { loadRoles, roleFolders } from "../src/roles.ts";
import type { AgentsSettings } from "../src/config.ts";

const state = tempState();
let harness: Harness | undefined;

before(() => state.start());
after(async () => {
    await harness?.shutdown();
    state.stop();
});

/** A role file the parser accepts, and nothing more. */
function writeRole(folder: string, name: string): void {
    mkdirSync(folder, { recursive: true });
    writeFileSync(
        path.join(folder, `${name}.md`),
        `---\nname: ${name}\ndescription: the role ${name}\ntools: read\n---\n\nRead what the task names.\n`,
    );
}

/** The plugin's own registration only: its tools and command go to a stub, and no child is started. */
function registerPlugin(): void {
    const pi = {
        registerTool: () => {},
        registerCommand: () => {},
        sendMessage: () => {},
        on: () => () => {},
        events: { on: () => () => {}, emit: () => {} },
    } as unknown as ExtensionAPI;
    agents()(pi);
}

const settingsOf = (h: Harness): AgentsSettings => h.api.config.section("agents") as AgentsSettings;

test("company and teammate role folders both count, so both roles are found", async () => {
    const base = mkdtempSync(path.join(tmpdir(), "jig-agents-layers-"));
    const company = path.join(base, "company");
    const teammate = path.join(base, "teammate");
    writeRole(company, "company-scout");
    writeRole(teammate, "teammate-scout");
    harness = await start({
        config: { agents: { folders: [teammate] } },
        plugins: (api) => {
            api.config.addSectionDefaults("agents", { folders: [company] });
            registerPlugin();
        },
    });
    const settings = settingsOf(harness);
    assert.deepEqual(settings.folders, [company, teammate], "the company's folder first, then the teammate's");
    const loaded = loadRoles(roleFolders(settings.folders, path.join(base, "agent")));
    assert.ok(loaded.roles.has("company-scout"), "the company's role is found");
    assert.ok(loaded.roles.has("teammate-scout"), "and the teammate's");
    assert.deepEqual(loaded.problems, []);
});

test("company and teammate env names both reach a child's environment", async () => {
    harness = await start({
        config: { agents: { env: ["TEAMMATE_MODEL_VAR"] } },
        plugins: (api) => {
            api.config.addSectionDefaults("agents", { env: ["COMPANY_MODEL_KEY"] });
            registerPlugin();
        },
    });
    const settings = settingsOf(harness);
    assert.deepEqual(settings.env, ["COMPANY_MODEL_KEY", "TEAMMATE_MODEL_VAR"]);
    const child = childEnvironment(
        { COMPANY_MODEL_KEY: "company", TEAMMATE_MODEL_VAR: "teammate", UNLISTED: "no" },
        settings.env,
        { id: "s1", name: "scout", parentPid: 1, parentSession: "p", role: "scout" },
    );
    assert.equal(child.COMPANY_MODEL_KEY, "company");
    assert.equal(child.TEAMMATE_MODEL_VAR, "teammate");
    assert.equal(child.UNLISTED, undefined, "only the names the section lists are passed");
});
