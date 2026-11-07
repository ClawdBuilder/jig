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
    assert.deepEqual(Object.keys(payload).sort(), ["at", "from", "ticket", "to", "workflow"]);
    assert.equal(payload.ticket, "PROJ-1");
    assert.equal(payload.from, null);
    assert.equal(payload.to, "understand");
    assert.equal(typeof payload.at, "string");
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
