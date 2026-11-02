// Reading a pin: the one line of a file that holds the version, who holds the environment, and who changed it last.
//
// A pin is read from the branch that deploys (`base`). The line must be exactly one: none, or two that match, is refused
// with the line numbers and not the lines, because a control repository may hold anything.
import { clean, oneLine, utc } from "../values.ts";

/** A line of a file as it is shown: cleaned of control characters and cut, with its spacing as it is. */
export function lineShown(line: string, max = 200): string {
    const text = clean(line);
    return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}
import { fileAt, lastCommit } from "./pin-github.ts";
import type { Commit, Reads } from "./pin-github.ts";
import type { PinFile, PinSource } from "./pin-config.ts";

/** The most lines of a file read, and the longest line a pattern is tried on. */
const MAX_LINES = 50_000;
const MAX_LINE_CHARS = 2000;

/** One pin file as it is at the branch: the line that holds the version, and what its named groups hold. */
export interface PinRead {
    pin: PinFile;
    /** The blob sha of the file, which a write would name. */
    blob: string;
    lineNumber: number;
    /** The line as it is, cleaned of control characters and cut for showing. */
    line: string;
    /** The line as it is in the file, for matching. */
    raw: string;
    version: string;
    /** The named groups of the pin's `line` pattern that matched, `version` included. */
    groups: Readonly<Record<string, string>>;
    /** The whole text of the file, for a write that changes one line of it. */
    text: string;
}

/** The line of a file that a pin names: exactly one, or an error that says what is wrong. */
export function matchLine(text: string, pin: PinFile, where: string): Omit<PinRead, "blob" | "text" | "pin"> {
    const lines = text.split("\n");
    if (lines.length > MAX_LINES) throw new Error(`${where} has more than ${MAX_LINES} lines`);
    const found: Array<{ number: number; raw: string; groups: Record<string, string> }> = [];
    lines.forEach((line, index) => {
        const raw = line.endsWith("\r") ? line.slice(0, -1) : line;
        if (raw.length > MAX_LINE_CHARS) return;
        const match = pin.line.regex.exec(raw);
        if (match === null) return;
        const groups: Record<string, string> = {};
        for (const [name, value] of Object.entries(match.groups ?? {})) if (value !== undefined) groups[name] = value;
        found.push({ number: index + 1, raw, groups });
    });
    if (found.length === 0) throw new Error(`${where} has no line that matches the pin's pattern: change it by hand`);
    if (found.length > 1) {
        const numbers = found
            .slice(0, 5)
            .map((entry) => entry.number)
            .join(", ");
        const more = found.length > 5 ? " and more" : "";
        throw new Error(
            `${where} has ${found.length} lines that match, not 1 (lines ${numbers}${more}): change it by hand`,
        );
    }
    const only = found[0] as (typeof found)[number];
    const version = only.groups.version;
    if (version === undefined || version === "") {
        throw new Error(`the line ${only.number} of ${where} matches, but its version group is empty`);
    }
    return {
        lineNumber: only.number,
        line: lineShown(only.raw),
        raw: only.raw,
        version,
        groups: only.groups,
    };
}

/** One pin file of a source, read at the branch that deploys. */
export async function readPin(source: PinSource, pin: PinFile, reads: Reads): Promise<PinRead> {
    const where = `${pin.file} in ${source.repo} on ${source.base}`;
    const file = await fileAt(source.repo, pin.file, source.base, reads);
    if (file === undefined) throw new Error(`${where} was not found (the file, the branch or the repository)`);
    return { pin, blob: file.sha, text: file.text, ...matchLine(file.text, pin, where) };
}

/** Every pin file of a source. They are read one after the other, so that the calls come in a fixed order. */
export async function readPins(source: PinSource, reads: Reads): Promise<PinRead[]> {
    const read: PinRead[] = [];
    for (const pin of source.pins) read.push(await readPin(source, pin, reads));
    return read;
}

/** Who holds the environment: the ticket on the first pin's line, and the last change to that file. */
export interface Holder {
    ticket: string | undefined;
    commit: Commit | undefined;
    /** Set when the last commit could not be read. The ticket is still known. */
    problem: string | undefined;
}

/** The ticket the `holder` pattern finds on the first pin's line. */
export function ticketOf(source: PinSource, first: PinRead): string | undefined {
    const ticket = source.holder?.regex.exec(first.raw)?.groups?.ticket;
    return ticket === undefined || ticket === "" ? undefined : oneLine(clean(ticket), 60);
}

export async function readHolder(source: PinSource, first: PinRead, reads: Reads): Promise<Holder> {
    const ticket = ticketOf(source, first);
    try {
        return {
            ticket,
            commit: await lastCommit(source.repo, first.pin.file, source.base, reads),
            problem: undefined,
        };
    } catch (error) {
        return { ticket, commit: undefined, problem: error instanceof Error ? error.message : String(error) };
    }
}

/** `changed by A. Person 2026-11-01 10:10 UTC, PR #88`, or why that is not known. */
export function changeText(holder: Holder): string {
    if (holder.problem !== undefined) return `who changed it last could not be read (${holder.problem})`;
    const commit = holder.commit;
    if (commit === undefined) return "no commit of the file was found on the branch";
    const when = commit.at === undefined ? "" : ` ${utc(commit.at)}`;
    const pr = commit.pr === undefined ? "" : `, PR #${commit.pr}`;
    return `changed by ${commit.author}${when}${pr}`;
}

/** What the runtime reports for a pinned version: the pin's `runsAs` pattern applied, else the version itself. */
export function runsAs(source: PinSource, version: string): string {
    const found = source.runsAs?.regex.exec(version)?.groups?.version;
    return found === undefined || found === "" ? version : found;
}
