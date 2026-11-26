// `run`, with no Pi: a tool of the contract (an `EngineTool`) through `judge` and then `run` or `answer`, with a host of our own. Each call leaves one
// record, written by `run` itself because no agent is there to do it.
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";
import type { Approval } from "../../src/ask.ts";
import type { CallRequest } from "../../src/engine.ts";
import type { Judged } from "../../src/engine.ts";
import type { EngineTool } from "../../src/engine-tool.ts";
import { stampTool, TOKEN_SHAPED } from "../support/test-tool.ts";
import type { Handed } from "../support/test-tool.ts";
import { ALLOW, request, SIGNAL, useWorlds } from "./harness.ts";
import type { World, WorldOptions } from "./harness.ts";

const open = useWorlds();

/** A world with the stamp tool declared, as a plugin declares its tool. */
function stampWorld(options: WorldOptions = {}): World & { tool: EngineTool; handed: Handed } {
    const world = open(options);
    const { tool, handed } = stampTool();
    world.engine.state.declarations.set(tool.tool, tool);
    world.engine.start(world.host);
    return Object.assign(world, { tool, handed });
}

const stamp = (action: string, text?: string, callId = "call-1"): CallRequest =>
    request("stamp", callId, { action, ...(text === undefined ? {} : { text }) });

/** The call a judged call of the verdict `run` holds. */
function ran(judged: Judged) {
    assert.equal(judged.verdict, "run");
    if (judged.verdict !== "run") throw new Error("not run");
    return judged.call;
}

/** The text of every record file, to look for what must not be in it. */
function recordText(world: World): string {
    const folder = path.join(world.stateDir, "records");
    return readdirSync(folder)
        .map((name) => readFileSync(path.join(folder, name), "utf8"))
        .join("\n");
}

describe("a read", () => {
    test("runs with no question, and leaves one record", async () => {
        const world = stampWorld();
        const { engine, host, log, tool, handed } = world;
        const read = stamp("read");
        const call = ran(await engine.judge(read, host, SIGNAL));
        assert.deepEqual(log.asked, []);

        const result = await engine.run(read, call, tool, host, SIGNAL);
        assert.deepEqual(result, { text: "stamps: none", data: { stamps: [] } });
        assert.equal(engine.state.calls.size, 0, "the call is forgotten once its record is written");
        assert.deepEqual(handed.execute, [{ cwd: world.cwd, seen: undefined, hasProgress: false, hasSignal: true }]);

        const [record, ...more] = world.records();
        assert.equal(more.length, 0);
        assert.deepEqual(
            { ...record, id: undefined, time: undefined, durationMs: undefined },
            {
                id: undefined,
                time: undefined,
                durationMs: undefined,
                kind: "call",
                session: "session-1",
                agentRole: "main",
                tool: "stamp",
                action: "read",
                plugin: "jig-test",
                environment: "local",
                environmentKind: "local",
                effect: "read",
                decision: "allow",
                decisionSource: "table",
                outcome: "ok",
                toolCallId: "call-1",
            },
        );
    });

    test("is handed the working folder of the host by classify, by preview and by execute", async () => {
        const world = stampWorld();
        const { engine, host, tool, handed } = world;
        // A write asks, so its preview is built; a read does not ask, so only the write shows the preview.
        const write = stamp("write", "first");
        const call = ran(await engine.judge(write, host, SIGNAL));
        await engine.run(write, call, tool, host, SIGNAL);
        assert.deepEqual(handed.classify, [world.cwd]);
        assert.deepEqual(handed.preview, [world.cwd]);
        assert.deepEqual(
            handed.execute.map((one) => one.cwd),
            [world.cwd],
        );
    });
});

describe("a write", () => {
    test("asks, the host allows, it runs with the preview it was shown, and the record has the approval and the facts", async () => {
        const world = stampWorld();
        const { engine, host, log, tool, handed } = world;
        const progress: string[] = [];
        const write = stamp("write", "first");
        const call = ran(await engine.judge(write, host, SIGNAL));
        assert.equal(log.asked.length, 1);
        assert.equal(log.asked[0]?.kind, "review", "a preview with a body asks on the review screen");
        const shown = log.asked[0]?.preview;
        assert.match(shown?.summary ?? "", /stamp write first/);

        const result = await engine.run(write, call, tool, host, SIGNAL, (line) => progress.push(line));
        assert.deepEqual(result, { text: "stamped first", data: { stamps: ["first"] } });
        assert.deepEqual(progress, ["stamping"]);
        assert.equal(
            handed.execute[0]?.seen?.fingerprint,
            shown?.fingerprint,
            "the tool reads back the preview that was shown",
        );
        assert.equal(handed.execute[0]?.hasProgress, true);

        const [record, ...more] = world.records();
        assert.equal(more.length, 0);
        assert.equal(record?.decision, "ask");
        assert.equal(record?.approval, "review");
        assert.equal(record?.answer, "allow");
        assert.equal(record?.waitedMs, 5);
        assert.equal(record?.outcome, "ok");
        assert.deepEqual(record?.facts, { stamps: 1 });
    });

    test("waits when the host says later, and the answer with an allow lets it run", async () => {
        const world = stampWorld({ answers: ["later"] });
        const { engine, host, tool, handed } = world;
        const write = stamp("write", "later one");
        const waiting = await engine.judge(write, host, SIGNAL);
        assert.equal(waiting.verdict, "waiting");
        if (waiting.verdict !== "waiting") return;
        assert.equal(handed.execute.length, 0, "nothing ran while the call waited");
        assert.deepEqual(world.records(), [], "and nothing was written");

        const answered = engine.answer(waiting.call, ALLOW, host);
        const call = ran(answered);
        assert.equal((await engine.run(write, call, tool, host, SIGNAL)).text, "stamped later one");
        const [record] = world.records();
        assert.equal(record?.approval, "review");
        assert.equal(record?.answer, "allow");
        assert.equal(record?.outcome, "ok");
    });

    test("is refused when the host declines, and the tool never runs", async () => {
        const world = stampWorld({
            answers: [{ answer: "decline", dismissed: false, reason: "not now", waitedMs: 3 }],
        });
        const { engine, host, handed } = world;
        const write = stamp("write", "declined");
        const judged = await engine.judge(write, host, SIGNAL);
        assert.deepEqual(judged, {
            verdict: "refused",
            kind: "declined",
            reason: "Blocked by jig-core: the user declined this call, and said: not now",
        });
        // The host finishes a call that run did not handle.
        engine.finish(write, { isError: true, text: "Blocked by jig-core: ..." }, host);
        assert.equal(handed.execute.length, 0);
        const [record] = world.records();
        assert.equal(record?.outcome, "blocked");
        assert.equal(record?.errorKind, "declined");
        assert.equal(record?.answer, "decline");
    });

    test("is refused as no-screen when the host cannot ask, as it is today", async () => {
        const world = stampWorld({ canAsk: false });
        const { engine, host, log, handed } = world;
        const judged = await engine.judge(stamp("write", "silent"), host, SIGNAL);
        assert.deepEqual(judged, {
            verdict: "refused",
            kind: "no-screen",
            reason: "Blocked by jig-core: this call needs approval and there is no screen to ask on.",
        });
        assert.deepEqual(log.asked, []);
        assert.equal(handed.execute.length, 0);
    });

    test("that changed since the preview does not run, and the record says the tool failed", async () => {
        const world = stampWorld();
        const { engine, host, tool, handed } = world;
        const shown = stamp("write", "as shown");
        const call = ran(await engine.judge(shown, host, SIGNAL));
        // The host hands `run` another input than the one that was judged: the tool plans again and sees the difference.
        const changed = stamp("write", "something else");
        const result = await engine.run(changed, call, tool, host, SIGNAL);
        assert.deepEqual(result, { text: "stamp changed since the preview, so nothing was stamped", isError: true });
        const read = stamp("read", undefined, "call-2");
        const readCall = ran(await engine.judge(read, host, SIGNAL));
        assert.equal(
            (await engine.run(read, readCall, tool, host, SIGNAL)).text,
            "stamps: none",
            "nothing was stamped",
        );
        assert.equal(handed.execute.length, 2);
        const [record] = world.records();
        assert.equal(record?.outcome, "error");
        assert.equal(record?.errorKind, "tool");
    });
});

describe("what a tool does that is not a result", () => {
    test("a RefusedError is a refusal: the model reads the tool's words and the record says refused", async () => {
        const world = stampWorld();
        const { engine, host, tool } = world;
        const refuse = stamp("refuse");
        const call = ran(await engine.judge(refuse, host, SIGNAL));
        const result = await engine.run(refuse, call, tool, host, SIGNAL);
        assert.deepEqual(result, { text: "stamp refused: the press is closed today", isError: true });
        const [record] = world.records();
        assert.equal(record?.outcome, "blocked");
        assert.equal(record?.errorKind, "refused");
        assert.equal(record?.error, "stamp refused: the press is closed today");
        assert.equal(engine.state.refusedCalls.size, 0, "the refusal was taken when the record was written");
    });

    test("any other error is the result, and the record says the tool failed", async () => {
        const world = stampWorld();
        const { engine, host, tool } = world;
        const fail = stamp("fail");
        const call = ran(await engine.judge(fail, host, SIGNAL));
        const result = await engine.run(fail, call, tool, host, SIGNAL);
        assert.deepEqual(result, { text: "the stamp press jammed", isError: true });
        const [record] = world.records();
        assert.equal(record?.outcome, "error");
        assert.equal(record?.errorKind, "tool");
        assert.equal(record?.error, "the stamp press jammed");
    });

    test("a result that is not a ToolResult is an error of the tool", async () => {
        const world = stampWorld();
        const { engine, host } = world;
        const broken: EngineTool = { ...stampTool().tool, execute: async () => ({}) as never };
        const read = stamp("read");
        const call = ran(await engine.judge(read, host, SIGNAL));
        const result = await engine.run(read, call, broken, host, SIGNAL);
        assert.deepEqual(result, { text: "stamp gave no result text", isError: true });
        assert.equal(world.records()[0]?.errorKind, "tool");
    });
});

describe("what comes back is cleaned", () => {
    test("a token-shaped secret is removed from the result, from its data and from the record", async () => {
        const world = stampWorld();
        const { engine, host, tool } = world;
        const leak = stamp("leak");
        const call = ran(await engine.judge(leak, host, SIGNAL));
        const result = await engine.run(leak, call, tool, host, SIGNAL);
        assert.equal(result.text, "the token is [redacted]");
        assert.deepEqual(result.data, { token: "[redacted]" });
        assert.equal(recordText(world).includes(TOKEN_SHAPED), false);
        assert.equal(world.records()[0]?.outcome, "ok");
    });

    test("a production result is masked, in the text and in the data", async () => {
        const world = stampWorld();
        const { engine, host, tool } = world;
        const report = stamp("report");
        const call = ran(await engine.judge(report, host, SIGNAL));
        assert.equal(call.masked, true);
        const result = await engine.run(report, call, tool, host, SIGNAL);
        assert.match(result.text, /^customer: email#[0-9a-f]{6}$/);
        assert.match(String((result.data as { customer: string }).customer), /^email#[0-9a-f]{6}$/);
    });

    test("a result that cannot be masked is withheld, and the record says so", async () => {
        const world = stampWorld({
            engine: {
                createMasker: () => {
                    throw new Error("no key");
                },
            },
        });
        const { engine, host, tool } = world;
        const report = stamp("report");
        const call = ran(await engine.judge(report, host, SIGNAL));
        const result = await engine.run(report, call, tool, host, SIGNAL);
        assert.deepEqual(result, { text: "result withheld: it could not be masked", isError: true });
        assert.equal(world.records()[0]?.errorKind, "withheld");
    });
});

describe("a call that was not let through does not run", () => {
    test("whatever the host asks: a refused call, a waiting call, another tool, and a call the engine does not hold", async () => {
        const decline: Approval = { answer: "decline", dismissed: false, waitedMs: 1 };
        const world = stampWorld({ answers: [decline, "later"] });
        const { engine, host, tool, handed } = world;

        // A call the engine refused.
        const refused = stamp("write", "declined", "call-1");
        assert.equal((await engine.judge(refused, host, SIGNAL)).verdict, "refused");
        const refusedCall = engine.state.calls.get("call-1");
        assert.notEqual(refusedCall, undefined);
        if (refusedCall === undefined) return;
        const first = await engine.run(refused, refusedCall, tool, host, SIGNAL);
        assert.deepEqual(first, { text: "Blocked by jig-core: the call was refused.", isError: true });

        // A call that waits for its answer.
        const waiting = stamp("write", "waits", "call-2");
        const judged = await engine.judge(waiting, host, SIGNAL);
        assert.equal(judged.verdict, "waiting");
        if (judged.verdict !== "waiting") return;
        const second = await engine.run(waiting, judged.call, tool, host, SIGNAL);
        assert.deepEqual(second, {
            text: "Blocked by jig-core: the call is still waiting for an answer.",
            isError: true,
        });

        // Another tool than the one that was judged, and a call the engine does not hold.
        const read = stamp("read", undefined, "call-3");
        const readCall = ran(await engine.judge(read, host, SIGNAL));
        const other: EngineTool = { ...tool, tool: "other" };
        const third = await engine.run(read, readCall, other, host, SIGNAL);
        assert.deepEqual(third, { text: "Blocked by jig-core: this is not the call that was judged.", isError: true });
        const stranger = { ...readCall, toolCallId: "call-9" };
        const fourth = await engine.run(stamp("read", undefined, "call-9"), stranger, tool, host, SIGNAL);
        assert.deepEqual(fourth, {
            text: "Blocked by jig-core: jig-core holds no open call with this id.",
            isError: true,
        });

        assert.equal(handed.execute.length, 0, "the tool ran for none of them");
        assert.deepEqual(world.records(), [], "nothing was written for any of them");
        assert.equal(
            engine.state.calls.get("call-3"),
            readCall,
            "the call that was judged is still the engine's, to finish",
        );
        assert.notEqual(engine.state.calls.get("call-2")?.pending, undefined, "and a waiting call still waits");
    });
});
