// Steps 4 to 7 of a call the engine runs itself: it calls the tool, cleans the result and writes the call's record. A host that runs the tool
// itself (Pi) does the first through `executeTool` (`engine-tool.ts`) and has the agent's own events clean and record, so it never calls this.
//
//   check the call may run → call the tool → a refusal or an error becomes the result → clean → record
//
// Nothing here throws for what a tool does: a tool's error is its result, so the host gets a result for every call it runs.
import { buildApi } from "./api.ts";
import { textOf } from "./cap.ts";
import type { Content } from "./cap.ts";
import type { JigApi } from "./contract.ts";
import { cleanResult, finish } from "./engine-results.ts";
import type { CallState, JigState } from "./engine-state.ts";
import { executeTool } from "./engine-tool.ts";
import type { CallContext, EngineTool, ToolResult } from "./engine-tool.ts";
import type { CallRequest, EngineHost } from "./engine.ts";
import { errorMessage } from "./errors.ts";

const apis = new WeakMap<JigState, JigApi>();

/** What a tool reaches through `call.jig`: the API of this state, made once. */
export function apiOf(state: JigState): JigApi {
    let api = apis.get(state);
    if (api === undefined) {
        api = buildApi(state);
        apis.set(state, api);
    }
    return api;
}

/**
 * Why this call may not run now, or undefined when it may. A host should only run what `judge` or `answer` let through, but a tool must
 * never run on the host's word alone: it has to be the tool that was judged, for the call the engine holds, and allowed.
 */
function notAllowed(state: JigState, request: CallRequest, call: CallState, tool: EngineTool): string | undefined {
    if (tool.tool !== request.tool || call.tool !== request.tool || call.toolCallId !== request.callId) {
        return "this is not the call that was judged";
    }
    if (state.calls.get(request.callId) !== call) return "jig-core holds no open call with this id";
    if (call.blocked !== undefined || call.decision === "deny") return "the call was refused";
    if (call.pending !== undefined) return "the call is still waiting for an answer";
    if (call.decision === "ask" && call.approval === undefined) return "the call asks and has no answer";
    return undefined;
}

export async function run(
    state: JigState,
    request: CallRequest,
    call: CallState,
    tool: EngineTool,
    host: EngineHost,
    signal: AbortSignal,
    progress?: (text: string) => void,
): Promise<ToolResult> {
    const why = notAllowed(state, request, call, tool);
    // Nothing is run, changed or written: the call stays as it was, for the host to answer or finish as it would have.
    if (why !== undefined) return { text: `Blocked by jig-core: ${why}.`, isError: true };

    const started = state.now().getTime();
    const context: CallContext = {
        callId: request.callId,
        cwd: host.cwd,
        signal,
        ...(call.approvedPreview === undefined ? {} : { seen: call.approvedPreview }),
        ...(progress === undefined ? {} : { progress }),
        jig: apiOf(state),
    };
    let result: ToolResult;
    try {
        // A refusal is noted for the record, as `markRefused` does for a tool Pi runs; the model reads the tool's own words.
        result = await executeTool(tool, request.input as Record<string, unknown>, context, () => {
            state.refusedCalls.add(request.callId);
        });
    } catch (error) {
        result = { text: errorMessage(error), isError: true };
    }
    if (result.facts !== undefined) Object.assign(call.facts, result.facts);

    const { result: cleaned } = cleanResult(
        state,
        request,
        {
            content: [{ type: "text", text: result.text }],
            ...(result.data === undefined ? {} : { structured: result.data }),
            isError: result.isError === true,
        },
        host,
    );
    const text = textOf(cleaned.content as Content[]);
    finish(state, request, { isError: cleaned.isError, durationMs: state.now().getTime() - started, text }, host);
    return {
        text,
        ...(cleaned.structured === undefined ? {} : { data: cleaned.structured }),
        ...(cleaned.isError ? { isError: true } : {}),
    };
}
