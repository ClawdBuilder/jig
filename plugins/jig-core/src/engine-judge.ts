// Steps 1 to 3 of a call: classify it, decide, and ask when the decision is ask. It runs nothing. This is what `gate.ts` did before
// the engine existed, with Pi's event and context replaced by a request and a host.
//
//   classify → decide → (ask the host) → announce → let the call run, or refuse it
//
// Any failure in here refuses the call: a tool must never run because jig-core could not tell whether it may.
import { homedir } from "node:os";
import type { Approval, AskRequest } from "./ask.ts";
import { chooseKind } from "./ask.ts";
import { classify, UNKNOWN_CLASS } from "./classify.ts";
import { JIG_EVENTS } from "./contract.ts";
import type { DecisionEvent } from "./contract.ts";
import { decide, sessionKey } from "./decide.ts";
import type { Verdict } from "./decide.ts";
import { rememberCall } from "./engine-state.ts";
import type { CallState, JigState } from "./engine-state.ts";
import type { CallRequest, EngineHost, Judged } from "./engine.ts";
import { errorMessage, InvalidInputError } from "./errors.ts";
import { frozenCall } from "./gates.ts";
import type { GateOutcome } from "./gates.ts";
import { buildPreview, defaultSummary, describeCall, isInvalidInput } from "./preview.ts";
import { checkFileTool, filePathsOf } from "./protected-paths.ts";
import { writableFolders } from "./writable-folders.ts";
import type { Answer, ErrorKind } from "./records.ts";

export async function judge(
    state: JigState,
    request: CallRequest,
    host: EngineHost,
    signal: AbortSignal,
): Promise<Judged> {
    try {
        return await decideCall(state, request, host, signal);
    } catch (error) {
        // A host would also stop a call whose handler throws, but with a message the model cannot act on.
        const reason = `jig-core could not decide: ${errorMessage(error)}`;
        const call = state.calls.get(request.callId) ?? failedCall(state, request);
        call.blocked = { kind: "internal", line: "jig-core could not decide" };
        return { verdict: "refused", kind: "internal", reason };
    }
}

/** What is known about a call that failed before it was classified. */
function failedCall(state: JigState, request: CallRequest): CallState {
    const call: CallState = {
        toolCallId: request.callId,
        ...(request.parentCallId === undefined ? {} : { parentToolCallId: request.parentCallId }),
        tool: request.tool,
        classification: { ...UNKNOWN_CLASS, source: "unknown" },
        environmentKind: "external",
        masked: true,
        masksOwnResults: false,
        decision: "deny",
        decisionSource: "floor",
        facts: {},
    };
    rememberCall(state, call);
    return call;
}

/** The tool found the input invalid while classifying it: refused with its message, and nobody is asked. */
function refuseInvalid(state: JigState, request: CallRequest, message: string): Judged {
    const call = failedCall(state, request);
    call.decisionSource = "tool";
    call.blocked = { kind: "invalid", line: "the tool found the input invalid" };
    return {
        verdict: "refused",
        kind: "invalid",
        reason: `Blocked by jig-core: ${request.tool} cannot run with this input: ${message}`,
    };
}

/**
 * The floor's write rule, with or without a sandbox: the working folder, plus the folders a person allowed when a
 * sandbox is running. With no sandbox the old rule compared only the string Pi passed, so a write inside the working
 * folder still asked when its path arrived through a link.
 */
function writableScope(state: JigState, cwd: string): (absolute: string) => boolean {
    const allowed = state.sandbox?.active === true ? (state.sandbox.allowedFolders?.() ?? []) : [];
    return writableFolders([cwd, ...allowed], process.platform);
}

async function decideCall(
    state: JigState,
    request: CallRequest,
    host: EngineHost,
    signal: AbortSignal,
): Promise<Judged> {
    const policy = state.policy();
    const input = request.input as Record<string, unknown>;
    const toolInfo = (name: string) => host.toolInfo(name);

    let classification: ReturnType<typeof classify>;
    try {
        classification = classify(request.tool, input, {
            declarations: state.declarations,
            classifyRules: policy.classify,
            toolInfo,
            cwd: host.cwd,
        });
    } catch (error) {
        if (error instanceof InvalidInputError) return refuseInvalid(state, request, error.message);
        throw error;
    }
    const environmentKind = policy.environments.kindOf(classification.environment);
    const declaration = state.declarations.get(request.tool);
    // Only a label for the records: a tool without source information must not be blocked for lack of one.
    const plugin = classification.plugin ?? toolInfo(request.tool)?.source;

    const command = typeof input.command === "string" ? input.command : undefined;
    const cwd = host.cwd;
    const fileDecision = checkFileTool(request.tool, input, {
        entries: policy.protectedPaths,
        cwd,
        home: homedir(),
        canWrite: writableScope(state, cwd),
    });
    let verdict = decide({
        call: {
            tool: request.tool,
            ...(classification.action === undefined ? {} : { action: classification.action }),
            environment: classification.environment,
            environmentKind,
            effect: classification.effect,
            ...(classification.atLeast === undefined ? {} : { atLeast: classification.atLeast }),
            ...(classification.always === undefined ? {} : { always: classification.always }),
            ...(classification.approval === undefined ? {} : { approval: classification.approval }),
            ...(command === undefined ? {} : { command }),
            unknown: classification.source === "unknown",
        },
        rules: policy.rules,
        sessionAllows: state.sessionAllows,
        hasUI: host.canAsk,
        // An ask needs a real terminal; RPC and child agents have no terminal of their own, so they are refused, as the floor says.
        protectedRefusal:
            fileDecision?.ask === true && !host.canAskProtected
                ? fileDecision.reason
                : fileDecision?.ask === true
                  ? undefined
                  : fileDecision?.reason,
        protectedAsk: fileDecision?.ask === true && host.canAskProtected ? fileDecision.reason : undefined,
    });

    // The gates other plugins registered see the call once the rules have decided. They can only make it stricter, and a
    // call that is already denied cannot be made stricter, so they are not asked.
    let gated: GateOutcome | undefined;
    if (verdict.decision !== "deny") {
        gated = await state.gates.check(
            frozenCall({
                toolCallId: request.callId,
                tool: request.tool,
                ...(classification.action === undefined ? {} : { action: classification.action }),
                environment: classification.environment,
                environmentKind,
                effect: classification.effect,
                decision: verdict.decision,
                input,
                cwd,
                paths: filePathsOf(request.tool, input, { cwd, home: homedir() }),
            }),
        );
        verdict = tightened(verdict, gated, host.canAsk);
    }

    const call: CallState = {
        toolCallId: request.callId,
        ...(request.parentCallId === undefined ? {} : { parentToolCallId: request.parentCallId }),
        tool: request.tool,
        classification,
        environmentKind,
        masked: policy.environments.masks(classification.environment),
        masksOwnResults: declaration?.masksOwnResults === true,
        decision: verdict.decision,
        decisionSource: verdict.source,
        ...(gated === undefined ? {} : { gate: gated.gate }),
        ...(plugin === undefined ? {} : { plugin }),
        facts: {},
    };
    rememberCall(state, call);

    if (verdict.decision === "deny") {
        if (verdict.source === "gate" && gated !== undefined) {
            // The gate's own words are for the model and the user; the record keeps only that a gate held the call.
            const kind: ErrorKind = gated.failed ? "internal" : "denied";
            call.blocked = { kind, line: `held by gate ${gated.gate}` };
            announce(host, call);
            return {
                verdict: "refused",
                kind,
                reason: gated.failed ? gated.reason : `Blocked by jig-core: ${gated.reason}`,
            };
        }
        const kind: ErrorKind = verdict.floor === "no-screen" ? "no-screen" : "denied";
        call.blocked = { kind, line: `blocked: ${verdict.reason ?? "denied"}` };
        announce(host, call);
        return { verdict: "refused", kind, reason: `Blocked by jig-core: ${verdict.reason ?? "denied"}.` };
    }
    if (verdict.decision === "ask") {
        return askUser(state, call, verdict, input, host, signal, gated?.decision === "ask" ? gated : undefined);
    }

    announce(host, call);
    return { verdict: "run", call };
}

/**
 * The decision with the gates' answer laid over it, which can only make it stricter: a deny ends the call, an ask turns an
 * allow into an ask (and stays one), and with no screen to ask on an ask is a deny, as everywhere else.
 */
function tightened(verdict: Verdict, gated: GateOutcome | undefined, hasUI: boolean): Verdict {
    if (gated === undefined) return verdict;
    if (gated.decision === "deny") return { decision: "deny", source: "gate", reason: gated.reason };
    if (!hasUI) {
        return {
            decision: "deny",
            source: "floor",
            floor: "no-screen",
            reason: "this call needs approval and there is no screen to ask on",
        };
    }
    return verdict.decision === "ask" ? verdict : { ...verdict, decision: "ask", source: "gate" };
}

async function askUser(
    state: JigState,
    call: CallState,
    verdict: Verdict,
    input: Record<string, unknown>,
    host: EngineHost,
    signal: AbortSignal,
    asked?: GateOutcome,
): Promise<Judged> {
    const { classification } = call;
    const described = {
        tool: call.tool,
        ...(classification.action === undefined ? {} : { action: classification.action }),
        environment: classification.environment,
        effect: classification.effect,
    };

    const fallback = defaultSummary({ ...described, unknown: classification.source === "unknown" }, input);
    const preview = await buildPreview(state.declarations.get(call.tool), input, fallback, undefined, host.cwd);
    if (isInvalidInput(preview)) {
        call.blocked = { kind: "invalid", line: "the tool found the input invalid" };
        announce(host, call);
        return {
            verdict: "refused",
            kind: "invalid",
            reason: `Blocked by jig-core: ${call.tool} cannot run with this input: ${preview.invalid}`,
        };
    }
    const kind = chooseKind(verdict.approval, preview);
    // A gate that asks says why, in the question; the preview the tool reads back with `approvedPreview` stays as it built it.
    const shown =
        asked === undefined
            ? preview
            : { ...preview, summary: `${preview.summary}\nAsked by ${asked.gate}: ${asked.reason}` };
    const question: AskRequest = {
        header: describeCall(described),
        preview: shown,
        kind,
        ...(classification.always === "ask" ? { always: true } : {}),
    };
    const approval = await host.ask(question, signal);

    // A gate that asks asks again next time, so remembering the answer would remember nothing.
    const remember =
        asked === undefined
            ? sessionKey({
                  tool: call.tool,
                  ...(classification.action === undefined ? {} : { action: classification.action }),
                  environment: classification.environment,
                  ...(typeof input.command === "string" ? { command: input.command } : {}),
              })
            : undefined;
    const pending = { kind, preview, ...(remember === undefined ? {} : { remember }) };
    if (approval === "later") {
        call.pending = pending;
        return { verdict: "waiting", call, request: question };
    }
    return settle(state, call, approval, pending, host);
}

/** Step 3, when the answer comes later: the same checks as an answer that comes at once. */
export function answer(state: JigState, call: CallState, approval: Approval, host: EngineHost): Judged {
    const pending = call.pending;
    if (pending === undefined) {
        // Nothing is waiting on this call, so an answer to it means nothing: it does not run.
        call.blocked = { kind: "internal", line: "an answer came for a call that was not waiting" };
        return { verdict: "refused", kind: "internal", reason: "jig-core has no open question for this call" };
    }
    delete call.pending;
    return settle(state, call, approval, pending, host);
}

/** What follows an answer: a decline refuses the call, anything else lets it run. */
function settle(
    state: JigState,
    call: CallState,
    approval: Approval,
    pending: NonNullable<CallState["pending"]>,
    host: EngineHost,
): Judged {
    call.approval = { kind: pending.kind, answer: approval.answer, waitedMs: approval.waitedMs };
    if (approval.answer === "decline") {
        call.blocked = approval.dismissed
            ? { kind: "dismissed", line: "the question was closed without an answer" }
            : { kind: "declined", line: "declined by the user" };
        announce(host, call, "decline");
        const why = approval.dismissed
            ? "the question was closed without an answer"
            : approval.reason === undefined
              ? "the user declined this call"
              : `the user declined this call, and said: ${approval.reason}`;
        return { verdict: "refused", kind: call.blocked.kind, reason: `Blocked by jig-core: ${why}` };
    }

    // The tool can read this back with `approvedPreview()` and refuse to run if what it would do has changed.
    call.approvedPreview = pending.preview;
    if (approval.answer === "allow-session" && pending.remember !== undefined) {
        state.sessionAllows.add(pending.remember);
    }
    announce(host, call, approval.answer);
    return { verdict: "run", call };
}

/** Tells other plugins about the decision. A listener that fails does not change the decision. */
function announce(host: EngineHost, call: CallState, answered?: Answer): void {
    const { classification } = call;
    const event: DecisionEvent = {
        toolCallId: call.toolCallId,
        tool: call.tool,
        ...(classification.action === undefined ? {} : { action: classification.action }),
        environment: classification.environment,
        environmentKind: call.environmentKind,
        effect: classification.effect,
        decision: call.decision,
        source: call.decisionSource,
        ...(call.gate === undefined ? {} : { gate: call.gate }),
        ...(answered === undefined ? {} : { answer: answered }),
    };
    try {
        host.emit(JIG_EVENTS.decision, event);
    } catch {
        // See above.
    }
}
