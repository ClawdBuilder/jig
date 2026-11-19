// The gate part of the plugin contract: what a gate sees of a call and what it may answer. Re-exported from contract.ts,
// which stays the one import plugins use.
import type { Effect, EnvironmentKind, EnvironmentName } from "./contract.ts";

/**
 * A call as a gate sees it, after the rules have decided. Frozen: a gate looks and does not change what runs.
 */
export interface GateCall {
    toolCallId: string;
    tool: string;
    action?: string;
    environment: EnvironmentName;
    environmentKind: EnvironmentKind;
    effect: Effect;
    /** What has been decided so far. A call that is already denied is not shown to gates. */
    decision: "allow" | "ask";
    /** The call's input, as the model sent it. */
    input: Readonly<Record<string, unknown>>;
    /** Pi's working folder: where a relative path starts. */
    cwd: string;
    /** For Pi's `write` and `edit`: the absolute path the call acts on, as written once `~` and `..` are resolved, and
     *  with every link followed (the same path twice when there is no link). Empty for every other tool. */
    paths: readonly string[];
}

/** What a gate may answer: stricter, never looser. */
export interface GateVerdict {
    decision: "ask" | "deny";
    /** One line for the model and the user: why. It names the condition and what fixes it. */
    reason: string;
}

/**
 * A check a plugin registers with `gates.register`. jig-core asks every gate about each call once the rules have decided,
 * and a gate can only make the decision stricter: an `allow` becomes an `ask` or a `deny`, an `ask` becomes a `deny`.
 */
export interface Gate {
    /** Unique: registering the same name again replaces the gate. */
    name: string;
    /** The plugin that registered it, for `/jig`. */
    plugin: string;
    /** Answers nothing to leave the decision as it is. Throwing, or taking more than 10 seconds, denies the call. */
    check(call: GateCall, signal: AbortSignal): GateVerdict | undefined | Promise<GateVerdict | undefined>;
}
