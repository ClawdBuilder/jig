// Pi's host for the engine: what the engine asks of whoever runs it (`EngineHost`), answered from Pi's extension API and the
// context of one event. Pi hands its context to each event and not once, so a host is built for each event. The one built with
// no context serves what happens between events, such as a watch that fires: it can notify, wake and emit, and it cannot ask.
//
// The members that read something that can change (the folder, the screen, the terminal) read it when the engine uses it, not
// when the host is built, as the code did before the engine existed.
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { Approval } from "./ask.ts";
import type { EngineHost, ToolInfo } from "./engine.ts";
import type { PiState } from "./state.ts";

/** What a question that cannot be put comes to: closed without an answer. */
const NOBODY_TO_ASK: Approval = { answer: "decline", dismissed: true, waitedMs: 0 };

/** The id of the session of Pi's context. */
export function sessionIdOf(ctx: ExtensionContext): string {
    try {
        return ctx.sessionManager.getSessionId();
    } catch {
        return "unknown";
    }
}

/** What Pi lists about a tool: where it comes from and its hints. Pi refuses to list while extensions are still loading. */
export function piToolInfo(pi: ExtensionAPI, name: string): ToolInfo | undefined {
    const info = pi.getAllTools().find((tool) => tool.name === name);
    if (info === undefined) return undefined;
    const source = info.sourceInfo?.source;
    return {
        ...(source === undefined ? {} : { source }),
        ...(info.annotations === undefined ? {} : { annotations: info.annotations }),
    };
}

export function piHost(state: PiState, ctx?: ExtensionContext): EngineHost {
    const { pi } = state;
    return {
        get agent() {
            return { name: "pi", version: state.piVersion ?? "unknown" };
        },
        get session() {
            // A child agent is started with these set, as the records read them.
            const parent = process.env.JIG_PARENT_SESSION;
            const role = process.env.JIG_AGENT_ROLE;
            return {
                id: ctx === undefined ? "unknown" : sessionIdOf(ctx),
                ...(parent === undefined || parent === "" ? {} : { parent }),
                role: role !== undefined && role !== "" ? role : "main",
            };
        },
        get cwd() {
            return ctx?.cwd ?? process.cwd();
        },
        get canAsk() {
            return ctx?.hasUI ?? false;
        },
        get canAskProtected() {
            // An ask needs a real terminal; RPC and child agents have no terminal of their own.
            return process.stdin.isTTY === true;
        },
        toolInfo: (name) => piToolInfo(pi, name),
        // Pi's screens answer at once and never say `later`. They read the run's cancel switch from the context themselves.
        ask: (request) => (ctx === undefined ? Promise.resolve(NOBODY_TO_ASK) : state.approvals.ask(ctx, request)),
        notify(text, level) {
            if (state.screen === undefined) return false;
            try {
                state.screen.notify(text, level === "warn" ? "warning" : "info");
                return true;
            } catch {
                // A screen from an earlier runtime can be gone; the watch goes on without it.
                return false;
            }
        },
        wake(message) {
            pi.sendMessage(message, { deliverAs: "followUp", triggerTurn: true });
            return Promise.resolve(true);
        },
        emit: (name, event) => pi.events.emit(name, event),
    };
}
