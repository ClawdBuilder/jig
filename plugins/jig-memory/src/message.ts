// What the agent reads about a ticket in messages: the notes after activation and after each compaction, and the
// reminder that rides on a tool result. Messages are appended to the conversation. They never change the system
// prompt, which heads the provider's cache, so a change there would rewrite the whole cached conversation.
import { clipBytes } from "./clip.ts";

/** Notes longer than this many bytes are cut in a message; the agent reads notes.md for the rest. */
export const NOTES_IN_MESSAGE = 16 * 1024;
const CUT = "\n[... cut at 16 KB; read notes.md for the rest]";
/** Tool results without a change to notes.md before the reminder comes with one of them. */
export const REMIND_AFTER = 15;

export interface NotesMessage {
    key: string;
    /** The ticket folder, as the agent should open it. */
    folder: string;
    notes: string;
    /** Why the notes come now, such as "Active." */
    lead: string;
    /** Today's local date, `2026-11-02`, so a heading the agent writes is dated by the clock. */
    today: string;
    /** The open checks, as `openChecksText` words them, after the notes. */
    checks?: string | undefined;
}

/**
 * `[ticket KEY] <lead> Folder: <folder>/ (notes.md, evidence/index.md). Today is <date>.`, a blank line, the notes, and the
 * open checks when there are any.
 */
export function notesMessage(input: NotesMessage): string {
    const head = `[ticket ${input.key}] ${input.lead} Folder: ${input.folder}/ (notes.md, evidence/index.md). Today is ${input.today}.`;
    const body = input.notes.trim() === "" ? "(notes.md is empty)" : clipBytes(input.notes, NOTES_IN_MESSAGE, CUT);
    return input.checks === undefined ? `${head}\n\n${body}` : `${head}\n\n${body}\n\n${input.checks}`;
}

/** The reminder, with today's date for a new heading and the number of open checks when there are any. */
export function reminderText(key: string, notesFile: string, today: string, openChecks = 0): string {
    const checks =
        openChecks === 0
            ? ""
            : ` ${openChecks === 1 ? "1 check is" : `${openChecks} checks are`} still open (ticket list_checks).`;
    return `[ticket ${key}] ${REMIND_AFTER} tool results since the ## Now block of notes.md last changed: update it in ${notesFile} (status, next step, open questions). Today is ${today}.${checks}`;
}
