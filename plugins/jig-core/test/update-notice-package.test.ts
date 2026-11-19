// The update notice when Jig was installed with `pi install` in a Pi folder that is not a Jig home: it names no `jig`
// terminal command, it stays silent where Pi's own "Package updates are available" already speaks, and it gives the
// `pi install` command where Pi is silent (an entry pinned to one version, a company's cap) or where Jig is deprecated.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, test } from "node:test";
import type { ListedPackage } from "../src/cli/packages.ts";
import { jigPackage } from "../src/pi-version.ts";
import type { JigState } from "../src/state.ts";
import { checkUpdateAtStart } from "../src/update-notice.ts";
import { isPinned } from "../src/update-notice-text.ts";

const NAME = "@clawdbuilder/jig";
const CURRENT = jigPackage().version ?? "0.5.10";
const registry = { versions: { "0.4.1": {}, [CURRENT]: {}, "0.6.0": {}, "0.7.0": {} } };

let dir: string;
let agent: string;
let work: string;

beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "jig-notice-package-"));
    agent = path.join(dir, "agent");
    work = path.join(dir, "work");
    mkdirSync(agent, { recursive: true });
    mkdirSync(work, { recursive: true });
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function state(): JigState {
    return {
        env: { JIG_STATE_DIR: dir },
        personal: { sections: new Map([["updates", { check: true }]]) },
        agentDir: () => agent,
        workingDir: work,
        now: () => new Date("2026-11-19T10:00:00.000Z"),
    } as unknown as JigState;
}

/** Writes Pi's settings for the folder, and a company package that caps Jig when `range` is given. */
function settings(packages: unknown[], range?: string): void {
    const listed = [...packages];
    if (range !== undefined) {
        const company = path.join(dir, "company");
        mkdirSync(company, { recursive: true });
        writeFileSync(
            path.join(company, "package.json"),
            JSON.stringify({ name: "@acme/jig-company", version: "1.0.0", jig: { range } }),
        );
        listed.push(company);
    }
    writeFileSync(path.join(agent, "settings.json"), JSON.stringify({ packages: listed }));
}

async function notes(options: { pi?: string; versions?: unknown } = {}): Promise<string[]> {
    const said: string[] = [];
    await checkUpdateAtStart(state(), (message) => said.push(message), {
        ...(options.pi === undefined ? {} : { pi: options.pi }),
        fetchJson: async () => options.versions ?? registry,
    });
    return said;
}

describe("a Pi folder that is not the Jig home", () => {
    test("an unpinned entry says nothing about a newer Jig: Pi's own notice does", async () => {
        for (const entry of [`npm:${NAME}`, { source: `npm:${NAME}`, extensions: ["plugins/jig-core/index.ts"] }]) {
            settings([entry]);
            assert.deepEqual(await notes(), []);
            rmSync(path.join(dir, "update-check.json"), { force: true });
        }
    });

    test("a range or a tag is not a pin: Pi's update still moves it, so Jig says nothing", async () => {
        for (const source of [`npm:${NAME}@^0.5.0`, `npm:${NAME}@latest`, `npm:${NAME}@0.5`]) {
            settings([source]);
            assert.deepEqual(await notes(), [], source);
            rmSync(path.join(dir, "update-check.json"), { force: true });
        }
    });

    test("an entry pinned to one version gets the command, because Pi is silent about it", async () => {
        for (const source of [`npm:${NAME}@${CURRENT}`, `npm:${NAME}@0.5.0`]) {
            settings([source]);
            assert.deepEqual(await notes(), [
                `Jig 0.7.0 is available (you have ${CURRENT}). Run pi install npm:${NAME}@0.7.0 in a terminal.`,
            ]);
            rmSync(path.join(dir, "update-check.json"), { force: true });
        }
    });

    test("a company's cap gets the command with the version it allows, because Pi's update ignores the cap", async () => {
        settings([`npm:${NAME}`], ">=0.4.1 <0.7.0");
        assert.deepEqual(await notes(), [
            `Jig 0.6.0 is available (you have ${CURRENT}). Run pi install npm:${NAME}@0.6.0 in a terminal. Your company allows up to 0.6.0.`,
        ]);
    });

    test("a company range that holds nothing back says nothing", async () => {
        settings([`npm:${NAME}`], ">=0.4.1");
        assert.deepEqual(await notes(), []);
    });

    test("a deprecated Jig names the install of the newer version, and gives no command when there is none", async () => {
        settings([`npm:${NAME}`]);
        assert.deepEqual(
            await notes({ versions: { versions: { [CURRENT]: { deprecated: "use 0.7.0" }, "0.7.0": {} } } }),
            [`Jig ${CURRENT} is deprecated on npm: use 0.7.0. Run pi install npm:${NAME}@0.7.0 in a terminal now.`],
        );
        rmSync(path.join(dir, "update-check.json"), { force: true });
        assert.deepEqual(await notes({ versions: { versions: { [CURRENT]: { deprecated: "gone" } } } }), [
            `Jig ${CURRENT} is deprecated on npm: gone.`,
        ]);
    });

    test("a Pi newer than the tested one says to install the tested Pi, not to run a Jig command", async () => {
        settings([`npm:${NAME}`]);
        assert.deepEqual(await notes({ pi: "1.6.0" }), [
            "Pi 1.6.0 is newer than 1.5.2, the version Jig is tested with. If something stops working, install Pi 1.5.2.",
        ]);
    });

    test("Pi's own 0.0.0 is an unknown version: no warning about it", async () => {
        settings([`npm:${NAME}`]);
        assert.deepEqual(await notes({ pi: "0.0.0" }), []);
    });
});

describe("which entry is pinned", () => {
    const entry = (source: string): ListedPackage => ({ source, scope: "user" });

    test("an exact version of Jig is, a range, a tag, no version, another package or another form is not", () => {
        assert.equal(isPinned([entry(`npm:${NAME}@0.5.10`)], NAME), true);
        assert.equal(isPinned([entry(`npm:${NAME}@v0.5.10`)], NAME), true);
        assert.equal(isPinned([entry(`npm:${NAME}@0.6.0-beta.1`)], NAME), true);
        assert.equal(isPinned([entry(`npm:${NAME}@^0.5.0`)], NAME), false);
        assert.equal(isPinned([entry(`npm:${NAME}@latest`)], NAME), false);
        assert.equal(isPinned([entry(`npm:${NAME}`)], NAME), false);
        assert.equal(isPinned([entry("npm:@clawdbuilder/jig-bedrock@0.7.1")], NAME), false);
        assert.equal(isPinned([entry("git:github.com/ClawdBuilder/jig@v0.5.10")], NAME), false);
        assert.equal(isPinned([entry("/home/person/jig")], NAME), false);
        assert.equal(isPinned([], NAME), false);
    });
});
