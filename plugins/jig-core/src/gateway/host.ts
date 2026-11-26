// The engine's host for the gateway: what the engine asks of whoever runs it (`EngineHost`), answered for an MCP server over standard input and
// output. There are two kinds. The process host serves what happens between calls (`engine.start`, a watch that fires). A request host is built
// for each call, because the agent's name and the folder differ from call to call.
//
// Nobody can be asked here: `canAsk` is false, so every call that would ask is refused with the engine's own "no screen" line. Standard output is
// the protocol's, so a notice goes to standard error. The agent's name comes from what the request says about its client; it is for the record
// only and no decision depends on it, because any program can send any name.
import { randomUUID } from "node:crypto";
import { CLIENT_INFO_META_KEY } from "@modelcontextprotocol/server";
import type { Approval } from "../ask.ts";
import type { EngineHost } from "../engine.ts";
import { oneLine } from "../kit/text.ts";

/** The key of a Claude Code request's `_meta` that holds the id of the tool use, the same id the agent's hook sees. */
export const TOOL_USE_ID_KEY = "claudecode/toolUseId";

/** What the agent says it is. */
export interface AgentInfo {
    name: string;
    version: string;
}

/** What every host of one gateway process shares. */
export interface HostShared {
    /** One id for the life of the process: no session id reaches an MCP server, so the gateway makes its own. */
    sessionId: string;
    env: NodeJS.ProcessEnv;
    /** Where a notice goes: one line on standard error. */
    stderr(line: string): void;
}

/** The agent of a request nobody has named. */
export const UNKNOWN_AGENT: AgentInfo = { name: "unknown", version: "unknown" };

/** What a question that cannot be put comes to: closed without an answer, so a mistake fails closed. */
const NOBODY_TO_ASK: Approval = { answer: "decline", dismissed: true, waitedMs: 0 };

/** One id for the life of a gateway process. */
export function newSessionId(): string {
    return randomUUID();
}

/** The host for one call: the agent that made it and the folder it is made in. */
export function requestHost(shared: HostShared, agent: AgentInfo, cwd: string): EngineHost {
    const parent = shared.env.JIG_PARENT_SESSION;
    const role = shared.env.JIG_AGENT_ROLE;
    return {
        agent,
        session: {
            id: shared.sessionId,
            ...(parent === undefined || parent === "" ? {} : { parent }),
            role: role !== undefined && role !== "" ? role : "main",
        },
        enforcedBy: "gateway",
        cwd,
        canAsk: false,
        canAskProtected: false,
        // The agent's own tool list is not seen here. Every tool of the gateway is declared, so classification stops at the declaration.
        toolInfo: () => undefined,
        ask: () => Promise.resolve(NOBODY_TO_ASK),
        notify(text, level) {
            shared.stderr(`${level === "warn" ? "warning: " : ""}${oneLine(text, 500)}`);
            // Nobody in the conversation saw it, so the notice is still owed.
            return false;
        },
        // No MCP feature wakes the model.
        wake: () => Promise.resolve(false),
        // There is no event bus: the `jig` tool reads the gateway's own outcomes.
        emit: () => undefined,
    };
}

/** The host for what happens between calls: the gateway's own folder and no agent. */
export function processHost(shared: HostShared, cwd: string): EngineHost {
    return requestHost(shared, UNKNOWN_AGENT, cwd);
}

/** A text from a request, or undefined when it is not a non-empty text. */
function textOf(value: unknown): string | undefined {
    return typeof value === "string" && value !== "" ? value : undefined;
}

/**
 * The agent a request names. On revision 2026-07-28 every request carries its client's name and version in the `_meta` envelope; on an older
 * revision the name comes from the `initialize` request, which the SDK keeps (`fallback`). A request that says neither is an unknown agent.
 */
export function clientOf(
    envelope: Record<string, unknown> | undefined,
    fallback?: { name?: unknown; version?: unknown },
): AgentInfo {
    const sent = envelope?.[CLIENT_INFO_META_KEY];
    const info = typeof sent === "object" && sent !== null ? (sent as Record<string, unknown>) : fallback;
    return {
        name: textOf(info?.name) ?? UNKNOWN_AGENT.name,
        version: textOf(info?.version) ?? UNKNOWN_AGENT.version,
    };
}

/**
 * The ids of the agent that are kept: 1 to 200 letters, digits and `_ . : -`. Claude Code's look like `toolu_01LtEu69y4YUCKhnssbH52Nm`. The id goes into every
 * record line of the call and is the key the engine keeps the call under, and any program can send any text, so anything else is not kept.
 */
const KEPT_ID = /^[A-Za-z0-9_.:-]{1,200}$/;

/** A new id for a call: the agent sent none that can be kept, or another call of this process holds the id it sent. */
export function newCallId(): string {
    return randomUUID();
}

/** The id of the call: the agent's own when its request carries one that can be kept (Claude Code does), else a new one. */
export function callIdOf(meta: Record<string, unknown> | undefined): string {
    const sent = textOf(meta?.[TOOL_USE_ID_KEY]);
    return sent !== undefined && KEPT_ID.test(sent) ? sent : newCallId();
}
