// Compacting a session while the person is away, a little before the provider's prompt cache expires: the next turn
// would otherwise write the whole context to the cache again at the cache-write price. The summary itself is a fresh
// model call, not a cache read (Pi turns cache retention off for it), so this pays when the smaller context is used
// again, and costs when it is not. Off by default, because it spends a summary when nobody comes back and a summary
// loses detail; `session.compactWhenIdle` turns it on.
//
// Pi offers the two pieces this needs: `agent_settled` is the final-idle signal (`agent_end` is not: a retry, an automatic
// compaction or a queued message can follow it), and `ctx.compact()` starts a compaction from an extension. Pi refuses a
// prompt submitted while a compaction runs, so it starts one only when the session is idle, nothing waits, and the editor
// is empty. A keystroke is not visible to an extension: the text in the editor at that moment is.
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { unknownField } from "../../jig-core/src/kit/fields.ts";

/** The least wait the setting allows: a shorter pause is a person thinking, not gone. */
export const MIN_AFTER_SECONDS = 60;
/** The most it allows: providers keep a prompt cache for about five minutes, and the wait should end before then. */
export const MAX_AFTER_SECONDS = 290;
/** Thirty seconds of headroom under that five minutes. */
export const DEFAULT_AFTER_SECONDS = 270;
/** A starting point: near the size where the summary and the smaller cache write cost about the write this avoids.
 *  Below it the first turn back can cost more than it saves; the saving then depends on later turns. */
export const DEFAULT_MIN_TOKENS = 150_000;
export const MIN_MIN_TOKENS = 1_000;

/** The setting: how long a session must be idle, and how big its context must be. */
export interface IdleCompaction {
    afterSeconds: number;
    minTokens: number;
}

const FIELDS: ReadonlySet<string> = new Set(["compactWhenIdle"]);
const IDLE_FIELDS: ReadonlySet<string> = new Set(["afterSeconds", "minTokens"]);

/** What a `session` section says: errors, and the setting when it is valid. `null` is the person's explicit "off";
 *  `undefined` is a section or key that is not there. */
export function parseSession(raw: unknown): { errors: string[]; setting?: IdleCompaction | null } {
    if (typeof raw !== "object" || raw === null || Array.isArray(raw))
        return { errors: ["session: must be an object"] };
    const fields = raw as Record<string, unknown>;
    const errors = Object.keys(fields)
        .filter((name) => !FIELDS.has(name))
        .map((name) => unknownField("session", name, [...FIELDS]));
    const idle = fields.compactWhenIdle;
    if (idle === undefined) return { errors };
    if (idle === false) return { errors, setting: null };
    if (idle === true) return { errors, setting: defaultSetting() };
    if (typeof idle !== "object" || idle === null || Array.isArray(idle)) {
        errors.push("session.compactWhenIdle: must be true, false, or an object such as { afterSeconds: 270 }");
        return { errors };
    }
    const setting = idle as Record<string, unknown>;
    const afterSeconds = setting.afterSeconds;
    const minTokens = setting.minTokens;
    for (const name of Object.keys(setting).filter((one) => !IDLE_FIELDS.has(one))) {
        errors.push(unknownField("session.compactWhenIdle", name, [...IDLE_FIELDS]));
    }
    if (
        afterSeconds !== undefined &&
        (typeof afterSeconds !== "number" ||
            !Number.isInteger(afterSeconds) ||
            afterSeconds < MIN_AFTER_SECONDS ||
            afterSeconds > MAX_AFTER_SECONDS)
    ) {
        errors.push(
            `session.compactWhenIdle.afterSeconds: must be a whole number of seconds from ${MIN_AFTER_SECONDS} to ${MAX_AFTER_SECONDS}; the prompt cache lives about five minutes`,
        );
    }
    if (
        minTokens !== undefined &&
        (typeof minTokens !== "number" || !Number.isInteger(minTokens) || minTokens < MIN_MIN_TOKENS)
    ) {
        errors.push(
            `session.compactWhenIdle.minTokens: must be a whole number of tokens, at least ${MIN_MIN_TOKENS}; a smaller context is not worth a summary`,
        );
    }
    if (errors.length > 0) return { errors };
    return {
        errors,
        setting: {
            afterSeconds: typeof afterSeconds === "number" ? afterSeconds : DEFAULT_AFTER_SECONDS,
            minTokens: typeof minTokens === "number" ? minTokens : DEFAULT_MIN_TOKENS,
        },
    };
}

function defaultSetting(): IdleCompaction {
    return { afterSeconds: DEFAULT_AFTER_SECONDS, minTokens: DEFAULT_MIN_TOKENS };
}

/** The check jig-session registers for the `session` section of jig.json. */
export function validateSessionSection(raw: unknown): string[] {
    return parseSession(raw).errors;
}

/** The setting in a loaded section: undefined when it is not set, null when the person turned it off. */
export function idleCompactionOf(section: unknown): IdleCompaction | null | undefined {
    if (section === undefined) return undefined;
    const { errors, setting } = parseSession(section);
    return errors.length === 0 ? setting : undefined;
}

/** The line `/jig` shows for the setting, or undefined when the person has not set one. */
export function idleCompactionLine(section: (name: string) => unknown): string | undefined {
    const setting = idleCompactionOf(section("session"));
    if (setting === undefined) return undefined;
    if (setting === null) return "Idle compaction: off";
    return `Idle compaction: after ${setting.afterSeconds} s idle, from ${count(setting.minTokens)} tokens`;
}

const count = (value: number): string => value.toLocaleString("en-US");

/** `setTimeout` and `clearTimeout`, kept abstract so a test can give a clock it moves itself. */
export interface Timers {
    setTimeout: (callback: () => void, ms: number) => unknown;
    clearTimeout: (handle: unknown) => void;
}

export interface IdleCompactOptions {
    /** A section of jig.json as jig-core loaded it. */
    section: (name: string) => unknown;
    timers?: Timers;
}

/**
 * Sets the idle timer: after `agent_settled` (and not an aborted run), wait the setting's time, then compact once if the
 * session is still idle, nothing waits and the context is big enough. Any input, turn, tool call or extension prompt
 * cancels the wait, so it never runs while the person or the agent is working. One timer per idle stretch.
 */
export function idleCompact(pi: ExtensionAPI, options: IdleCompactOptions): void {
    const timers = options.timers ?? {
        setTimeout: (callback: () => void, ms: number) => setTimeout(callback, ms),
        clearTimeout: (handle: unknown) => clearTimeout(handle as ReturnType<typeof setTimeout>),
    };
    let pending: unknown;
    const cancel = (): void => {
        if (pending === undefined) return;
        timers.clearTimeout(pending);
        pending = undefined;
    };
    // The next thing anyone does ends the stretch the timer was for.
    pi.on("agent_start", cancel);
    pi.on("turn_start", cancel);
    pi.on("tool_call", cancel);
    pi.on("input", cancel);
    pi.on("ui_prompt_start", cancel);
    pi.on("session_before_compact", cancel);
    pi.on("session_compact", cancel);
    pi.on("session_shutdown", cancel);
    pi.on("agent_settled", (event, ctx) => {
        cancel();
        if (event.aborted) return;
        // A print or json run has no person to come back: do not even start a timer that would keep it alive.
        if (ctx.mode !== "tui" && ctx.mode !== "rpc") return;
        const setting = idleCompactionOf(options.section("session"));
        if (setting === undefined || setting === null) return;
        pending = timers.setTimeout(() => {
            pending = undefined;
            try {
                // The setting may have been turned off or changed while the person was away.
                const current = idleCompactionOf(options.section("session"));
                if (current === undefined || current === null) return;
                compact(current, ctx);
            } catch (error) {
                // A timer callback that throws would take the session down with it.
                tell(ctx, `jig-session: could not compact while idle: ${messageOf(error)}`, "warning");
            }
        }, setting.afterSeconds * 1000);
    });
}

/** Compacts once, or does nothing: the session may have become busy, a draft may be waiting, or the context is small. */
function compact(setting: IdleCompaction, ctx: ExtensionContext): void {
    // `print` and `json` have no person to come back: a summary there is spent for nothing.
    if (ctx.mode !== "tui" && ctx.mode !== "rpc") return;
    if (!ctx.isIdle() || ctx.hasPendingMessages()) return;
    if (draftInEditor(ctx)) return;
    const tokens = ctx.getContextUsage()?.tokens ?? 0;
    if (tokens < setting.minTokens) return;
    ctx.compact({
        onComplete: (result) => {
            const after = result.estimatedTokensAfter;
            const before = count(result.tokensBefore);
            tell(
                ctx,
                `jig-session: compacted while idle: ${before}${after === undefined ? " tokens before" : ` → ${count(after)} tokens`}`,
                "info",
            );
        },
        onError: (error) => {
            tell(ctx, `jig-session: could not compact while idle: ${error.message}`, "warning");
        },
    });
}

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/** A notification that never throws: the session may be shutting down when a compaction ends. */
function tell(ctx: ExtensionContext, text: string, type: "info" | "warning"): void {
    try {
        ctx.ui.notify(text, type);
    } catch {
        // The session is gone; there is nobody to tell.
    }
}

/** Whether the person has typed something they have not sent yet. Pi has no keystroke event; this is the one look. */
function draftInEditor(ctx: ExtensionContext): boolean {
    try {
        return ctx.ui.getEditorText().trim() !== "";
    } catch {
        return false;
    }
}
