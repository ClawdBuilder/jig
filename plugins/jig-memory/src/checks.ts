// Open checks: what the agent promised to do before the next step, such as "re-derive the locations before the next
// batch". A promise made in a message is easy to forget in the same message, so it is written down here, shown with every
// prompt until it is closed, and the agent is told to close or name each one before it hands the user the next command.
//
// They live in `checks.json` in the ticket folder, so other programs (a status panel, a script) can read them. The file is
// replaced whole, synced, so a reader never sees half of it.
import { readText, replaceFile, ticketPaths } from "./store.ts";

/** The longest text of a check, or of the outcome that closes it. */
export const CHECK_TEXT_LIMIT = 200;
/** The most checks that can be open at once: more than this is a plan, and belongs in notes.md. */
export const OPEN_LIMIT = 20;

export interface Check {
    /** 1, 2, 3 ... in the order they were added; never reused. */
    id: number;
    text: string;
    status: "open" | "closed";
    /** ISO time. */
    openedAt: string;
    closedAt?: string;
    /** What was found or done, given when it was closed. */
    outcome?: string;
}

export interface ChecksFile {
    version: 1;
    checks: Check[];
}

export class CheckError extends Error {}

export function checksFile(folder: string, key: string): string {
    return ticketPaths(folder, key).checks;
}

/** The checks of a ticket, oldest first. A missing file is none. A file that cannot be read as checks is an error,
 *  never overwritten: someone may want to see what is in it. */
export function readChecks(folder: string, key: string): Check[] {
    const text = readText(checksFile(folder, key));
    if (text.trim() === "") return [];
    let raw: unknown;
    try {
        raw = JSON.parse(text);
    } catch {
        throw new CheckError(`${checksFile(folder, key)} is not JSON: fix or remove it`);
    }
    const checks = (raw as { checks?: unknown } | null)?.checks;
    if ((raw as { version?: unknown } | null)?.version !== 1 || !Array.isArray(checks)) {
        throw new CheckError(`${checksFile(folder, key)} is not a checks file of version 1: fix or remove it`);
    }
    return checks.filter(isCheck);
}

export function openChecks(folder: string, key: string): Check[] {
    return readChecks(folder, key).filter((check) => check.status === "open");
}

function isCheck(value: unknown): value is Check {
    const check = value as Partial<Check> | null;
    return (
        typeof check?.id === "number" &&
        typeof check.text === "string" &&
        (check.status === "open" || check.status === "closed") &&
        typeof check.openedAt === "string"
    );
}

/** One line of text, trimmed, within the limit. */
function oneLine(text: string, what: string): string {
    const line = text.replace(/\s+/g, " ").trim();
    if (line === "") throw new CheckError(`${what} is empty`);
    if (line.length > CHECK_TEXT_LIMIT) {
        throw new CheckError(`${what} is ${line.length} characters; at most ${CHECK_TEXT_LIMIT}`);
    }
    return line;
}

function write(folder: string, key: string, checks: Check[]): void {
    const file: ChecksFile = { version: 1, checks };
    replaceFile(checksFile(folder, key), `${JSON.stringify(file, null, 2)}\n`);
}

export function addCheck(folder: string, key: string, text: string, now: Date): Check {
    const checks = readChecks(folder, key);
    const open = checks.filter((check) => check.status === "open").length;
    if (open >= OPEN_LIMIT) {
        throw new CheckError(`${open} checks are open already: close some first, or keep the longer list in notes.md`);
    }
    const check: Check = {
        id: checks.reduce((top, each) => Math.max(top, each.id), 0) + 1,
        text: oneLine(text, "the check"),
        status: "open",
        openedAt: now.toISOString(),
    };
    write(folder, key, [...checks, check]);
    return check;
}

export function closeCheck(folder: string, key: string, id: number, outcome: string, now: Date): Check {
    const checks = readChecks(folder, key);
    const found = checks.find((check) => check.id === id);
    if (found === undefined) throw new CheckError(`no check #${id}; list-checks shows them`);
    if (found.status === "closed") throw new CheckError(`check #${id} is closed already`);
    const closed: Check = {
        ...found,
        status: "closed",
        closedAt: now.toISOString(),
        outcome: oneLine(outcome, "outcome"),
    };
    write(
        folder,
        key,
        checks.map((check) => (check.id === id ? closed : check)),
    );
    return closed;
}

/** `#1 re-derive the locations before the next batch` per line. */
export function checkLines(checks: readonly Check[]): string {
    return checks.map((check) => `#${check.id} ${check.text}`).join("\n");
}

/** What the agent is told about the open checks, with every prompt and in the notes message. Undefined when none. */
export function openChecksText(key: string, checks: readonly Check[]): string | undefined {
    if (checks.length === 0) return undefined;
    const are = checks.length === 1 ? "1 open check" : `${checks.length} open checks`;
    return (
        `[ticket ${key}] ${are}:\n${checkLines(checks)}\n` +
        "Before you hand the user a command for the next step, close each check (ticket close-check) or say plainly that it is still open."
    );
}
