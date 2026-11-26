// The engine's state, with no Pi: it holds no agent, and a whole call and a whole session run with a trap set on the one name Pi's wrapper adds.
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { engineOf } from "../../src/engine.ts";
import { stampTool } from "../support/test-tool.ts";
import { request, SIGNAL, useWorlds } from "./harness.ts";

const open = useWorlds();

describe("the engine's state", () => {
    test("has no agent: the state holds no `pi`, and a read of one fails the test", async () => {
        const world = open();
        const { engine, host } = world;
        assert.equal("pi" in engine.state, false);
        assert.equal(engineOf(engine.state), engine, "the same state gives the same engine");
        Object.defineProperty(engine.state, "pi", {
            get() {
                throw new Error("engine code read state.pi");
            },
        });
        // A whole session and a whole call of each kind, with the trap set: one the agent runs, and one the engine runs.
        engine.start(host);
        engine.beginSession();
        const judged = await engine.judge(request("mystery"), host, SIGNAL);
        assert.equal(judged.verdict, "run");
        engine.clean(request("mystery"), { content: [{ type: "text", text: "ok" }], isError: false }, host);
        engine.finish(request("mystery"), { isError: false }, host);

        const { tool } = stampTool();
        engine.state.declarations.set(tool.tool, tool);
        const read = request("stamp", "call-2", { action: "read" });
        const ready = await engine.judge(read, host, SIGNAL);
        assert.equal(ready.verdict, "run");
        if (ready.verdict !== "run") return;
        assert.equal((await engine.run(read, ready.call, tool, host, SIGNAL)).text, "stamps: none");
        await engine.stop();
    });
});
