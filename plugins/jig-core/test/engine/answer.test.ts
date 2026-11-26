// `answer`, with no Pi: the answer to a question that was put by another request, and what a call that waits holds meanwhile.
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { ALLOW, eventAt, request, SIGNAL, useWorlds } from "./harness.ts";

const open = useWorlds();

describe("answer", () => {
    test("a call whose answer comes later waits, and the answer then lets it run and is remembered for the session", async () => {
        const { engine, host, log } = open({ answers: ["later"] });
        const waiting = await engine.judge(request("mystery"), host, SIGNAL);
        assert.equal(waiting.verdict, "waiting");
        if (waiting.verdict !== "waiting") return;
        assert.equal(waiting.request, log.asked[0]);
        assert.notEqual(waiting.call.pending, undefined);
        assert.equal(engine.state.calls.get("call-1"), waiting.call);

        const run = engine.answer(waiting.call, { answer: "allow-session", dismissed: false, waitedMs: 40 }, host);
        assert.equal(run.verdict, "run");
        assert.equal(waiting.call.pending, undefined);
        assert.deepEqual(waiting.call.approval, { kind: "dialog", answer: "allow-session", waitedMs: 40 });
        assert.equal(engine.state.sessionAllows.size, 1);
        assert.equal(eventAt(log, -1).answer, "allow-session");

        // The same call again is allowed by the session, so the host is not asked.
        const again = await engine.judge(request("mystery", "call-2"), host, SIGNAL);
        assert.equal(again.verdict, "run");
        assert.equal(log.asked.length, 1);
    });

    test("a decline that comes later refuses the call, and an answer for a call that is not waiting refuses it too", async () => {
        const { engine, host } = open({ answers: ["later", ALLOW] });
        const waiting = await engine.judge(request("mystery"), host, SIGNAL);
        assert.equal(waiting.verdict, "waiting");
        if (waiting.verdict !== "waiting") return;
        const refused = engine.answer(waiting.call, { answer: "decline", dismissed: false, waitedMs: 2 }, host);
        assert.deepEqual(refused, {
            verdict: "refused",
            kind: "declined",
            reason: "Blocked by jig-core: the user declined this call",
        });

        const ran = await engine.judge(request("mystery", "call-2"), host, SIGNAL);
        assert.equal(ran.verdict, "run");
        if (ran.verdict !== "run") return;
        const stale = engine.answer(ran.call, ALLOW, host);
        assert.equal(stale.verdict, "refused");
        assert.equal(ran.call.blocked?.kind, "internal");
    });
});
