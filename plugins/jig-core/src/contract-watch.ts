// The watch part of the plugin contract: what a watch returns, how a plugin polls one, and what `/jig` shows.
// Re-exported from contract.ts, which stays the one import plugins use.
import type { Facts } from "./contract.ts";

/** The end of a watch. */
export interface WatchResult {
    outcome: "passed" | "failed" | "timed-out" | "stopped" | "error";
    /** One line for the agent and the user. */
    summary: string;
    /** A few more lines, such as the start of a failed log. jig-core masks and redacts them. */
    details?: string;
    links?: readonly string[];
    facts?: Facts;
}

/** News for the agent while a watch goes on, such as new comments on a pull request. */
export interface WatchUpdate {
    /** One line for the agent and the user. */
    summary: string;
    /** More lines, up to 40, such as the text of the news. jig-core masks and redacts them. */
    details?: string;
    links?: readonly string[];
}

/** One poll of a watch. */
export interface PollOutcome<State> {
    /** Saved with the watch, so polling resumes where it stopped after Pi restarts. */
    state: State;
    /** Set when the finish line is reached. */
    done?: WatchResult;
    /**
     * Tells the agent now, in a message of its own, and the watch goes on. Send it with the state that remembers what it
     * says, so the next poll does not say it again. A poll that is also `done` sends its update first, in the same message.
     */
    update?: WatchUpdate;
    /** The next poll sooner or later than the kind's interval, such as GitHub's `X-Poll-Interval`. */
    nextPollMs?: number;
}

/** A kind of watch a plugin can start, such as GitHub checks. Registered once per load. */
export interface WatchKind<Spec, State> {
    /** Unique across plugins, such as `ops-ci`. */
    kind: string;
    plugin: string;
    intervalMs: number;
    /** One line naming what is watched, for `watch list`. */
    describe(spec: Spec): string;
    /** Polls once. A throw is a failed poll; three in a row pause the watch with one notice. */
    poll(spec: Spec, state: State | undefined, signal: AbortSignal): Promise<PollOutcome<State>>;
}

export interface StartWatch<Spec> {
    kind: string;
    /** Plain JSON: it is saved to disk with the watch. */
    spec: Spec;
    /** One line, such as "checks of pull request 42". */
    title: string;
    /** Default 60. */
    timeoutMinutes?: number;
    /** A "still waiting" notice to the user after this long. Default 30. */
    stallMinutes?: number;
}

export interface WatchInfo {
    id: string;
    kind: string;
    plugin: string;
    title: string;
    status: "open" | "paused" | "done";
    startedAt: string;
    result?: WatchResult;
}
