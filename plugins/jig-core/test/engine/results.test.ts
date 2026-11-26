// `clean` and `finish`, with no Pi: the result of a tool the agent ran is cleaned, and the call's one record is written, with a host of our own.
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { cleanResult } from "../../src/engine-results.ts";
import { ALLOW, request, SIGNAL, useWorlds } from "./harness.ts";

const open = useWorlds();

/** Made from parts, so that no secret-shaped text is written in this file. */
const SECRET = ["sk", "live", "0123456789abcdefghij"].join("-");

describe("clean and finish", () => {
    test("clean redacts a secret and says what changed; a result with nothing to clean comes back as it was", () => {
        const { engine, host } = open();
        engine.state.redactor.register(SECRET);
        const dirty = { content: [{ type: "text", text: `key ${SECRET} end` }], isError: false };
        const cleaned = cleanResult(engine.state, request("mystery"), dirty, host);
        assert.equal(cleaned.withheld, false);
        assert.equal(cleaned.changed.content, true);
        const text = (cleaned.result.content[0] as { text: string }).text;
        assert.equal(text.includes(SECRET), false);
        assert.deepEqual(engine.clean(request("mystery"), dirty, host), cleaned.result);

        const plain = {
            content: [{ type: "text", text: "hello" }],
            structured: { a: 1 },
            details: { b: 2 },
            isError: false,
        };
        const same = cleanResult(engine.state, request("mystery"), plain, host);
        assert.deepEqual(same.changed, { content: false, structured: false, details: false });
        assert.equal(same.result.content, plain.content, "an unchanged part is the one that came in");
        assert.equal(same.result.structured, plain.structured);
    });

    test("a result that cannot be cleaned is withheld, and the record says so", async () => {
        const world = open({
            engine: {
                createMasker: () => {
                    throw new Error("no key");
                },
            },
            answers: [ALLOW],
        });
        const { engine, host } = world;
        await engine.judge(request("mystery"), host, SIGNAL);
        // A production call is masked; this one is made to look like one, so that the failing masker is reached.
        const call = engine.state.calls.get("call-1");
        if (call !== undefined) call.masked = true;
        const result = engine.clean(
            request("mystery"),
            { content: [{ type: "text", text: "customer data" }], isError: false },
            host,
        );
        assert.deepEqual(result, {
            content: [{ type: "text", text: "result withheld: it could not be masked" }],
            details: {},
            isError: true,
        });
        engine.finish(request("mystery"), { isError: true, text: "result withheld: it could not be masked" }, host);
        const [record] = world.records();
        assert.equal(record?.outcome, "error");
        assert.equal(record?.errorKind, "withheld");
    });

    test("finish writes one record line with the session of the host, and forgets the call", async () => {
        const world = open({ answers: [ALLOW] });
        const { engine, host } = world;
        await engine.judge(request("mystery", "call-7"), host, SIGNAL);
        engine.finish(request("mystery", "call-7"), { isError: false, durationMs: 12.4 }, host);
        assert.equal(engine.state.calls.size, 0);
        const records = world.records();
        assert.equal(records.length, 1);
        assert.deepEqual(
            { ...records[0], id: undefined, time: undefined },
            {
                id: undefined,
                time: undefined,
                kind: "call",
                session: "session-1",
                agentRole: "main",
                tool: "mystery",
                environment: "external",
                environmentKind: "external",
                effect: "write",
                decision: "ask",
                decisionSource: "unknown",
                approval: "dialog",
                answer: "allow",
                waitedMs: 5,
                outcome: "ok",
                durationMs: 12,
                toolCallId: "call-7",
            },
        );
    });

    test("a refused call is recorded as blocked, with the kind and the line, and a call the engine never judged as not run", async () => {
        const world = open({ canAsk: false });
        const { engine, host } = world;
        await engine.judge(request("mystery", "call-8"), host, SIGNAL);
        engine.finish(request("mystery", "call-8"), { isError: true, text: "Blocked by jig-core: ..." }, host);
        engine.finish(request("other", "call-9"), { isError: true, text: "invalid arguments" }, host);
        const [blocked, notRun] = world.records();
        assert.equal(blocked?.outcome, "blocked");
        assert.equal(blocked?.errorKind, "no-screen");
        assert.match(String(blocked?.error), /^blocked: this call needs approval/);
        assert.equal(notRun?.outcome, "error");
        assert.equal(notRun?.errorKind, "not-run");
        assert.equal(notRun?.error, undefined, "the agent's own message can quote the arguments, so it is not kept");
    });
});
