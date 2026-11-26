// The `tool_call` hook, Pi's side: turns Pi's event into a request, has the engine judge it (`engine-judge.ts`) and turns what the
// engine says into Pi's answer. Everything that decides is in the engine; this file only knows Pi's shapes.
//
//   classify → decide → (ask the user) → announce → let the call run, or block it
//
// Any failure in the engine blocks the call: a tool must never run because jig-core could not tell whether it may.
import type { ExtensionContext, ToolCallEvent, ToolCallEventResult } from "@earendil-works/pi-coding-agent";
import { engineOf } from "./engine.ts";
import type { CallRequest } from "./engine.ts";
import { piHost } from "./pi-host.ts";
import type { PiState } from "./state.ts";

export async function gate(
    state: PiState,
    event: ToolCallEvent,
    ctx: ExtensionContext,
): Promise<ToolCallEventResult | undefined> {
    const request: CallRequest = {
        callId: event.toolCallId,
        ...(event.parentToolCallId === undefined ? {} : { parentCallId: event.parentToolCallId }),
        tool: event.toolName,
        input: (event.input ?? {}) as Record<string, unknown>,
    };
    const judged = await engineOf(state).judge(request, piHost(state, ctx), ctx.signal ?? new AbortController().signal);
    if (judged.verdict === "run") return undefined;
    if (judged.verdict === "refused") return { block: true, reason: judged.reason };
    // Pi's screens answer at once and never say "later", so a call does not wait here. If one did, it must not run.
    judged.call.blocked = { kind: "internal", line: "the question could not be answered here" };
    return { block: true, reason: "jig-core could not decide: the question could not be answered here" };
}
