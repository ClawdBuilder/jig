import assert from "node:assert/strict";
import { test } from "node:test";
import { JIG_EVENTS } from "../../jig-core/src/contract.ts";
import { useWorlds, world } from "./world.ts";

useWorlds();

test("start publishes a text-free stage-done event on Pi's bus", async (t) => {
    const w = await world(t);
    const seen: unknown[] = [];
    w.pi.api.events.on(JIG_EVENTS.stageDone, (payload) => seen.push(payload));
    w.activate("PROJ-1");
    w.bind(w.orders);
    const result = await w.call({ action: "start" });
    assert.equal(result.isError, false, result.text);
    assert.equal(seen.length, 1);
    const payload = seen[0] as Record<string, unknown>;
    assert.deepEqual(Object.keys(payload).sort(), ["at", "from", "last", "ticket", "to", "via", "workflow"]);
    assert.equal(payload.ticket, "PROJ-1");
    assert.equal(payload.from, null);
    assert.equal(payload.last, false);
    assert.equal(payload.via, "start");
    assert.equal(payload.to, "understand");
    assert.equal(typeof payload.at, "string");
});

test("advance, back and a refused advance emit exactly the real moves", async (t) => {
    const w = await world(t);
    const seen: Array<Record<string, unknown>> = [];
    w.pi.api.events.on(JIG_EVENTS.stageDone, (payload) => seen.push(payload as Record<string, unknown>));
    w.activate("PROJ-1");
    w.bind(w.orders);
    await w.call({ action: "start" });
    seen.length = 0;
    w.writeNotes("# notes\nnew fact\n");
    await w.call({ action: "advance" });
    assert.equal(seen.length, 1);
    assert.deepEqual([seen[0]?.from, seen[0]?.to], ["understand", "plan"]);
    const at = seen[0]?.at;
    assert.equal(w.state()?.history.at(-1)?.at, at, "the event time is the state history time");
    await w.call({ action: "back", to: "understand" });
    assert.equal(seen.length, 2);
    assert.deepEqual([seen[1]?.from, seen[1]?.to], ["plan", "understand"]);
    await w.call({ action: "advance" });
    assert.equal(seen.length, 2, "a refused advance emits nothing");
    w.writeState((state) => {
        state.stage = "done";
    });
    await w.call({ action: "advance" });
    assert.equal(seen.length, 2, "the last stage emits nothing");
});

test("the call records text-free facts for the lens", async (t) => {
    const w = await world(t);
    w.activate("PROJ-1");
    w.bind(w.orders);
    await w.call({ action: "start" });
    const record = w.core
        .records()
        .filter((entry) => entry.tool === "workflow")
        .at(-1);
    assert.equal(record?.facts?.stage, "understand");
    assert.equal(record?.facts?.workflow, "feature");
});
