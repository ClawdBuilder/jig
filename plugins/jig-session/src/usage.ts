// What a session has used so far and how full its context is, counted the way `jig-theme`'s footer counts it: the usage
// each model reply, tool result, cache refresh, compaction and branch summary carries, and Pi's own context estimate.
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

type Rec = Record<string, unknown>;
const isRec = (value: unknown): value is Rec => typeof value === "object" && value !== null;
const number = (value: unknown): number | undefined =>
    typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;

export interface Usage {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
    /** Estimated cost in the provider's prices, or null when one call in the session had no price. */
    cost: number | null;
}

export interface ContextFill {
    tokens: number | null;
    window: number | null;
    percent: number | null;
}

/** The totals of a list of session entries. */
export function sumUsage(entries: readonly unknown[]): Usage {
    const total: Usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 };
    for (const entry of entries) {
        if (!isRec(entry)) continue;
        const message = entry.type === "message" && isRec(entry.message) ? entry.message : undefined;
        const ofMessage = message !== undefined && (message.role === "assistant" || message.role === "toolResult");
        const ofEntry = entry.type === "usage" || entry.type === "compaction" || entry.type === "branch_summary";
        if (!ofMessage && !ofEntry) continue;
        const usage = ofMessage ? message?.usage : entry.usage;
        if (!isRec(usage)) continue;
        total.input += number(usage.input) ?? 0;
        total.output += number(usage.output) ?? 0;
        total.cacheRead += number(usage.cacheRead) ?? 0;
        total.cacheWrite += number(usage.cacheWrite) ?? 0;
        const cost = number(isRec(usage.cost) ? usage.cost.total : usage.cost);
        total.cost = total.cost === null || cost === undefined ? null : total.cost + cost;
    }
    if (total.cost !== null) total.cost = Math.round(total.cost * 1e6) / 1e6;
    return total;
}

/** The session's totals, from all its entries (every branch, as the footer counts them). */
export function sessionUsage(ctx: Pick<ExtensionContext, "sessionManager">): Usage {
    const manager = ctx.sessionManager as {
        getEntries?: () => readonly unknown[];
        getBranch: () => readonly unknown[];
    };
    return sumUsage(manager.getEntries?.() ?? manager.getBranch());
}

/** How full the context is now: Pi's estimate, and the model's window when Pi has none. */
export function contextFill(ctx: Pick<ExtensionContext, "getContextUsage" | "model">): ContextFill {
    let context: ReturnType<ExtensionContext["getContextUsage"]>;
    try {
        context = ctx.getContextUsage();
    } catch {
        context = undefined;
    }
    const window = number(context?.contextWindow ?? ctx.model?.contextWindow) ?? null;
    const percent = number(context?.percent);
    const tokens =
        number(context?.tokens) ?? (percent !== undefined && window !== null ? (percent / 100) * window : undefined);
    return {
        tokens: tokens === undefined ? null : Math.round(tokens),
        window,
        percent: percent === undefined ? null : Math.round(percent * 10) / 10,
    };
}
