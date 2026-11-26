// What the engine does with a problem in jig.json, and with a section whose plugin is not loaded, with no Pi. Phase 1 of the portable build:
// an engine run by a hook or a gateway loads no plugin, so a section kept in jig.json for one must not make the file a problem, and a name
// nobody knows must still be one.
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { describeProblem } from "../../src/config.ts";
import { offSectionsOf } from "../../src/plugin-table.ts";
import { request, SIGNAL, useWorlds } from "./harness.ts";

const open = useWorlds();

/** A rule that lets one named tool run without a question: nothing else in a fresh engine allows it. */
const RULES = [{ tool: "mystery", decision: "allow" }];

describe("a problem in jig.json", () => {
    test("falls back to the defaults, as it does in Pi: the rules are dropped and the problem is kept", async () => {
        const world = open({ config: { rules: RULES, records: { retentionDays: "many" } } });
        const { engine, host, log } = world;
        engine.start(host);
        assert.equal(engine.state.personal.problems.length > 0, true);
        assert.match(engine.state.personal.problems.map(describeProblem).join("\n"), /retentionDays/);
        assert.deepEqual(engine.state.personal.config.rules, []);
        // With the rules gone, the tool asks again.
        assert.equal((await engine.judge(request("mystery"), host, SIGNAL)).verdict, "run");
        assert.equal(log.asked.length, 1);
    });

    test("a file with no problem keeps its rules, and the tool runs with no question", async () => {
        const world = open({ config: { rules: RULES } });
        const { engine, host, log } = world;
        engine.start(host);
        assert.deepEqual(engine.state.personal.problems, []);
        assert.equal(engine.state.personal.config.rules.length, 1);
        assert.equal((await engine.judge(request("mystery"), host, SIGNAL)).verdict, "run");
        assert.deepEqual(log.asked, []);
    });
});

describe("the sections that count as off", () => {
    const WITH_JIRA = { rules: RULES, jira: { site: "https://example.atlassian.net" } };

    test("a jig.json with a jira section and a rules list, read with no plugin loaded and jira given as off, keeps the rules", async () => {
        const world = open({ config: WITH_JIRA, engine: { offSections: new Set(["jira"]) } });
        const { engine, host, log } = world;
        engine.start(host);
        assert.deepEqual(engine.state.personal.problems, []);
        assert.equal(engine.state.personal.config.rules.length, 1);
        assert.deepEqual([...(engine.state.offSections ?? [])], ["jira"], "the host's set is the one used");
        assert.equal((await engine.judge(request("mystery"), host, SIGNAL)).verdict, "run");
        assert.deepEqual(log.asked, []);
    });

    test("without a set from the host, the sections of the built-in plugins that no loaded plugin registered are off", () => {
        const world = open({ config: WITH_JIRA });
        const { engine, host } = world;
        engine.start(host);
        assert.deepEqual(engine.state.personal.problems, []);
        assert.equal(engine.state.personal.config.rules.length, 1);
        assert.deepEqual(engine.state.offSections, offSectionsOf([]));
        assert.equal(engine.state.offSections?.has("jira"), true);
    });

    test("the set of the host replaces the default one: with nothing off, a jira section nobody checks is a name nobody knows", () => {
        const world = open({ config: WITH_JIRA, engine: { offSections: new Set() } });
        world.engine.start(world.host);
        assert.match(world.engine.state.personal.problems.map(describeProblem).join("\n"), /jira/);
        assert.deepEqual(world.engine.state.personal.config.rules, [], "and the file falls back to the defaults");
    });

    test("a section name nobody knows is still a problem, and the rules are dropped", () => {
        const world = open({
            config: { rules: RULES, nonesuch: { a: 1 } },
            engine: { offSections: new Set(["jira"]) },
        });
        world.engine.start(world.host);
        const problems = world.engine.state.personal.problems.map(describeProblem).join("\n");
        assert.match(problems, /nonesuch/);
        assert.deepEqual(world.engine.state.personal.config.rules, []);
    });
});
