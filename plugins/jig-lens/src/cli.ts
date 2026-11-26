// `jig lens` in a terminal, with no Pi: it opens the index, imports the records that are new, and prints one plain line for
// each of the last calls, so a person (or a script) can see which agent ran what and which place decided it. This file and
// the files it imports load no Pi package. `bin/jig.mjs` starts it, because jig-core's own command list may not import a
// plugin; `/lens` in Pi is the same index with more views.
import type { DatabaseSync } from "node:sqlite";
import { label, table } from "./format.ts";
import { importRecords } from "./import.ts";
import { lensPaths, stateDir } from "./paths.ts";
import { reason } from "./report.ts";
import { openIndex } from "./store.ts";

/** How many calls the command prints. */
export const RECENT_CALLS = 20;

/** What it says when the records hold no call: one line, so a script that counts lines sees one. */
export const NO_CALLS = "No calls recorded yet.";

/** What one printed line shows of a call. A field the record lacks is null: a line written before the agent's name and the
 *  enforcement point were added has neither. */
export interface RecentCall {
    /** Seconds since the epoch, as the index keeps it. */
    time: number;
    agentName: string | null;
    tool: string;
    action: string | null;
    decision: string | null;
    outcome: string;
    enforcedBy: string | null;
}

/** The last `limit` calls, the oldest of them first, so the newest is the last line on the screen. */
export function recentCalls(db: DatabaseSync, limit: number = RECENT_CALLS): RecentCall[] {
    const rows = db
        .prepare(
            `SELECT time, agentName, tool, action, decision, outcome, enforcedBy
             FROM call ORDER BY time DESC, rowid DESC LIMIT ?`,
        )
        .all(limit);
    const text = (value: unknown): string | null => (typeof value === "string" ? value : null);
    return rows
        .map((row) => ({
            time: Number(row.time),
            agentName: text(row.agentName),
            tool: String(row.tool),
            action: text(row.action),
            decision: text(row.decision),
            outcome: String(row.outcome),
            enforcedBy: text(row.enforcedBy),
        }))
        .reverse();
}

/** `2026-11-26T12:19:03Z`: the time the way the records give it, in UTC. */
const timeOf = (seconds: number): string => `${new Date(seconds * 1000).toISOString().slice(0, 19)}Z`;

/** The lines to print: time, agent, tool, action, decision, outcome and enforcement, in columns, with a dash where the record has
 *  no value. Names come from other code, so each one is made safe to print first. */
export function callLines(calls: readonly RecentCall[]): string[] {
    const cell = (value: string | null): string => (value === null || value === "" ? "-" : label(value, 40));
    return table(
        calls.map((call) => [
            timeOf(call.time),
            cell(call.agentName),
            cell(call.tool),
            cell(call.action),
            cell(call.decision),
            cell(call.outcome),
            cell(call.enforcedBy),
        ]),
    );
}

/** What `run` needs of the outside world, so a test can read what it says and choose the folder and the clock. */
export interface CliOptions {
    env?: NodeJS.ProcessEnv;
    now?: Date;
    out?: (text: string) => void;
    err?: (text: string) => void;
}

/** `jig lens`: prints the last calls and returns the exit code: 0 when it read the records (even when there is no call), 1 when
 *  it could not, 2 for a word it does not take. */
export async function run(args: readonly string[], options: CliOptions = {}): Promise<number> {
    const out = options.out ?? ((text: string) => process.stdout.write(text));
    const err = options.err ?? ((text: string) => process.stderr.write(text));
    const [word] = args;
    if (word !== undefined) {
        // The same two refusals as the other commands: an option it does not have, and a word, which may be a message for Pi.
        err(
            word.startsWith("-")
                ? `jig lens: unknown option ${label(word)}.\nRun jig lens --help for usage.\n`
                : `jig lens takes no words like "${label(word)}". To ask Pi, run: jig "lens ${label(args.join(" "), 80)}"\n`,
        );
        return 2;
    }
    const paths = lensPaths(stateDir(options.env ?? process.env));
    let db: DatabaseSync | undefined;
    try {
        db = openIndex(paths.index);
        const imported = await importRecords(db, { records: paths.records, now: options.now ?? new Date() });
        // A record file that cannot be read does not stop the others, and the person is told which one.
        for (const problem of imported.problems) err(`Not read: ${problem}\n`);
        const lines = callLines(recentCalls(db));
        out(`${(lines.length === 0 ? [NO_CALLS] : lines).join("\n")}\n`);
        return 0;
    } catch (error) {
        err(`jig lens could not read the records: ${reason(error)}\n`);
        return 1;
    } finally {
        db?.close();
    }
}
