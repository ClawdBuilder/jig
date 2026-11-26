// `judge`, with no Pi: steps 1 to 3 of a call, driven with a host of our own. The same code runs behind Pi's hook, whose tests (gate.test.ts and
// the others) pass unchanged.
import assert from "node:assert/strict";
import path from "node:path";
import { describe, test } from "node:test";
import type { EngineHost } from "../../src/engine.ts";
import { ALLOW, eventAt, request, SIGNAL, useWorlds } from "./harness.ts";

const open = useWorlds();

describe("judge", () => {
    test("a local read runs with no question, and the decision is announced", async () => {
        const { engine, host, log } = open();
        const judged = await engine.judge(request("read", "call-1", { path: "notes.txt" }), host, SIGNAL);
        assert.equal(judged.verdict, "run");
        assert.deepEqual(log.asked, []);
        assert.equal(log.emitted.length, 1);
        assert.equal(log.emitted[0]?.name, "jig:decision");
        assert.equal(eventAt(log, 0).decision, "allow");
        assert.equal(engine.state.calls.get("call-1")?.tool, "read");
    });

    test("an unknown tool asks the host, and an answer to allow lets it run with the preview it was shown", async () => {
        const { engine, host, log } = open({ answers: [ALLOW] });
        const judged = await engine.judge(request("mystery"), host, SIGNAL);
        assert.equal(judged.verdict, "run");
        assert.equal(log.asked.length, 1);
        assert.equal(log.asked[0]?.kind, "dialog");
        assert.match(log.asked[0]?.header ?? "", /mystery/);
        const call = engine.state.calls.get("call-1");
        assert.deepEqual(call?.approval, { kind: "dialog", answer: "allow", waitedMs: 5 });
        assert.equal(call?.approvedPreview?.summary, log.asked[0]?.preview.summary);
        assert.equal(eventAt(log, 0).answer, "allow");
    });

    test("with no screen an ask is refused as no-screen, and nobody is asked", async () => {
        const { engine, host, log } = open({ canAsk: false });
        const judged = await engine.judge(request("mystery"), host, SIGNAL);
        assert.deepEqual(judged, {
            verdict: "refused",
            kind: "no-screen",
            reason: "Blocked by jig-core: this call needs approval and there is no screen to ask on.",
        });
        assert.deepEqual(log.asked, []);
        assert.equal(engine.state.calls.get("call-1")?.blocked?.kind, "no-screen");
    });

    test("a decline refuses the call with the reason, and a closed question says so", async () => {
        const { engine, host } = open({
            answers: [
                { answer: "decline", dismissed: false, reason: "too risky", waitedMs: 1 },
                { answer: "decline", dismissed: true, waitedMs: 1 },
            ],
        });
        assert.deepEqual(await engine.judge(request("mystery", "a"), host, SIGNAL), {
            verdict: "refused",
            kind: "declined",
            reason: "Blocked by jig-core: the user declined this call, and said: too risky",
        });
        assert.deepEqual(await engine.judge(request("mystery", "b"), host, SIGNAL), {
            verdict: "refused",
            kind: "dismissed",
            reason: "Blocked by jig-core: the question was closed without an answer",
        });
    });

    test("a protected path asks only when the host can ask about one", async () => {
        // A write outside the working folder needs approval, and only a person at a terminal can give it.
        const outside = (world: { cwd: string }) => ({
            path: path.join(path.parse(world.cwd).root, "jig-elsewhere", "notes.txt"),
        });

        const cannot = open({ canAsk: true, canAskProtected: false });
        const refused = await cannot.engine.judge(request("write", "call-1", outside(cannot)), cannot.host, SIGNAL);
        assert.equal(refused.verdict, "refused");
        if (refused.verdict === "refused") {
            assert.equal(refused.kind, "denied");
            assert.match(refused.reason, /outside the folders bash can write/);
        }
        assert.deepEqual(cannot.log.asked, [], "nobody was asked");

        const can = open({ canAsk: true, canAskProtected: true });
        const asked = await can.engine.judge(request("write", "call-1", outside(can)), can.host, SIGNAL);
        assert.equal(asked.verdict, "run");
        assert.equal(can.log.asked.length, 1);
        assert.match(can.log.asked[0]?.preview.summary ?? "", /write/);
        assert.equal(can.engine.state.calls.get("call-1")?.approval?.answer, "allow");
    });

    test("a failure refuses the call as internal, with the error in the reason", async () => {
        const { engine, host } = open();
        const broken: EngineHost = {
            ...host,
            ask: () => {
                throw new Error("the screen is gone");
            },
        };
        const judged = await engine.judge(request("mystery"), broken, SIGNAL);
        assert.deepEqual(judged, {
            verdict: "refused",
            kind: "internal",
            reason: "jig-core could not decide: the screen is gone",
        });
        assert.equal(engine.state.calls.get("call-1")?.blocked?.kind, "internal");
    });
});
