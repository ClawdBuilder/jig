// Deferred Jig tools: the `tools` section of jig.json, `registerJigTool` (kit/tools.ts) and the session start that
// activates Pi's `tool_search`. Pi's tool set is played by a small registry that follows Pi's rules for exposure
// (docs/extensions.md, "Tool Exposure"): a direct tool is activated when it is registered, a deferred one is not, and
// `tool_search` activates the deferred tools it finds.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, test } from "node:test";
import type { ExtensionAPI, ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { jig, withdrawJig } from "../src/client.ts";
import { jigCore } from "../src/index.ts";
import { NOT_DEFERRABLE, registerJigTool, transcriptTools } from "../src/kit/tools.ts";
import { RefusedError } from "../src/kit/values.ts";
import { validateToolsSection } from "../src/tool-exposure.ts";
import { fakeContext, fakePi } from "./support/fake-pi.ts";
import type { FakePi } from "./support/fake-pi.ts";
import { tempState } from "./support/state.ts";

const state = tempState();
let agentDir = "";
const savedAgentDir = process.env.PI_CODING_AGENT_DIR;
beforeEach(() => {
    state.start();
    agentDir = mkdtempSync(path.join(tmpdir(), "jig-tools-agent-"));
    process.env.PI_CODING_AGENT_DIR = agentDir;
});
afterEach(() => {
    try {
        withdrawJig(jig());
    } catch {
        // Not loaded in this test.
    }
    state.stop();
    rmSync(agentDir, { recursive: true, force: true });
    if (savedAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = savedAgentDir;
});

function writeConfig(config: unknown): void {
    writeFileSync(path.join(agentDir, "jig.json"), JSON.stringify(config));
}

interface Entry {
    tool: ToolDefinition;
    source: string;
}

/** Pi's tool set, shared by every extension: what is registered, with which exposure, and what is active. */
class Tools {
    readonly registry = new Map<string, Entry>();
    active: string[] = ["read", "bash", "edit", "write"];

    constructor(toolSearch: boolean) {
        for (const name of ["read", "bash", "edit", "write"]) this.add({ name } as ToolDefinition, "builtin");
        if (toolSearch) {
            // Pi's built-in extension registers it inactive.
            this.add(
                { name: "tool_search", defaultActive: false, reachesTools: () => "all" } as unknown as ToolDefinition,
                "builtin",
            );
        }
    }

    private declarable(tool: ToolDefinition | undefined): boolean {
        const exposure = tool?.exposure ?? "direct";
        return exposure === "direct" || exposure === "model-only";
    }

    add(tool: ToolDefinition, source: string): void {
        const before = this.registry.get(tool.name)?.tool;
        const wasActivated = before !== undefined && this.declarable(before) && before.defaultActive !== false;
        this.registry.set(tool.name, { tool, source });
        if (!wasActivated && this.declarable(tool) && tool.defaultActive !== false && !this.active.includes(tool.name))
            this.active.push(tool.name);
    }

    set(names: string[]): void {
        this.active = [...new Set(names.filter((name) => this.registry.has(name) && this.exposure(name) !== "hidden"))];
    }

    exposure(name: string): string {
        return this.registry.get(name)?.tool.exposure ?? "direct";
    }

    all() {
        return [...this.registry.values()].map(({ tool }) => ({
            name: tool.name,
            description: tool.description ?? "",
            parameters: tool.parameters,
            exposure: tool.exposure ?? "direct",
            ...(tool.reachesTools === undefined ? {} : { reachesTools: tool.reachesTools }),
        }));
    }

    /** What `tool_search` does with a query: the deferred tools whose name or description has a word of it, activated. */
    search(query: string): string[] {
        const words = query.toLowerCase().split(/\W+/).filter(Boolean);
        const found = [...this.registry.values()]
            .filter(({ tool }) => tool.exposure === "deferred" || tool.exposure === "codemode")
            .filter(({ tool }) =>
                words.some((word) => `${tool.name} ${tool.description ?? ""}`.toLowerCase().includes(word)),
            )
            .map(({ tool }) => tool.name);
        this.set([...this.active, ...found]);
        return found;
    }
}

/** An extension's own `pi`, on the shared tool set. */
function extension(tools: Tools, source: string): FakePi {
    const host = fakePi();
    Object.assign(host.pi, {
        registerTool: (tool: ToolDefinition) => {
            host.registered.set(tool.name, tool);
            tools.add(tool, source);
        },
        getAllTools: () => tools.all(),
        getActiveTools: () => [...tools.active],
        setActiveTools: (names: string[]) => tools.set(names),
    });
    return host;
}

function tool(name: string, description = `The ${name} tool`): ToolDefinition {
    return {
        name,
        label: name,
        description,
        parameters: Type.Object({}),
        execute: async () => ({ content: [{ type: "text", text: name }], details: {} }),
    } as unknown as ToolDefinition;
}

/** jig-core and one plugin that registers and declares `names`, loaded as Pi loads them. */
function load(options: { toolSearch?: boolean; names?: string[]; company?: unknown } = {}) {
    const tools = new Tools(options.toolSearch ?? true);
    const core = extension(tools, "jig-core");
    jigCore()(core.pi);
    const plugin = extension(tools, "jig-test");
    const api = jig();
    if (options.company !== undefined) api.config.addSectionDefaults("tools", options.company);
    for (const name of options.names ?? ["mongo", "ops"]) {
        api.declareTool({ tool: name, plugin: "jig-test", classify: () => ({ environment: "local", effect: "read" }) });
        registerJigTool(plugin.pi, tool(name));
    }
    return {
        tools,
        core,
        plugin,
        async start(branch: unknown[] = [], context = fakeContext({ branch })) {
            await core.fire("session_start", { reason: "startup" }, context.ctx);
            await plugin.fire("session_start", { reason: "startup" }, context.ctx);
            return context.log;
        },
    };
}

describe("the tools section", () => {
    test("takes a list of tool names under deferred", () => {
        assert.deepEqual(validateToolsSection({ deferred: ["mongo", "ops"] }), []);
        assert.deepEqual(validateToolsSection({}), []);
        // A name no plugin has is not an error here: the tools are not all registered when the file is read.
        assert.deepEqual(validateToolsSection({ deferred: ["nothing-like-it"] }), []);
    });

    test("refuses what is not a list of names, an unknown field, and Pi's own tools", () => {
        assert.match(validateToolsSection(["mongo"])[0] ?? "", /tools must be an object/);
        assert.match(validateToolsSection({ deferred: "mongo" })[0] ?? "", /tools.deferred must be a list/);
        assert.match(validateToolsSection({ deferred: [3] })[0] ?? "", /tools.deferred\[0\] must be a tool name/);
        assert.match(validateToolsSection({ hidden: [] })[0] ?? "", /tools.hidden: unknown field/);
        for (const name of ["read", "bash", "edit", "write", "tool_search"]) {
            assert.ok(NOT_DEFERRABLE.has(name));
            assert.match(validateToolsSection({ deferred: [name] })[0] ?? "", /is Pi's own tool and is never deferred/);
        }
    });
});

describe("registerJigTool", () => {
    test("with nothing deferred, a tool is registered direct and active, as pi.registerTool would, and tool_search stays off", async () => {
        const world = load();
        await world.start();
        assert.equal(world.tools.exposure("mongo"), "direct");
        assert.ok(world.tools.active.includes("mongo"));
        assert.ok(world.tools.active.includes("ops"));
        assert.equal(world.tools.active.includes("tool_search"), false);
    });

    test("a tool named in tools.deferred is registered deferred at session start, out of the active set, and tool_search is on", async () => {
        writeConfig({ tools: { deferred: ["mongo"] } });
        const world = load();
        await world.start();
        assert.equal(world.tools.exposure("mongo"), "deferred");
        assert.equal(world.tools.active.includes("mongo"), false);
        assert.equal(world.tools.exposure("ops"), "direct");
        assert.ok(world.tools.active.includes("ops"));
        assert.ok(world.tools.active.includes("tool_search"));
        // Pi's own tools are untouched.
        for (const name of ["read", "bash", "edit", "write"]) assert.ok(world.tools.active.includes(name), name);
    });

    test("tool_search finds the deferred tool and activates it, the same definition the plugin registered", async () => {
        writeConfig({ tools: { deferred: ["mongo"] } });
        const world = load();
        await world.start();
        assert.deepEqual(world.tools.search("query a mongo database"), ["mongo"]);
        assert.ok(world.tools.active.includes("mongo"));
        const registered = world.tools.registry.get("mongo")?.tool;
        assert.equal(registered?.description, "The mongo tool");
        assert.equal(typeof registered?.execute, "function");
    });

    test("registered again during the session (a new description), a deferred tool stays deferred and stays loaded", async () => {
        writeConfig({ tools: { deferred: ["mongo"] } });
        const world = load();
        await world.start();
        world.tools.search("mongo");
        registerJigTool(world.plugin.pi, tool("mongo", "The mongo tool, described again"));
        assert.equal(world.tools.exposure("mongo"), "deferred");
        assert.ok(world.tools.active.includes("mongo"));
    });

    test("a resumed session whose transcript shows the tool loaded keeps it active", async () => {
        writeConfig({ tools: { deferred: ["mongo", "ops"] } });
        const world = load();
        const branch = [
            { type: "message", message: { role: "system", toolsAdded: [{ name: "read" }] } },
            { type: "message", message: { role: "system", toolsAdded: [{ name: "mongo" }, { name: "ops" }] } },
            { type: "message", message: { role: "system", toolsRemoved: [{ name: "ops" }] } },
        ];
        assert.deepEqual([...transcriptTools(fakeContext({ branch }).ctx)].sort(), ["mongo", "read"]);
        await world.start(branch);
        assert.equal(world.tools.exposure("mongo"), "deferred");
        assert.ok(world.tools.active.includes("mongo"), "loaded before the resume");
        assert.equal(world.tools.active.includes("ops"), false, "unloaded before the resume");
    });

    test("without a tool_search in Pi, every tool stays direct and the user is told once", async () => {
        writeConfig({ tools: { deferred: ["mongo"] } });
        const world = load({ toolSearch: false });
        const log = await world.start();
        assert.equal(world.tools.exposure("mongo"), "direct");
        assert.ok(world.tools.active.includes("mongo"));
        const said = log.notifications.filter((note) => /has no tool_search/.test(note.message));
        assert.equal(said.length, 1);
    });

    test("a name that is not a Jig tool is a warning, said once, and the rest still applies", async () => {
        writeConfig({ tools: { deferred: ["mongo", "nosuch"] } });
        const world = load();
        const context = fakeContext();
        await world.start([], context);
        await world.start([], context);
        const said = context.log.notifications.filter((note) => /names no Jig tool: nosuch/.test(note.message));
        assert.equal(said.length, 1);
        assert.equal(said[0]?.type, "warning");
        assert.equal(world.tools.exposure("mongo"), "deferred");
    });

    test("only unknown names: nothing is deferred, so tool_search stays off", async () => {
        writeConfig({ tools: { deferred: ["nosuch"] } });
        const world = load();
        await world.start();
        assert.equal(world.tools.active.includes("tool_search"), false);
    });

    test("a company plugin's default applies, and the user's own list replaces it", async () => {
        const company = load({ company: { deferred: ["ops"] } });
        await company.start();
        assert.equal(company.tools.exposure("ops"), "deferred");
        withdrawJig(jig());

        writeConfig({ tools: { deferred: [] } });
        const mine = load({ company: { deferred: ["ops"] } });
        await mine.start();
        assert.equal(mine.tools.exposure("ops"), "direct");
        assert.ok(mine.tools.active.includes("ops"));
    });

    test("Pi's own tools are never deferred, even when a plugin registers one through the helper", async () => {
        writeConfig({ tools: { deferred: ["mongo"] } });
        const tools = new Tools(true);
        const core = extension(tools, "jig-core");
        jigCore()(core.pi);
        const sandbox = extension(tools, "jig-sandbox");
        registerJigTool(sandbox.pi as ExtensionAPI, tool("bash"));
        const context = fakeContext();
        await core.fire("session_start", { reason: "startup" }, context.ctx);
        await sandbox.fire("session_start", { reason: "startup" }, context.ctx);
        assert.equal(tools.exposure("bash"), "direct");
        assert.ok(tools.active.includes("bash"));
    });
});

test("a RefusedError marks the call refused without changing its text", async () => {
    const world = load();
    const refusal = new RefusedError("mongo find: refused, it would scan");
    registerJigTool(world.plugin.pi, {
        ...tool("mongo"),
        execute: async () => {
            throw refusal;
        },
    } as never);
    const registered = world.tools.registry.get("mongo")?.tool;
    assert.ok(registered);
    await assert.rejects(
        async () =>
            (registered.execute as (...args: unknown[]) => Promise<unknown>)(
                "call-1",
                {},
                new AbortController().signal,
                undefined,
                {},
            ),
        (error: Error) => error === refusal && error.message === "mongo find: refused, it would scan",
    );
    assert.equal(jig().takeRefused?.("call-1"), true);
    assert.equal(jig().takeRefused?.("call-1"), false);
});
