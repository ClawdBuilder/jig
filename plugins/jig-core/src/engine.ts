// The engine: what jig-core does with a tool call, with no agent in it. A host, which is Pi's adapter today, hands it a call and
// the few things only the host has (`EngineHost`); the engine classifies, decides, asks through the host, cleans the result and
// writes the record. Nothing under the engine imports an agent: the question goes out through `host.ask`, a notice through
// `host.notify`, an event through `host.emit`, and the model is woken through `host.wake`.
//
// The functions are in four files, each over the same state (`engine-state.ts`): `engine-judge.ts` (steps 1 to 3: classify, decide,
// ask), `engine-run.ts` (steps 4 to 7 for a tool the engine runs), `engine-results.ts` (steps 6 and 7 for a tool the agent ran: clean
// the result, write the record) and `engine-session.ts` (start, begin, stop). The tool contract is in `engine-tool.ts`.
import type { Approval, AskRequest } from "./ask.ts";
import { createEngineState } from "./engine-state.ts";
import type { CallState, EngineOptions, JigState } from "./engine-state.ts";
import { answer, judge } from "./engine-judge.ts";
import { cleanResult, finish } from "./engine-results.ts";
import { run } from "./engine-run.ts";
import { beginSession, start, stop } from "./engine-session.ts";
import type { EngineTool, ToolResult } from "./engine-tool.ts";
import type { EnforcedBy, ErrorKind } from "./records.ts";
import type { WatchMessage } from "./watch/message.ts";

export type { CallState, EngineOptions, JigState } from "./engine-state.ts";
export type { CallContext, EngineTool, JsonSchema, ToolResult } from "./engine-tool.ts";

/** Hints about what a tool does, with the meaning of MCP tool annotations. They come from the tool's author and are not verified. */
export interface ToolAnnotations {
    /** The tool does not modify its environment. */
    readOnlyHint?: boolean;
    /** The tool may delete or overwrite data, rather than only add to it. Meaningful when not read-only. */
    destructiveHint?: boolean;
    /** Repeating a call with the same arguments has no further effect. Meaningful when not read-only. */
    idempotentHint?: boolean;
    /** The tool reaches an open world of external entities, such as the web, rather than a closed domain. */
    openWorldHint?: boolean;
}

/** What the agent itself says about a tool: where it comes from, and its hints (readOnlyHint and the like). */
export interface ToolInfo {
    source?: string;
    annotations?: ToolAnnotations;
}

/** What the engine asks of whatever runs it. Pi's adapter builds one for each event. */
export interface EngineHost {
    agent: { name: string; version: string };
    session: { id: string; parent?: string; role: string };
    /** Which enforcement point this host is, for the record of a call. Pi leaves it out. */
    enforcedBy?: EnforcedBy;
    /** The working folder of this call. */
    cwd: string;
    /** False: an ask is refused, as "no screen" is today. */
    canAsk: boolean;
    /** The same, for an ask about a protected path. */
    canAskProtected: boolean;
    toolInfo(name: string): ToolInfo | undefined;
    /** Puts the question. It returns the answer, or the word `later` when the answer will come by another request. */
    ask(request: AskRequest, signal: AbortSignal): Promise<Approval | "later">;
    /** Shows a notice. It returns false when nobody saw it, so the notice is still owed. */
    notify(text: string, level: "info" | "warn"): boolean;
    /** Wakes the model with watch results. It returns false when the agent could not be woken. */
    wake(message: WatchMessage): Promise<boolean>;
    /** Publishes an event that other plugins listen to. */
    emit(name: string, event: unknown): void;
}

export interface CallRequest {
    /** The agent's id for this call. */
    callId: string;
    parentCallId?: string;
    tool: string;
    input: Readonly<Record<string, unknown>>;
}

export type Judged =
    /** Go on and run it. */
    | { verdict: "run"; call: CallState }
    /** It does not run. `reason` is what the model reads. */
    | { verdict: "refused"; kind: ErrorKind; reason: string }
    /** Asked; the answer comes later. */
    | { verdict: "waiting"; call: CallState; request: AskRequest };

/** A tool's result as an agent hands it over: its content blocks, the structured result and details if it has them. */
export interface RawResult {
    content: unknown[];
    structured?: unknown;
    details?: unknown;
    isError: boolean;
}

/**
 * How a call ended, for its record. `text` is the text of the result, from which an error line is cut. The engine reads it
 * only for an error or a refusal, so a host may give it as a getter.
 */
export interface CallEnd {
    isError: boolean;
    durationMs?: number;
    text?: string;
}

export interface Engine {
    /** The state the functions below work on. Plugins reach it through the API that `buildApi` makes of it. */
    readonly state: JigState;
    /** Before the first call: reads the settings, so that the rules can be built. */
    start(host: EngineHost): void;
    /** Once per session, never in a hook: saved watches, clean-up, the update check and the other start jobs. */
    beginSession(): void;
    /** Once, when the session ends. */
    stop(): Promise<void>;
    /** Steps 1 to 3: classify, decide, ask. */
    judge(request: CallRequest, host: EngineHost, signal: AbortSignal): Promise<Judged>;
    /** Step 3, when the answer comes later. */
    answer(call: CallState, approval: Approval, host: EngineHost): Judged;
    /**
     * Steps 4 to 7, for a tool the engine runs itself and a call that was judged `run`: calls the tool with the input of the request (it
     * is not in the call), cleans the result and writes the record. A tool's error or refusal is its result, so this does not throw for one.
     * `progress` is where a line goes while the tool runs, for a host that shows one.
     */
    run(
        request: CallRequest,
        call: CallState,
        tool: EngineTool,
        host: EngineHost,
        signal: AbortSignal,
        progress?: (text: string) => void,
    ): Promise<ToolResult>;
    /** Step 6, for a tool the agent ran: redact, mask, cap. */
    clean(request: CallRequest, result: RawResult, host: EngineHost): RawResult;
    /** Step 7, for a tool the agent ran: write the one record line and forget the call. */
    finish(request: CallRequest, end: CallEnd, host: EngineHost): void;
}

const engines = new WeakMap<JigState, Engine>();

/** The engine that works on a state. The same state always gives the same engine. */
export function engineOf(state: JigState): Engine {
    const known = engines.get(state);
    if (known !== undefined) return known;
    const engine: Engine = {
        state,
        start: (host) => start(state, host),
        beginSession: () => beginSession(state),
        stop: () => stop(state),
        judge: (request, host, signal) => judge(state, request, host, signal),
        answer: (call, approval, host) => answer(state, call, approval, host),
        run: (request, call, tool, host, signal, progress) => run(state, request, call, tool, host, signal, progress),
        clean: (request, result, host) => cleanResult(state, request, result, host).result,
        finish: (request, end, host) => finish(state, request, end, host),
    };
    engines.set(state, engine);
    return engine;
}

/** Builds an engine over a new state. It needs no agent: the options are what a test can replace and what only Pi has. */
export function createEngine(options: EngineOptions): Engine {
    return engineOf(createEngineState(options));
}
