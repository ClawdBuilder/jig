// The background update notice: once a day, only to the person, silent offline or when updates.check is false, with the
// company's cap and a stronger line when the running version is deprecated.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, test } from "node:test";
import type { JigState } from "../src/state.ts";
import { loadConfigFile } from "../src/config.ts";
import { jigPackage } from "../src/pi-version.ts";
import { readUpdates, validateUpdatesSection } from "../src/updates-section.ts";
import { checkUpdateAtStart, updateCheckEnabled } from "../src/update-notice.ts";
import { selectTarget } from "../src/update-versions.ts";

let dir: string;
let agent: string;
let work: string;

beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "jig-notice-"));
    agent = path.join(dir, "agent");
    work = path.join(dir, "work");
    mkdirSync(agent, { recursive: true });
    mkdirSync(work, { recursive: true });
    writeFileSync(path.join(agent, "settings.json"), JSON.stringify({ packages: [] }));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function state(updates: unknown = { check: true }, env: NodeJS.ProcessEnv = {}): JigState {
    return {
        env: { JIG_STATE_DIR: dir, ...env },
        personal: { sections: new Map([["updates", updates]]) },
        agentDir: () => agent,
        workingDir: work,
        now: () => new Date("2026-11-06T10:00:00.000Z"),
    } as unknown as JigState;
}

const CURRENT = jigPackage().version ?? "0.4.1";
const registry = {
    versions: {
        "0.4.1": {},
        "0.4.2": {},
        "0.5.0": {},
        "0.6.0": {},
        "0.6.0-beta.1": {},
    },
};

describe("updateCheckEnabled", () => {
    test("is on unless the section says false", () => {
        assert.equal(updateCheckEnabled(undefined), true);
        assert.equal(updateCheckEnabled({ check: true }), true);
        assert.equal(updateCheckEnabled({ check: false }), false);
        assert.equal(updateCheckEnabled("not an object"), true);
    });
});

describe("the updates section", () => {
    test("a company default can turn it off, and the person's file wins", () => {
        const file = path.join(dir, "jig.json");
        const layers = {
            defaults: new Map<string, unknown>([["updates", { check: false }]]),
            replace: new Map<string, readonly string[]>(),
        };
        writeFileSync(file, JSON.stringify({}));
        const company = loadConfigFile(file, new Map([["updates", validateUpdatesSection]]), layers);
        assert.deepEqual(readUpdates(company.sections.get("updates")), { check: false });

        writeFileSync(file, JSON.stringify({ updates: { check: true } }));
        const person = loadConfigFile(file, new Map([["updates", validateUpdatesSection]]), layers);
        assert.deepEqual(readUpdates(person.sections.get("updates")), { check: true });
    });
});

describe("checkUpdateAtStart", () => {
    test("tells the person once, then waits a day", async () => {
        let fetched = 0;
        const notes: string[] = [];
        const first = await checkUpdateAtStart(state(), (message) => notes.push(message), {
            fetchJson: async () => {
                fetched++;
                return registry;
            },
        });
        assert.equal(first, undefined);
        assert.equal(fetched, 1);
        assert.match(
            notes.join("\n"),
            new RegExp(`Jig 0\\.6\\.0 is available \\(you have ${CURRENT.replaceAll(".", "\\.")}\\)`),
        );
        assert.match(notes.join("\n"), /Run jig update in a terminal/);
        await checkUpdateAtStart(state(), (message) => notes.push(message), {
            now: new Date("2026-11-06T11:00:00.000Z").getTime(),
            fetchJson: async () => {
                fetched++;
                return registry;
            },
        });
        assert.equal(fetched, 1, "the cache stops the second fetch");
    });

    test("does nothing when the person or a company default turned it off", async () => {
        let fetched = 0;
        const notes: string[] = [];
        await checkUpdateAtStart(state({ check: false }), (message) => notes.push(message), {
            fetchJson: async () => {
                fetched++;
                return registry;
            },
        });
        assert.equal(fetched, 0);
        assert.deepEqual(notes, []);
    });

    test("is silent offline and on a registry error", async () => {
        let fetched = 0;
        const notes: string[] = [];
        await checkUpdateAtStart(state({ check: true }, { PI_OFFLINE: "1" }), (message) => notes.push(message), {
            fetchJson: async () => {
                fetched++;
                return registry;
            },
        });
        assert.equal(fetched, 0);
        await checkUpdateAtStart(state(), (message) => notes.push(message), {
            now: new Date("2026-11-07T11:00:00.000Z").getTime(),
            fetchJson: async () => {
                throw new Error("offline");
            },
        });
        assert.deepEqual(notes, []);
    });

    test("backs off after a failed fetch instead of retrying every start", async () => {
        let fetched = 0;
        const notes: string[] = [];
        const failing = async (): Promise<unknown> => {
            fetched++;
            throw new Error("offline");
        };
        await checkUpdateAtStart(state(), (message) => notes.push(message), { fetchJson: failing });
        assert.equal(fetched, 1);
        const now = new Date("2026-11-06T10:30:00.000Z").getTime();
        await checkUpdateAtStart(state(), (message) => notes.push(message), { now, fetchJson: failing });
        assert.equal(fetched, 1, "the failed check is backed off");
        assert.deepEqual(notes, []);
        const cache = JSON.parse(readFileSync(path.join(dir, "update-check.json"), "utf8"));
        assert.equal(typeof cache.failedAt, "number");
    });

    test("uses the company's cap and names it", () => {
        const chosen = selectTarget(registry, [{ package: "acme-jig", range: ">=0.4.1 <0.6.0" }]);
        assert.ok("target" in chosen);
        assert.equal(chosen.target.version, "0.5.0");
        assert.deepEqual(
            chosen.target.cappedBy.map((entry) => entry.package),
            ["acme-jig"],
        );
    });

    test("says a deprecated running version more strongly", async () => {
        const notes: string[] = [];
        await checkUpdateAtStart(state(), (message) => notes.push(message), {
            fetchJson: async () => ({
                versions: { [CURRENT]: { deprecated: "use 0.6.0" }, "0.6.0": {} },
            }),
        });
        assert.match(notes.join("\n"), /deprecated on npm: use 0\.6\.0/);
        assert.match(notes.join("\n"), /now/);
    });

    test("warns once when Pi is newer than the tested version", async () => {
        const notes: string[] = [];
        await checkUpdateAtStart(state(), (message) => notes.push(message), {
            pi: "1.6.0",
            fetchJson: async () => registry,
        });
        assert.match(notes.join("\n"), /Pi 1\.6\.0 is newer than 1\.5\.0/);
        await checkUpdateAtStart(state(), (message) => notes.push(message), {
            pi: "1.6.0",
            now: new Date("2026-11-06T12:00:00.000Z").getTime(),
            fetchJson: async () => registry,
        });
        assert.equal(notes.filter((message) => message.includes("Pi 1.6.0")).length, 1);
    });

    test("asks the registry npm is configured to use, without starting npm", async () => {
        let seen = "";
        await checkUpdateAtStart(state({ check: true }, { npm_config_registry: "https://mirror.example/" }), () => {}, {
            fetchJson: async (url) => {
                seen = url;
                return registry;
            },
        });
        assert.equal(seen, "https://mirror.example/@clawdbuilder%2Fjig");
    });

    test("writes a cache with a schema, never a secret", async () => {
        await checkUpdateAtStart(state(), () => {}, { fetchJson: async () => registry });
        const cache = JSON.parse(readFileSync(path.join(dir, "update-check.json"), "utf8"));
        assert.equal(cache.schema, 1);
        assert.equal(typeof cache.checkedAt, "number");
        assert.equal(cache.latest, "0.6.0");
        assert.doesNotMatch(JSON.stringify(cache), /token|password|secret/i);
    });
});
