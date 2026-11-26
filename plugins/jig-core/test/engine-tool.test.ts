// An engine tool in Pi: `registerEngineTool` turns a tool that names no agent into a Pi tool, which Pi's own events then clean and record. The same
// tool (test/support/test-tool.ts) runs through the engine with no Pi in test/engine/run.test.ts.
import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, test } from "node:test";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { jig, withdrawJig } from "../src/client.ts";
import { registerEngineTool } from "../src/kit/tools.ts";
import { start } from "./support/harness.ts";
import type { Harness, Result } from "./support/harness.ts";
import { tempState } from "./support/state.ts";
import { stampTool, TOKEN_SHAPED } from "./support/test-tool.ts";

const state = tempState();
beforeEach(() => state.start());
afterEach(async () => {
    await h?.shutdown();
    h = undefined;
    state.stop();
});

let h: Harness | undefined;

/** Pi with jig-core loaded and the stamp tool declared and registered, as a plugin does both. */
async function begin(config?: unknown, tools: Array<{ name: string }> = []) {
    const { tool, handed } = stampTool();
    h = await start({
        ...(config === undefined ? {} : { config }),
        tools: tools as never,
        plugins: (api) => api.declareTool(tool),
    });
    registerEngineTool(h.host.pi, tool);
    return { harness: h, tool, handed };
}

/** One call: Pi asks jig-core's hook, runs the registered tool when it may, and the other two hooks run after. */
async function call(harness: Harness, id: string, input: Record<string, unknown>) {
    const registered = harness.host.registered.get("stamp") as ToolDefinition;
    return harness.call({
        tool: "stamp",
        input,
        id,
        // What Pi does with the tool: execute it with the event's id, the input, the cancel switch, the update callback and its context.
        run: () =>
            registered.execute(
                id,
                input as never,
                new AbortController().signal,
                () => {},
                harness.ctx as never,
            ) as Promise<Result>,
    });
}

const textOf = (result: Result) => result.content.map((block) => (block.type === "text" ? block.text : "")).join("");

describe("the Pi tool made from an engine tool", () => {
    test("is the tool as Pi is told of it: name, texts, parameters, and run alone and in order", async () => {
        const { harness, tool } = await begin();
        const registered = harness.host.registered.get("stamp");
        assert.equal(registered?.name, "stamp");
        assert.equal(registered?.label, tool.label);
        assert.equal(registered?.description, tool.description);
        assert.equal(registered?.promptSnippet, tool.promptSnippet);
        assert.deepEqual(registered?.promptGuidelines, tool.promptGuidelines);
        assert.equal(registered?.parameters as unknown, tool.input);
        assert.equal(registered?.executionMode, "sequential");
        // The one-line renderers of `registerJigTool` are there.
        assert.equal(typeof registered?.renderCall, "function");
        assert.equal(typeof registered?.renderResult, "function");
    });

    test("a tool that does not say sequential runs as Pi's default says, and one that has no prompt lines has none", async () => {
        const { harness } = await begin();
        const { tool } = stampTool();
        const { sequential: _sequential, promptSnippet: _snippet, promptGuidelines: _guidelines, ...rest } = tool;
        registerEngineTool(harness.host.pi, { ...rest, tool: "plain" });
        const registered = harness.host.registered.get("plain");
        assert.equal("executionMode" in (registered ?? {}), false);
        assert.equal("promptSnippet" in (registered ?? {}), false);
        assert.equal("promptGuidelines" in (registered ?? {}), false);
    });

    test("a read runs with no question, and its record line is right", async () => {
        const { harness, handed } = await begin();
        const outcome = await call(harness, "c-1", { action: "read" });
        assert.equal(outcome.ran, true);
        assert.equal(textOf(outcome.final), "stamps: none");
        assert.deepEqual(outcome.final.details, { stamps: [] });
        assert.deepEqual(harness.ui.selects, []);
        assert.equal(handed.execute[0]?.cwd, harness.ctx.cwd);

        const [record, ...more] = harness.records();
        assert.equal(more.length, 0);
        assert.equal(record?.tool, "stamp");
        assert.equal(record?.action, "read");
        assert.equal(record?.plugin, "jig-test");
        assert.equal(record?.decision, "allow");
        assert.equal(record?.outcome, "ok");
        assert.equal(record?.approval, undefined);
    });

    test("a write asks, is allowed and runs, with the preview it was shown, and the record has the approval and the facts", async () => {
        const { harness, handed } = await begin();
        const outcome = await call(harness, "c-2", { action: "write", text: "first" });
        assert.equal(outcome.ran, true);
        assert.equal(textOf(outcome.final), "stamped first");
        assert.equal(harness.ui.selects.length, 1, "Pi's screen was asked once");
        assert.match(harness.ui.selects[0]?.title ?? "", /stamp write first/);
        assert.equal(
            typeof handed.execute[0]?.seen?.fingerprint,
            "string",
            "the tool was handed the preview that was shown",
        );
        assert.equal(handed.execute[0]?.hasProgress, true);

        const [record] = harness.records();
        assert.equal(record?.decision, "ask");
        assert.equal(record?.approval, "review");
        assert.equal(record?.answer, "allow");
        assert.equal(record?.outcome, "ok");
        assert.deepEqual(record?.facts, { stamps: 1 });
    });

    test("is handed the working folder of Pi's context by classify, by preview and by execute", async () => {
        const { harness, handed } = await begin();
        await call(harness, "c-3", { action: "write", text: "folder" });
        const folder = harness.ctx.cwd;
        assert.deepEqual(handed.classify, [folder]);
        assert.deepEqual(handed.preview, [folder]);
        assert.deepEqual(
            handed.execute.map((one) => one.cwd),
            [folder],
        );
    });

    test("a refusal by the tool's own rules is an error result and a record that says refused", async () => {
        const { harness } = await begin();
        const outcome = await call(harness, "c-4", { action: "refuse" });
        assert.equal(outcome.final.isError, true);
        assert.equal(textOf(outcome.final), "stamp refused: the press is closed today");
        const [record] = harness.records();
        assert.equal(record?.outcome, "blocked");
        assert.equal(record?.errorKind, "refused");
    });

    test("any other error is an error result and a record that says the tool failed", async () => {
        const { harness } = await begin();
        const outcome = await call(harness, "c-5", { action: "fail" });
        assert.equal(outcome.final.isError, true);
        assert.equal(textOf(outcome.final), "the stamp press jammed");
        const [record] = harness.records();
        assert.equal(record?.outcome, "error");
        assert.equal(record?.errorKind, "tool");
    });

    test("a result is cleaned by Pi's hook as before: a token-shaped secret is removed", async () => {
        const { harness } = await begin();
        const outcome = await call(harness, "c-6", { action: "leak" });
        assert.equal(textOf(outcome.final).includes(TOKEN_SHAPED), false);
        assert.equal(textOf(outcome.final), "the token is [redacted]");
    });

    test("a result of the tool that is marked as an error is thrown as one, and the facts still reach the record", async () => {
        const { harness } = await begin();
        const { tool } = stampTool();
        const failing = {
            ...tool,
            tool: "failing",
            execute: async () => ({ text: "it did not work", isError: true, facts: { tried: 1 } }),
        };
        harness.api.declareTool(failing);
        registerEngineTool(harness.host.pi, failing);
        const registered = harness.host.registered.get("failing") as ToolDefinition;
        const outcome = await harness.call({
            tool: "failing",
            input: { action: "read" },
            id: "c-7",
            run: () =>
                registered.execute(
                    "c-7",
                    { action: "read" } as never,
                    undefined,
                    undefined,
                    harness.ctx as never,
                ) as Promise<Result>,
        });
        assert.equal(outcome.final.isError, true);
        assert.equal(textOf(outcome.final), "it did not work");
        const [record] = harness.records();
        assert.equal(record?.outcome, "error");
        assert.deepEqual(record?.facts, { tried: 1 });
    });

    test("is registered again as deferred when jig.json names it, as a tool of registerJigTool is", async () => {
        const { harness } = await begin({ tools: { deferred: ["stamp"] } }, [
            { name: "tool_search", reachesTools: () => "all" } as never,
        ]);
        const handlers = harness.host.handlers.get("session_start") ?? [];
        // The handler `registerJigTool` added for this plugin is the last one.
        await (handlers.at(-1) as (event: unknown, ctx: unknown) => unknown)(
            { type: "session_start", reason: "startup" },
            harness.ctx,
        );
        assert.equal(harness.host.registered.get("stamp")?.exposure, "deferred");
    });

    test("works only while jig-core is loaded: with it withdrawn the tool fails closed and does not run", async () => {
        const { harness, handed } = await begin();
        withdrawJig(jig());
        const registered = harness.host.registered.get("stamp") as ToolDefinition;
        await assert.rejects(
            registered.execute("c-8", { action: "read" } as never, undefined, undefined, harness.ctx as never),
            /jig-core is not loaded/,
        );
        assert.equal(handed.execute.length, 0);
    });
});
