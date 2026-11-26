// `start`, `beginSession` and `stop`, with no Pi: a session with no agent behind it.
import assert from "node:assert/strict";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";
import type { WatchMessage } from "../../src/watch/message.ts";
import { passed, scripted } from "../support/watches.ts";
import { request, SIGNAL, useWorlds } from "./harness.ts";

const open = useWorlds();

describe("start, beginSession and stop", () => {
    test("start reads jig.json for this host, and a section kept for a plugin that is not loaded is not a problem", () => {
        const world = open({
            config: { records: { retentionDays: 30 }, jira: { site: "https://example.atlassian.net" } },
        });
        const { engine, host } = world;
        assert.equal(engine.state.configLoaded, false);
        engine.start(host);
        assert.equal(engine.state.configLoaded, true);
        assert.equal(engine.state.personal.config.records.retentionDays, 30);
        assert.deepEqual(engine.state.personal.problems, []);
        assert.equal(engine.state.host, host);
        assert.equal(engine.state.sessionId, "session-1");
        assert.equal(engine.state.workingDir, world.cwd);
    });

    test("beginSession removes the records that are older than the retention, and stop forgets the session", async () => {
        const world = open();
        const { engine, host } = world;
        const folder = path.join(world.stateDir, "records");
        mkdirSync(folder, { recursive: true });
        const old = path.join(folder, "2020-01-01.jsonl");
        writeFileSync(old, "{}\n");
        engine.start(host);
        engine.beginSession();
        assert.equal(existsSync(old), false);

        engine.state.sessionAllows.add("key");
        await engine.judge(request("mystery"), host, SIGNAL);
        assert.equal(engine.state.calls.size, 1);
        engine.state.screen = { notify: () => {} };
        await engine.stop();
        assert.equal(engine.state.sessionAllows.size, 0);
        assert.equal(engine.state.calls.size, 0);
        assert.equal(engine.state.screen, undefined);
        await engine.stop();
    });

    test("a watch that ends tells the host's event bus and wakes the model through the host, and a stalled one notifies through it", async () => {
        const world = open();
        const { engine, host, log, clock } = world;
        const woken: WatchMessage[] = [];
        engine.start({
            ...host,
            wake: async (message) => {
                woken.push(message);
                return true;
            },
        });
        engine.beginSession();
        const finishing = scripted(clock, "finishing", () => passed("all good")).kind;
        const stalling = scripted(clock, "stalling", () => ({ state: 1 })).kind;
        engine.state.watches.registerKind(finishing);
        engine.state.watches.registerKind(stalling);
        engine.state.watches.start({ kind: "stalling", spec: {}, title: "a slow one", stallMinutes: 1 });
        await clock.advance(2 * 60_000);
        assert.deepEqual(
            log.notices.map((notice) => notice.level),
            ["warn"],
        );
        assert.match(log.notices[0]?.text ?? "", /Still waiting for "a slow one"/);

        engine.state.watches.start({ kind: "finishing", spec: {}, title: "a quick one" });
        await clock.advance(2 * 60_000);
        const done = log.emitted.filter((entry) => entry.name === "jig:watch-done");
        assert.equal(done.length, 1);
        assert.deepEqual(
            done.map((entry) => (entry.event as { result: { outcome: string } }).result.outcome),
            ["passed"],
        );
        assert.equal(woken.length, 1);
        assert.equal(woken[0]?.customType, "jig-watch");
        await engine.stop();
    });

    test("a notice the host says nobody saw is still owed, and a model that could not be woken does not stop the watch's end being told", async () => {
        const world = open({ shown: false, woken: false });
        const { engine, host, log, clock } = world;
        engine.start(host);
        engine.beginSession();
        engine.state.watches.registerKind(scripted(clock, "stalling", () => ({ state: 1 })).kind);
        engine.state.watches.registerKind(scripted(clock, "finishing", () => passed("all good")).kind);
        engine.state.watches.start({ kind: "stalling", spec: {}, title: "a slow one", stallMinutes: 1 });
        await clock.advance(5 * 60_000);
        assert.equal(
            log.notices.length > 1,
            true,
            "false says nobody saw it, so the same notice came again at the next poll",
        );

        engine.state.watches.start({ kind: "finishing", spec: {}, title: "a quick one" });
        await clock.advance(2 * 60_000);
        assert.equal(log.woke.length, 1, "the host was handed the message once, and said it could not wake the agent");
        assert.equal(log.emitted.filter((entry) => entry.name === "jig:watch-done").length, 1);
        await engine.stop();
    });
});
