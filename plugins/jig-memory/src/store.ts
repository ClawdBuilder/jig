// The ticket folder on disk: <folder>/<KEY>/ holds notes.md (what is known, kept by the agent), plan.md (the plan that
// jig-workflow asks you to approve), evidence/ (the saved results and index.md), history/ (the older lines of ## Now),
// ticket.json (the repositories bound to the ticket), checks.json (the open checks, once there is one) and, after a close,
// card.md. Folders are 0700 and files 0600, because the notes and the evidence hold what the tools returned. Every file is
// written synced (jig-core's kit/files.ts), so a machine that is killed mid-write never leaves one of them empty.
import { mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { createFileDurably, replaceFileDurably } from "../../jig-core/src/kit/files.ts";
import { historyText, notesTemplate, tidyNow } from "./notes.ts";

export const FOLDER_MODE = 0o700;
export const FILE_MODE = 0o600;

// A key becomes a folder name, so it starts with a letter or digit and goes on with letters, digits and `_ . -`.
const KEY = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/;

export interface TicketPaths {
    dir: string;
    notes: string;
    plan: string;
    ticket: string;
    /** card.md: made at close, not at activation. */
    card: string;
    /** checks.json: the open checks, made when the first one is added. */
    checks: string;
    evidence: string;
    index: string;
    history: string;
}

export function isSafeKey(key: string): boolean {
    return KEY.test(key);
}

export function ticketPaths(folder: string, key: string): TicketPaths {
    const dir = path.join(folder, key);
    const evidence = path.join(dir, "evidence");
    return {
        dir,
        notes: path.join(dir, "notes.md"),
        plan: path.join(dir, "plan.md"),
        ticket: path.join(dir, "ticket.json"),
        card: path.join(dir, "card.md"),
        checks: path.join(dir, "checks.json"),
        evidence,
        index: path.join(evidence, "index.md"),
        history: path.join(dir, "history"),
    };
}

/** 2026-10-30T10-15-00.123Z: sorts by time, and has no characters that a file name dislikes. */
export function stampOf(time: Date): string {
    return time.toISOString().replace(/:/g, "-");
}

/** The ticket keys a text names, in order and each once. A match that is not a safe folder name is left out. */
export function mentionedTickets(text: string, pattern: RegExp): string[] {
    const keys = [...text.matchAll(pattern)].map((match) => match[0]).filter(isSafeKey);
    return [...new Set(keys)];
}

/**
 * Creates the ticket's folders and the files it lacks, each with its starting text. A file that exists is never
 * touched, so activating a ticket again, or from a second session, changes nothing.
 */
export function ensureTicket(folder: string, key: string): void {
    const paths = ticketPaths(folder, key);
    mkdirSync(paths.evidence, { recursive: true, mode: FOLDER_MODE });
    mkdirSync(paths.history, { recursive: true, mode: FOLDER_MODE });
    createFile(paths.index, "# Evidence\n\nOne line per saved tool result: time | tool | action | file.\n\n");
    createFile(paths.plan, `# ${key} plan\n`);
    createFile(paths.ticket, '{\n  "repositories": []\n}\n');
    createFile(paths.notes, notesTemplate(key));
}

/**
 * notes.md as it is on disk now. When its ## Now block is over the limit, the lines it gives up move to a new file in
 * history/ first, and only then is notes.md rewritten, so a failure in between loses nothing.
 */
export function settleNotes(folder: string, key: string, now: Date): string {
    const paths = ticketPaths(folder, key);
    const notes = readText(paths.notes);
    const historyName = `${stampOf(now)}.md`;
    const tidied = tidyNow(notes, historyName);
    if (tidied === undefined) return notes;
    if (!createFile(path.join(paths.history, historyName), historyText(tidied.moved, now))) {
        throw new Error(`${historyName} already exists`);
    }
    replaceFile(paths.notes, tidied.notes);
    return tidied.notes;
}

/** A text file's contents, or "" when the file does not exist (a folder deleted by hand is still a ticket). */
export function readText(file: string): string {
    try {
        return readFileSync(file, "utf8");
    } catch (error) {
        if (errorCode(error) === "ENOENT") return "";
        throw error;
    }
}

/** Writes a file that does not exist yet, synced to disk before it is closed. Returns false, and changes nothing, when
 *  it exists. */
export function createFile(file: string, content: string): boolean {
    try {
        createFileDurably(file, content, FILE_MODE);
        return true;
    } catch (error) {
        if (errorCode(error) === "EEXIST") return false;
        throw error;
    }
}

/** Replaces a file through a synced temporary file beside it, and syncs the folder after the rename, so a crash, even of
 *  the whole machine, leaves the old text or the new, never a cut or empty one. */
export function replaceFile(file: string, content: string): void {
    replaceFileDurably(file, content, FILE_MODE);
}

function errorCode(error: unknown): unknown {
    return (error as { code?: unknown } | null)?.code;
}
