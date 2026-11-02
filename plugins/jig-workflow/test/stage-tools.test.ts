// A stage's tools: switched on when the work enters the stage, off when it leaves, except a tool the user switched on, and the
// same after a reload or a resume. First the logic against a small stand-in for Pi's tool set, then a whole session.
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { SessionEntry } from "@earendil-works/pi-coding-agent";
import { parseWorkflow } from "../src/definition.ts";
import { STAGE_TOOLS_ENTRY, StageTools, SWITCHES_ENTRY } from "../src/stage-tools.ts";
import type { SavedStageTools, StageInPlay, ToolHost } from "../src/stage-tools.ts";
import { useWorlds, world } from "./world.ts";

/** Pi's tool set and the session's entries, as the stage tools see them. */
class FakeTools implements ToolHost {
    known = ["read", "bash", "edit", "write", "git", "pr", "ci", "deploy", "logs"];
    active = ["read", "bash", "edit", "write", "git"];
    /** Tools Pi keeps off whatever is asked (an allow-list on its command line). */
    refused = new Set<string>();
    log: unknown[] = [];
    notices: string[] = [];
    toolNames = () => [...this.known];
    activeTools = () => [...this.active];
    setActiveTools = (names: string[]) => {
        this.active = [...new Set(names.filter((name) => this.known.includes(name) && !this.refused.has(name)))];
    };
    entries = () => this.log;
    save = (data: SavedStageTools) => {
        this.log.push({ type: "custom", customType: STAGE_TOOLS_ENTRY, data });
    };
    notify = (text: string) => {
        this.notices.push(text);
    };
    /** What jig-session saves when the user switches tools. */
    switched(tools: Record<string, boolean>): void {
        this.log.push({ type: "custom", customType: SWITCHES_ENTRY, data: { tools, skillsOff: [] } });
    }
}

const stage = (id: string, tools: string[]): StageInPlay => ({ key: `PROJ-1 feature ${id}`, stage: id, tools });

describe("a stage's tools", () => {
    test("entering a stage switches its tools on; leaving switches off only what it switched on", () => {
        const pi = new FakeTools();
        const tools = new StageTools();
        tools.sync(pi, stage("build", []), true);
        tools.sync(pi, stage("deliver", ["pr", "ci", "git"]), false);
        assert.deepEqual(pi.active, ["read", "bash", "edit", "write", "git", "pr", "ci"]);
        assert.deepEqual(tools.current.added, ["pr", "ci"], "git was on already, so it is not the stage's");
        tools.sync(pi, stage("accept", ["logs"]), false);
        assert.deepEqual(pi.active, ["read", "bash", "edit", "write", "git", "logs"]);
        tools.sync(pi, undefined, false);
        assert.deepEqual(pi.active, ["read", "bash", "edit", "write", "git"]);
    });

    test("the same stage again changes nothing, so a tool the user switched off stays off", () => {
        const pi = new FakeTools();
        const tools = new StageTools();
        tools.sync(pi, stage("deliver", ["ci"]), true);
        pi.active = pi.active.filter((name) => name !== "ci");
        pi.switched({ ci: false });
        tools.sync(pi, stage("deliver", ["ci"]), false);
        assert.equal(pi.active.includes("ci"), false);
    });

    test("a tool the user switched on while in the stage stays on when the work leaves it", () => {
        const pi = new FakeTools();
        const tools = new StageTools();
        tools.sync(pi, stage("deliver", ["pr", "ci"]), true);
        pi.switched({ ci: true });
        tools.sync(pi, stage("accept", []), false);
        assert.ok(pi.active.includes("ci"), "switched on by the user");
        assert.equal(pi.active.includes("pr"), false);
        assert.deepEqual(tools.current.added, []);
    });

    test("a tool both stages name stays on, and still counts as the stage's", () => {
        const pi = new FakeTools();
        const tools = new StageTools();
        tools.sync(pi, stage("deliver", ["ci"]), true);
        tools.sync(pi, stage("accept", ["ci", "logs"]), false);
        assert.deepEqual(tools.current.added, ["ci", "logs"]);
        tools.sync(pi, stage("done", []), false);
        assert.equal(pi.active.includes("ci"), false);
    });

    test("a tool the session does not have is ignored, with one notice", () => {
        const pi = new FakeTools();
        const tools = new StageTools();
        tools.sync(pi, stage("deliver", ["ci", "nosuch"]), true);
        tools.sync(pi, stage("build", []), false);
        tools.sync(pi, stage("deliver", ["ci", "nosuch"]), false);
        assert.deepEqual(pi.notices, [
            "jig-workflow: the stage deliver names the tool nosuch, which this session does not have (ignored)",
        ]);
        assert.ok(pi.active.includes("ci"));
    });

    test("a tool Pi keeps off is not counted as added", () => {
        const pi = new FakeTools();
        pi.refused.add("ci");
        const tools = new StageTools();
        tools.sync(pi, stage("deliver", ["pr", "ci"]), true);
        assert.deepEqual(tools.current.added, ["pr"]);
    });

    test("a reload or a resume reads back what was added, and switches it on again unless the user switched it off", () => {
        const pi = new FakeTools();
        const first = new StageTools();
        first.sync(pi, stage("deliver", ["pr", "ci"]), true);
        // A resume: a new runtime, Pi's active set without the stage's tools, the session's entries kept.
        pi.active = ["read", "bash", "edit", "write", "git"];
        pi.switched({ pr: false });
        const second = new StageTools();
        second.sync(pi, stage("deliver", ["pr", "ci"]), true);
        assert.ok(pi.active.includes("ci"));
        assert.equal(pi.active.includes("pr"), false, "the user switched it off");
        assert.deepEqual(second.current.added, ["pr", "ci"]);
        // Leaving after the resume takes out what the earlier runtime added, and nothing that was on anyway.
        second.sync(pi, stage("accept", []), false);
        assert.deepEqual(pi.active, ["read", "bash", "edit", "write", "git"]);
    });

    test("after a start, the first prompt checks again: a plugin that starts later may have taken a deferred tool out", () => {
        const pi = new FakeTools();
        const tools = new StageTools();
        tools.sync(pi, stage("deliver", ["ci"]), true);
        pi.active = pi.active.filter((name) => name !== "ci"); // jig-ops registers `ci` deferred at its own start
        tools.sync(pi, stage("deliver", ["ci"]), false);
        assert.ok(pi.active.includes("ci"));
        pi.active = pi.active.filter((name) => name !== "ci");
        tools.sync(pi, stage("deliver", ["ci"]), false);
        assert.equal(pi.active.includes("ci"), false, "only the first prompt after a start");
    });
});

describe("the tools field of a stage", () => {
    const file = (tools: unknown) => JSON.stringify({ name: "w", stages: [{ id: "deliver", tools }, { id: "done" }] });

    test("is a list of tool names", () => {
        const parsed = parseWorkflow(file(["pr", "ci"]), "w");
        assert.deepEqual(parsed.errors, []);
        assert.deepEqual(parsed.workflow?.stages[0]?.tools, ["pr", "ci"]);
        assert.equal(parsed.workflow?.stages[1]?.tools, undefined);
    });

    test("refuses what is not a list of names, and a name twice", () => {
        assert.match(parseWorkflow(file("ci"), "w").errors[0] ?? "", /stages\[0\]\.tools: must be a list/);
        assert.match(
            parseWorkflow(file(["git push"]), "w").errors[0] ?? "",
            /stages\[0\]\.tools\[0\]: .* not a tool name/,
        );
        assert.match(
            parseWorkflow(file(["ci", "ci"]), "w").errors[0] ?? "",
            /stages\[0\]\.tools\[1\]: "ci" is listed twice/,
        );
    });
});

describe("in a session", () => {
    useWorlds();

    const SIMPLE = {
        name: "simple",
        match: { ticket: "^PROJ-\\d+$" },
        stages: [{ id: "build" }, { id: "deliver", tools: ["ci", "nosuch"] }, { id: "done" }],
    };

    test("advance and back switch the stage's tools, and a resume keeps them", async (t) => {
        const w = await world(t, { workflows: { simple: SIMPLE }, noSession: true });
        const tools = {
            all: ["read", "bash", "edit", "write", "workflow", "ci"],
            active: ["read", "bash", "workflow"],
        };
        Object.assign(w.pi.api, {
            getAllTools: () => tools.all.map((name) => ({ name, exposure: name === "ci" ? "deferred" : "direct" })),
            getActiveTools: () => [...tools.active],
            setActiveTools: (names: string[]) => {
                tools.active = names.filter((name) => tools.all.includes(name));
            },
            appendEntry: (customType: string, data: unknown) =>
                void w.entries.push({ type: "custom", customType, data } as unknown as SessionEntry),
        });
        await w.pi.fire("session_start", { reason: "startup" }, w.ctx);
        w.activate("PROJ-1");
        assert.equal((await w.call({ action: "start", name: "simple" })).isError, false);
        await w.pi.fire("tool_result", { toolCallId: "a", toolName: "workflow", isError: false }, w.ctx);
        assert.deepEqual(tools.active, ["read", "bash", "workflow"], "build names no tools");

        assert.match((await w.call({ action: "advance" })).text, /Moved PROJ-1 from build to deliver/);
        await w.pi.fire("tool_result", { toolCallId: "b", toolName: "workflow", isError: false }, w.ctx);
        assert.ok(tools.active.includes("ci"), "a deferred tool is switched on by its stage");
        assert.equal(w.notices.filter((notice) => /names the tool nosuch/.test(notice.text)).length, 1);

        // A resume: the session's entries are kept, Pi starts with its own active set.
        tools.active = ["read", "bash", "workflow"];
        await w.pi.fire("session_start", { reason: "resume" }, w.ctx);
        assert.ok(tools.active.includes("ci"));

        assert.match((await w.call({ action: "back" })).text, /Moved PROJ-1 back from deliver to build/);
        await w.pi.fire("before_agent_start", { prompt: "go on" }, w.ctx);
        assert.equal(tools.active.includes("ci"), false);
    });
});
