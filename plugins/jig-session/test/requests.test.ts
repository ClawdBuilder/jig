// One request file: parse it, take it once, sweep the leftovers, and apply its switches without touching Jig's rules.
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import {
    MAX_REQUEST_BYTES,
    parseRequest,
    REQUEST_SCHEMA,
    requestsDir,
    SWITCHES_ENTRY,
    Switches,
    sweepRequests,
    takeRequest,
} from "../src/requests.ts";

let root: string;
before(() => {
    root = mkdtempSync(path.join(tmpdir(), "jig-session-requests-"));
});
after(() => rmSync(root, { recursive: true, force: true }));

const write = (name: string, text: string): string => {
    const file = path.join(root, name);
    writeFileSync(file, text);
    return file;
};

describe("parseRequest", () => {
    test("reads the schema, booleans, an optional id and reload, and ignores unknown fields", () => {
        assert.deepEqual(
            parseRequest(
                JSON.stringify({
                    schema: REQUEST_SCHEMA,
                    tools: { git: true },
                    skills: { logs: false },
                    reload: true,
                    extra: 1,
                }),
            ),
            {
                request: { schema: 1, id: null, tools: { git: true }, skills: { logs: false }, reload: true },
            },
        );
        assert.deepEqual(parseRequest("{}"), { error: "the request's schema is not 1" });
        assert.deepEqual(parseRequest("not json"), { error: "the request is not JSON" });
        assert.deepEqual(parseRequest("[]"), { error: "the request is not an object" });
        assert.deepEqual(parseRequest(JSON.stringify({ schema: 1, tools: { git: "yes" } })), {
            error: '"tools" must map names to true or false',
        });
        assert.deepEqual(parseRequest(JSON.stringify({ schema: 1, reload: "yes" })), {
            error: '"reload" must be true or false',
        });
        const badId = parseRequest(JSON.stringify({ schema: 1, id: "bad id", tools: {} }));
        assert.equal(badId.request?.id, null);
    });
});

describe("the request files", () => {
    test("requestsDir is under the state folder", () => {
        assert.equal(requestsDir("/tmp/state"), path.join("/tmp/state", "requests"));
    });

    test("takeRequest renames, reads once and removes; a missing file is undefined", () => {
        const file = write("one.json", '{"schema":1}');
        assert.equal(takeRequest(file), '{"schema":1}');
        assert.equal(statSync(file, { throwIfNoEntry: false }), undefined);
        assert.equal(takeRequest(file), undefined);
    });

    test("takeRequest refuses a file over the limit unread", () => {
        const file = write("big.json", "x".repeat(MAX_REQUEST_BYTES + 1));
        assert.equal(takeRequest(file), null);
        assert.equal(statSync(file, { throwIfNoEntry: false }), undefined);
    });

    test("sweepRequests removes dead sessions, stale temp files and never keep or live ones", () => {
        const dead = write("dead.json", "{}");
        const live = write("live.json", "{}");
        const keep = write("keep.json", "{}");
        const oldTmp = write("old.tmp", "x");
        const newTmp = write("new.tmp", "x");
        const old = new Date(Date.now() - 120_000);
        utimesSync(oldTmp, old, old);
        const removed = sweepRequests(root, (name) => name === "live.json", "keep.json");
        assert.deepEqual(removed.sort(), ["dead.json", "old.tmp"]);
        assert.equal(statSync(live, { throwIfNoEntry: false })?.isFile(), true);
        assert.equal(statSync(keep, { throwIfNoEntry: false })?.isFile(), true);
        assert.equal(statSync(newTmp, { throwIfNoEntry: false })?.isFile(), true);
        assert.equal(statSync(dead, { throwIfNoEntry: false }), undefined);
    });
});

describe("Switches", () => {
    const host = () => {
        let active = ["git", "read"];
        return {
            toolNames: () => ["git", "read", "logs"],
            activeTools: () => active,
            setActiveTools: (names: string[]) => {
                active = names;
            },
            skillNames: () => ["git", "logs"],
        };
    };

    test("restore reads the last saved entry and apply turns known tools and skills on or off", () => {
        const switches = new Switches();
        assert.equal(
            switches.restore([
                { type: "custom", customType: SWITCHES_ENTRY, data: { tools: { git: false }, skillsOff: ["logs"] } },
            ]),
            true,
        );
        assert.deepEqual(switches.saved(), { tools: { git: false }, skillsOff: ["logs"] });
        const applied = switches.apply(
            { schema: 1, id: null, tools: { logs: true, nope: true }, skills: { logs: true }, reload: false },
            host(),
        );
        assert.equal(applied.ok, true);
        assert.equal(applied.changed, true);
        assert.match(applied.message, /logs on/);
        assert.match(applied.message, /skill logs on from the next turn/);
        assert.match(applied.message, /ignored, not in this session: nope/);
        assert.deepEqual([...switches.skillsOff], []);
        assert.deepEqual(switches.tools, { git: false, logs: true });
    });

    test("filterSkills leaves off skills out", () => {
        const switches = new Switches();
        switches.skillsOff.add("logs");
        const options = { skills: [{ name: "git" }, { name: "logs" }] };
        switches.filterSkills(options);
        assert.deepEqual(options.skills, [{ name: "git" }]);
    });
});
