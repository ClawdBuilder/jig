// What happens after a tool ran, Pi's side: turns Pi's events into the engine's plain shapes, has the engine clean the result and
// write the record (`engine-results.ts`), and turns what comes back into Pi's answer.
//
//   `tool_result`        redact → mask (production) → cap, and replace the result only when something changed
//   `tool_execution_end` write the call's record
//   `turn_end`           write the turn's record
//
// Pi ignores an error thrown by a `tool_result` hook and lets the unchanged result through. That would leak, so every
// failure in the engine replaces the result with a short error instead: a result is withheld, never passed unchecked.
import type {
    ExtensionContext,
    ToolExecutionEndEvent,
    ToolResultEvent,
    ToolResultEventResult,
    TurnEndEvent,
} from "@earendil-works/pi-coding-agent";
import { textOf } from "./cap.ts";
import type { Content } from "./cap.ts";
import { engineOf } from "./engine.ts";
import type { CallEnd, CallRequest } from "./engine.ts";
import { cleanResult } from "./engine-results.ts";
import { errorMessage } from "./errors.ts";
import { piHost, sessionIdOf } from "./pi-host.ts";
import { turnRecord, writeRecord } from "./records.ts";
import type { JigState, PiState } from "./state.ts";

/** What the engine needs to know of a call, from the event that ends it. */
function requestOf(event: {
    toolCallId: string;
    toolName: string;
    parentToolCallId?: string | undefined;
    input?: Record<string, unknown>;
}): CallRequest {
    return {
        callId: event.toolCallId,
        ...(event.parentToolCallId === undefined ? {} : { parentCallId: event.parentToolCallId }),
        tool: event.toolName,
        input: event.input ?? {},
    };
}

export function toolResult(
    state: PiState,
    event: ToolResultEvent,
    ctx: ExtensionContext,
): ToolResultEventResult | undefined {
    const { result, changed, withheld } = cleanResult(
        state,
        requestOf(event),
        { content: event.content, structured: event.structuredContent, details: event.details, isError: event.isError },
        piHost(state, ctx),
    );
    // Without `structuredContent` in the answer Pi drops it, which is what we want. `details` is replaced too.
    if (withheld) return { content: result.content as Content[], details: {}, isError: true };
    if (!changed.content && !changed.structured && !changed.details) return undefined;
    const answer: ToolResultEventResult = {};
    if (changed.content) {
        answer.content = result.content as Content[];
        // Pi drops `structuredContent` when `content` is replaced and it is not returned along with it.
        if (result.structured !== undefined) answer.structuredContent = result.structured as never;
    } else if (changed.structured && result.structured !== undefined) {
        answer.structuredContent = result.structured as never;
    }
    if (changed.details) answer.details = result.details;
    return answer;
}

// ---- records -----------------------------------------------------------------------------------------------------------

/** Writes the call's record and forgets the call. A failure to write is noted for `/jig`, never thrown: appending a line
 *  must not break a tool call. */
export function finishCall(state: PiState, event: ToolExecutionEndEvent, ctx: ExtensionContext): void {
    const end: CallEnd = {
        isError: event.isError,
        ...(event.durationMs === undefined ? {} : { durationMs: event.durationMs }),
        // Read only when the record needs it, for an error or a refusal, as before the engine existed. A result that
        // cannot be read fails inside the engine's own guard and is noted as a records problem.
        get text() {
            return textOf((event.result?.content ?? []) as Content[]);
        },
    };
    engineOf(state).finish(requestOf(event), end, piHost(state, ctx));
}

/** Writes the record of one model turn from Pi's usage data. */
export function finishTurn(state: JigState, event: TurnEndEvent, ctx: ExtensionContext): void {
    const message = event.message;
    if (!("role" in message) || message.role !== "assistant") return;
    try {
        const { usage } = message;
        writeRecord(
            turnRecord(
                {
                    session: sessionIdOf(ctx),
                    ...(state.ticket === undefined ? {} : { ticket: state.ticket }),
                    model: message.model,
                    input: usage.input,
                    output: usage.output,
                    cacheRead: usage.cacheRead,
                    cacheWrite: usage.cacheWrite,
                    cost: usage.cost.total,
                },
                state.now(),
            ),
            state.now(),
        );
    } catch (error) {
        state.recordsProblem = errorMessage(error);
    }
}
