// Steps 6 and 7 of a call the agent ran itself: clean the result (redact, mask, cap) and write the call's record. This is what
// `results.ts` did before the engine existed, with the agent's event shapes replaced by plain ones.
//
// An agent may ignore an error thrown while a result is cleaned and let the unchanged result through. That would leak, so
// every failure in here replaces the result with a short error instead: a result is withheld, never passed unchecked.
import { capContent } from "./cap.ts";
import type { Content } from "./cap.ts";
import type { CallState, JigState } from "./engine-state.ts";
import type { CallEnd, CallRequest, EngineHost, RawResult } from "./engine.ts";
import { errorMessage } from "./errors.ts";
import { agentNameOf, callRecord, cleanFacts, oneLine, writeRecord } from "./records.ts";
import type { ErrorKind, Outcome } from "./records.ts";

type Parts = { content: Content[]; structured: unknown; details: unknown };

/** Which parts of a result differ from what the tool gave. */
export interface Changed {
    content: boolean;
    structured: boolean;
    details: boolean;
}

/** What cleaning a result found: the result to use, and what changed in it. A withheld result stands for one that cannot be shown. */
export interface Cleaned {
    result: RawResult;
    changed: Changed;
    withheld: boolean;
}

/** A result that cannot be shown. `text` is what the model reads instead. */
class Withheld extends Error {}

function withheld(text: string): Cleaned {
    // The structured result is left out and the details are replaced: nothing of the tool's own result goes on.
    return {
        result: { content: [{ type: "text", text }], details: {}, isError: true },
        changed: { content: true, structured: false, details: true },
        withheld: true,
    };
}

function sameJson(a: unknown, b: unknown): boolean {
    try {
        return JSON.stringify(a) === JSON.stringify(b);
    } catch {
        // Not JSON (a BigInt, say): assume it changed, which only means the replacement is returned.
        return false;
    }
}

/** Applies a text change to the text blocks and a value change to the structured parts, and notes what changed. */
function transform(parts: Parts, text: (input: string) => string, value: <T>(input: T) => T, changed: Changed): Parts {
    const content = parts.content.map((block) => {
        if (block.type !== "text") return block;
        const next = text(block.text);
        if (next === block.text) return block;
        changed.content = true;
        return { ...block, text: next };
    });
    const structured = parts.structured === undefined ? undefined : value(parts.structured);
    if (!sameJson(parts.structured, structured)) changed.structured = true;
    const details = parts.details === undefined ? undefined : value(parts.details);
    if (!sameJson(parts.details, details)) changed.details = true;
    return { content, structured, details };
}

/** Cleans a result and says what changed. `clean` of the engine is its `result`; an adapter that must answer "nothing changed" as such reads `changed`. */
export function cleanResult(state: JigState, request: CallRequest, raw: RawResult, host: EngineHost): Cleaned {
    const call = state.calls.get(request.callId);
    try {
        return protect(state, request, raw, host);
    } catch (error) {
        const text = error instanceof Withheld ? error.message : "result withheld: jig-core could not process it";
        if (call !== undefined) call.withheld = text;
        return withheld(text);
    }
}

function protect(state: JigState, request: CallRequest, raw: RawResult, host: EngineHost): Cleaned {
    const call = state.calls.get(request.callId);
    // A result with no call on file was never decided. Treat it like production: mask it.
    const masked = call === undefined ? true : call.masked && !call.masksOwnResults;
    const changed: Changed = { content: false, structured: false, details: false };
    let parts: Parts = { content: raw.content as Content[], structured: raw.structured, details: raw.details };

    // 1. Redact: every resolved secret and every secret-shaped string.
    try {
        parts = transform(
            parts,
            (text) => state.redactor.text(text),
            (value) => state.redactor.value(value),
            changed,
        );
    } catch {
        throw new Withheld("result withheld: it could not be redacted");
    }

    // 2. Mask: customer personal data in production results, for tools that do not mask their own.
    if (masked) {
        try {
            const masker = state.masker();
            parts = transform(
                parts,
                (text) => masker.text(text),
                (value) => masker.value(value),
                changed,
            );
            // An image cannot be masked, so it does not pass.
            if (parts.content.some((block) => block.type === "image")) {
                const note: Content = { type: "text", text: "[image withheld: images cannot be masked]" };
                parts = { ...parts, content: parts.content.map((block) => (block.type === "image" ? note : block)) };
                changed.content = true;
            }
        } catch {
            throw new Withheld("result withheld: it could not be masked");
        }
    }

    // 3. Cap: last, so the spill file holds the text as the model would have seen it.
    const capped = capContent({
        tool: request.tool,
        toolCallId: request.callId,
        sessionId: host.session.id,
        content: parts.content,
    });
    if (capped !== undefined) {
        parts = { ...parts, content: capped.content };
        changed.content = true;
        if (call !== undefined && capped.spill !== undefined) call.spill = capped.spill;
    }

    const result: RawResult = {
        content: changed.content ? parts.content : raw.content,
        structured: changed.structured || changed.content ? parts.structured : raw.structured,
        details: changed.details ? parts.details : raw.details,
        isError: raw.isError,
    };
    return { result, changed, withheld: false };
}

// ---- records -----------------------------------------------------------------------------------------------------------

/** Writes the call's record and forgets the call. A failure to write is noted for `/jig`, never thrown: appending a line
 *  must not break a tool call. */
export function finish(state: JigState, request: CallRequest, end: CallEnd, host: EngineHost): void {
    const call = state.calls.get(request.callId);
    state.calls.delete(request.callId);
    try {
        const { outcome, errorKind, error } = outcomeOf(state, request, end, call);
        const classification = call?.classification;
        const facts = cleanFacts(call?.facts ?? {}, (text) => state.redactor.text(text));
        const plugin = call?.plugin;
        const parent = call?.parentToolCallId ?? request.parentCallId;
        const enforcedBy = host.enforcedBy;
        writeRecord(
            callRecord(
                {
                    session: host.session.id,
                    ...(state.ticket === undefined ? {} : { ticket: state.ticket }),
                    tool: request.tool,
                    ...(classification?.action === undefined ? {} : { action: classification.action }),
                    ...(plugin === undefined ? {} : { plugin }),
                    ...(classification === undefined || call === undefined
                        ? {}
                        : {
                              environment: classification.environment,
                              environmentKind: call.environmentKind,
                              effect: classification.effect,
                              decision: call.decision,
                              decisionSource: call.decisionSource,
                          }),
                    ...(call?.approval === undefined
                        ? {}
                        : {
                              approval: call.approval.kind,
                              answer: call.approval.answer,
                              waitedMs: call.approval.waitedMs,
                          }),
                    outcome,
                    ...(errorKind === undefined ? {} : { errorKind }),
                    ...(error === undefined ? {} : { error }),
                    ...(end.durationMs === undefined ? {} : { durationMs: end.durationMs }),
                    toolCallId: request.callId,
                    ...(parent === undefined ? {} : { parentToolCallId: parent }),
                    ...(call?.spill === undefined ? {} : { spill: call.spill }),
                    ...(facts === undefined ? {} : { facts }),
                    agentName: agentNameOf(host.agent.name),
                    ...(enforcedBy === undefined ? {} : { enforcedBy }),
                },
                state.now(),
            ),
            state.now(),
        );
    } catch (error) {
        state.recordsProblem = errorMessage(error);
    }
}

function outcomeOf(
    state: JigState,
    request: CallRequest,
    end: CallEnd,
    call: CallState | undefined,
): { outcome: Outcome; errorKind?: ErrorKind; error?: string } {
    if (call?.blocked !== undefined)
        return { outcome: "blocked", errorKind: call.blocked.kind, error: call.blocked.line };
    if (call?.withheld !== undefined) return { outcome: "error", errorKind: "withheld", error: oneLine(call.withheld) };
    // The tool refused by its own rules: it said so through `markRefused`, which noted the call in `refusedCalls`.
    if (state.refusedCalls.delete(request.callId)) {
        return { outcome: "blocked", errorKind: "refused", error: oneLine(state.redactor.text(end.text ?? "")) };
    }
    if (!end.isError) return { outcome: "ok" };
    // A call that never reached the tool manager failed before its tool could run, in the agent's own checks. The agent's
    // message can quote the arguments, and a record never holds those, so only the kind is kept.
    if (call === undefined) return { outcome: "error", errorKind: "not-run" };
    // The result already went through redaction and masking when it was cleaned; redact again for safety.
    return { outcome: "error", errorKind: "tool", error: oneLine(state.redactor.text(end.text ?? "")) };
}
