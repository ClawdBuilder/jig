// What lives for the whole gateway process: the engine, made at the first call, the connectors' tools, the queue for tools that run one call at a
// time, the last outcomes for the `jig` tool, and the call flow. The MCP side (`server.ts`) hands each call here and maps the answer back.
//
// The engine is made at the first call and not at start, so nothing with an effect happens when the process starts or when tools are listed (the
// connector files are loaded to describe their tools, and nothing more). The first call does, in this order, because each step needs the one before:
//   1. create the engine and publish its API, which the connectors' tools reach through `jig()`;
//   2. let each connector register (its section of jig.json), and declare every tool to the engine;
//   3. start the engine, which reads jig.json with the sections that were registered (a section nobody registered counts as off);
//   4. begin the session, once.
//
// One call: the tool must be one of ours, an action the connector keeps back is refused, a `dir` must be a folder that exists, then `judge`,
// then `run`. Every refusal ends through `finish`, so that the call has its record line.
import { statSync } from "node:fs";
import path from "node:path";
import { publishJig, withdrawJig } from "../client.ts";
import type { JigApi } from "../contract.ts";
import { createEngine } from "../engine.ts";
import type { CallRequest, Engine, EngineHost } from "../engine.ts";
import type { EngineOptions } from "../engine-options.ts";
import { apiOf } from "../engine-run.ts";
import type { ConnectorModule, EngineTool } from "../engine-tool.ts";
import { errorMessage } from "../errors.ts";
import { oneLine, printable } from "../kit/text.ts";
import { configFile } from "../paths.ts";
import type { SettingsHome } from "../settings-home.ts";
import { newCallId, newSessionId, processHost, requestHost } from "./host.ts";
import type { AgentInfo, HostShared } from "./host.ts";
import { jigTool, STATUS_OUTCOMES } from "./jig-tool.ts";
import type { GatewayOutcome } from "./jig-tool.ts";
import { describeTool } from "./tool-list.ts";
import type { ToolListEntry } from "./tool-list.ts";

/** What the engine says of a call that needs a question when nobody can be asked (`decide.ts`). A call that waits is refused with it too. */
export const NO_SCREEN = "Blocked by jig-core: this call needs approval and there is no screen to ask on.";

/** Said in the server's instructions, and by `status`, when no settings folder was found. */
export const NO_SETTINGS =
    "No settings folder was found (a --home argument, JIG_HOME, or ~/.jig with a jig.json in it), so Jig runs with its built-in defaults. Name the folder with JIG_HOME to use your settings.";

/** What the agent's request says about the call. */
export interface CallOrigin {
    agent: AgentInfo;
    callId: string;
    /** Cancelled when the agent cancels the call. */
    signal: AbortSignal;
    /** Says a line while the call runs. Missing when the request did not ask for progress. */
    progress?: (text: string) => void;
}

/** What goes back to the agent: the text the engine cleaned, or the line that refused the call. */
export interface CallResult {
    text: string;
    isError: boolean;
}

export interface RuntimeOptions {
    /** The connectors, loaded but not yet registered. */
    connectors: readonly ConnectorModule[];
    /** Lines for `status` about parts that did not start, such as a connector that could not be loaded. */
    startup?: readonly string[];
    settings: SettingsHome | undefined;
    env: NodeJS.ProcessEnv;
    /** The folder the gateway was started in: where a call that names no `dir` is made. */
    cwd: string;
    /** Where a notice goes: one line on standard error. */
    stderr(line: string): void;
    /** Changes to what the engine is made with. A test replaces the clock. */
    engine?: Partial<EngineOptions>;
}

export interface GatewayRuntime {
    /** The tools to offer, by name. */
    entries: readonly ToolListEntry[];
    /** Said in the server's instructions when no settings folder was found. */
    settingsNote: string | undefined;
    call(name: string, args: Record<string, unknown>, origin: CallOrigin): Promise<CallResult>;
    /** Ends the engine's session. Safe to run twice. */
    stop(): Promise<void>;
}

interface Offered {
    entry: ToolListEntry;
    tool: EngineTool;
}

/** The folder a `dir` names, or why it cannot be one. */
function folderOf(dir: unknown): { folder: string } | { problem: string } {
    if (typeof dir !== "string" || !path.isAbsolute(dir))
        return { problem: "dir must be an absolute path to a folder" };
    const folder = path.resolve(dir);
    try {
        if (statSync(folder).isDirectory()) return { folder };
    } catch {
        // Not there, or not readable: the same answer.
    }
    return { problem: "dir is not a folder that exists" };
}

export function createGatewayRuntime(options: RuntimeOptions): GatewayRuntime {
    const now = options.engine?.now ?? (() => new Date());
    const shared: HostShared = { sessionId: newSessionId(), env: options.env, stderr: options.stderr };
    const outcomes: GatewayOutcome[] = [];
    let engine: Engine | undefined;
    let published: JigApi | undefined;
    let failure: Error | undefined;
    let tail: Promise<unknown> = Promise.resolve();
    // The ids of the calls that are open now. The engine keeps one call for each id, so a second call under an id that is open would take the first one's
    // place, and the first would be refused when it runs and have no record line.
    const openIds = new Set<string>();

    const jig = jigTool({
        outcomes: () => outcomes,
        // The key and the message, not the file: what the model reads holds no path.
        problems: () => engine?.state.personal.problems.map((problem) => `${problem.key}: ${problem.message}`) ?? [],
        settings: () => {
            if (options.settings === undefined) return NO_SETTINGS;
            if (engine !== undefined && !engine.state.personal.found) {
                return "The settings folder has no jig.json, so Jig runs with its built-in defaults.";
            }
            return undefined;
        },
        startup: () => options.startup ?? [],
    });

    const offered = new Map<string, Offered>();
    const offer = (tool: EngineTool, connector: string, notOffered: readonly string[]): void => {
        if (offered.has(tool.tool)) throw new Error(`two tools are named ${tool.tool}`);
        offered.set(tool.tool, { entry: describeTool(tool, connector, notOffered), tool });
    };
    for (const connector of options.connectors) {
        for (const tool of connector.tools) offer(tool, connector.name, connector.notOffered?.[tool.tool] ?? []);
    }
    offer(jig, "jig-core", []);
    const entries = [...offered.values()].map((one) => one.entry).sort((a, b) => (a.name < b.name ? -1 : 1));

    /** The first use: see the order at the top of this file. */
    function begin(): Engine {
        const made = createEngine({
            configPath: () => (options.settings === undefined ? "" : configFile(options.settings.folder)),
            env: options.env,
            // The notice would go to standard error, where nobody reads it.
            skipUpdateCheck: true,
            ...options.engine,
        });
        const api = apiOf(made.state);
        for (const error of publishJig(api)) options.stderr(`a plugin failed while it loaded: ${errorMessage(error)}`);
        try {
            for (const connector of options.connectors) connector.register?.(api);
            for (const { tool } of offered.values()) api.declareTool(tool);
            made.start(processHost(shared, options.cwd));
            made.beginSession();
        } catch (error) {
            withdrawJig(api);
            throw error;
        }
        published = api;
        return made;
    }

    /** The engine, made on first use. A start that failed fails every call the same way, so no call runs without the engine's rules. */
    function engineOrThrow(): Engine {
        if (engine !== undefined) return engine;
        if (failure !== undefined) throw failure;
        try {
            engine = begin();
            return engine;
        } catch (error) {
            failure = error instanceof Error ? error : new Error(String(error));
            options.stderr(`the gateway could not start its engine: ${errorMessage(error)}`);
            throw failure;
        }
    }

    function note(tool: string, action: string | undefined, result: string, refused: boolean): void {
        outcomes.push({
            time: `${now().toISOString().slice(0, 19)}Z`,
            tool,
            ...(action === undefined ? {} : { action }),
            result: oneLine(result, 300),
            refused,
        });
        if (outcomes.length > STATUS_OUTCOMES) outcomes.shift();
    }

    /** Calls to a tool that runs one at a time go through one chain, judging and running together: a preview reads what an earlier call changes. */
    function inQueue<T>(sequential: boolean, work: () => Promise<T>): Promise<T> {
        if (!sequential) return work();
        const result = tail.then(work);
        tail = result.catch(() => undefined);
        return result;
    }

    /** A call that does not run: the call is finished through the engine, so that it has its record line, and the agent reads the reason. */
    function refuse(running: Engine, request: CallRequest, host: EngineHost, reason: string): CallResult {
        running.finish(request, { isError: true, text: reason }, host);
        note(request.tool, shownAction(request.input), reason, true);
        return { text: reason, isError: true };
    }

    async function decide(
        running: Engine,
        found: Offered,
        request: CallRequest,
        host: EngineHost,
        origin: CallOrigin,
    ): Promise<CallResult> {
        const judged = await running.judge(request, host, origin.signal);
        if (judged.verdict === "refused") return refuse(running, request, host, judged.reason);
        if (judged.verdict === "waiting") {
            // Nobody can be asked, so this cannot happen; if it does, the call is refused as if there were no screen.
            judged.call.blocked = { kind: "internal", line: "the gateway cannot wait for an answer" };
            return refuse(running, request, host, NO_SCREEN);
        }
        const result = await running.run(request, judged.call, found.tool, host, origin.signal, origin.progress);
        note(
            request.tool,
            judged.call.classification.action ?? shownAction(request.input),
            judged.call.decision,
            false,
        );
        return { text: result.text, isError: result.isError === true };
    }

    async function call(name: string, args: Record<string, unknown>, origin: CallOrigin): Promise<CallResult> {
        let running: Engine;
        try {
            running = engineOrThrow();
        } catch (error) {
            return { text: `Blocked by jig-core: the gateway could not start: ${errorMessage(error)}`, isError: true };
        }
        const found = offered.get(name);
        // The gateway takes `dir` out of the input: the engine and the tool never see it.
        const { dir, ...rest } = args;
        const input = found?.entry.usesFolder === true ? rest : args;
        const callId = openIds.has(origin.callId) ? newCallId() : origin.callId;
        const request: CallRequest = { callId, tool: name, input };
        let host = requestHost(shared, origin.agent, options.cwd);
        openIds.add(callId);
        try {
            if (found === undefined) {
                return refuse(
                    running,
                    request,
                    host,
                    `Blocked by jig-core: ${printable(name)} is not a tool of this gateway.`,
                );
            }
            const action = typeof input.action === "string" ? input.action : undefined;
            if (action !== undefined && found.entry.notOffered.includes(action)) {
                const line = `Blocked by jig-core: ${name} ${printable(action)} is not offered through this gateway.`;
                return refuse(running, request, host, line);
            }
            if (found.entry.usesFolder && dir !== undefined) {
                const named = folderOf(dir);
                if ("problem" in named) return refuse(running, request, host, `Blocked by jig-core: ${named.problem}.`);
                host = requestHost(shared, origin.agent, named.folder);
            }
            const judging = host;
            return await inQueue(found.entry.sequential, () => decide(running, found, request, judging, origin));
        } catch (error) {
            // The engine and the tools do not throw for what a call does; this is a mistake in the gateway or a plugin. The call is not run.
            const line = `Blocked by jig-core: the gateway could not run this call: ${errorMessage(error)}`;
            return refuse(running, request, host, line);
        } finally {
            openIds.delete(callId);
        }
    }

    return {
        entries,
        settingsNote: options.settings === undefined ? NO_SETTINGS : undefined,
        call,
        async stop() {
            if (published !== undefined) withdrawJig(published);
            published = undefined;
            await engine?.stop();
        },
    };
}

/** The action of a call's input, as text that is safe to keep and show. */
function shownAction(input: Readonly<Record<string, unknown>>): string | undefined {
    return typeof input.action === "string" ? printable(input.action) : undefined;
}
