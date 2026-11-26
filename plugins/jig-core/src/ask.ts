// The question a call asks and the answer it gets, without any screen. `approvals.ts` shows the question on Pi's screens
// and re-exports these names, so a caller that knows the old file still works. Nothing here imports Pi: the engine
// reaches a question only through its host, and the queue is plain code that runs one job at a time wherever it is used.
import type { ApprovalKind, Preview } from "./contract.ts";
import type { Answer } from "./records.ts";

export interface AskRequest {
    /** The line naming the tool, action, environment and effect. */
    header: string;
    preview: Preview;
    kind: ApprovalKind;
    /** The tool declared `always: "ask"`: there is no "allow for this session" answer. */
    always?: boolean;
}

export interface Approval {
    answer: Answer;
    /** What the user typed after declining, if anything. */
    reason?: string;
    /** True when the question was closed without an answer (Esc on a selector, the run was aborted). */
    dismissed: boolean;
    /** How long the call waited for the user, in milliseconds, including time in the queue. */
    waitedMs: number;
}

/** Runs a job when no earlier job is running, and holds the queue until it ends. */
export type InTurn = <T>(job: () => Promise<T>) => Promise<T>;

/**
 * A queue of jobs run one at a time, in the order they arrive: tool calls from one model message run in parallel, and a
 * screen has one dialog slot. A failing job does not stop the ones behind it.
 */
export function createInTurn(): InTurn {
    let tail: Promise<unknown> = Promise.resolve();
    return <T>(job: () => Promise<T>): Promise<T> => {
        const turn = tail.then(job, job);
        tail = turn.catch(() => undefined);
        return turn;
    };
}

/**
 * Which screen a call uses: the screen a rule or the tool chose, else the review screen when the preview has a body,
 * else a dialog.
 */
export function chooseKind(chosen: ApprovalKind | undefined, preview: Preview): ApprovalKind {
    return chosen ?? (preview.body !== undefined ? "review" : "dialog");
}
