// Empty files in a ticket folder: a sign that a write was cut short. A machine that is killed while a shell redirect or an
// editor is writing can leave a file at 0 bytes, and nothing else says so: the next command reads it as "no rows". So when a
// ticket becomes active, or a session restores it, the folder is searched for files that are empty and were changed in the
// last few days, and the agent and the user are told. Nothing is repaired: only a person knows what the file should hold.
import { lstatSync, readdirSync } from "node:fs";
import path from "node:path";
import { localDate, localTime } from "./notes.ts";

/** Files changed longer ago than this are not reported: an old empty file is a choice someone made, not a crash. */
export const EMPTY_RECENT_DAYS = 7;
/** The most files a notice names; the rest are counted. */
export const EMPTY_SHOWN = 10;
/** The most entries looked at in one folder tree, so a folder that someone filled with a large copy stays quick. */
const SCAN_LIMIT = 5000;
// evidence/ holds the results Jig saved itself, written whole and synced, and a tool that printed nothing is a real empty
// result, so an empty file there says nothing about a crash. A `.tmp` file is a write in progress that a rename never took,
// and the file it was for is intact.
const SKIPPED_FOLDERS: ReadonlySet<string> = new Set(["evidence"]);

export interface EmptyFile {
    /** The path inside the ticket folder, with `/` between folders. */
    file: string;
    /** When it was last changed. */
    changed: Date;
}

export interface EmptyFiles {
    /** Newest first, at most EMPTY_SHOWN. */
    shown: EmptyFile[];
    /** How many there are in all. */
    total: number;
}

/** The files of the ticket folder that are 0 bytes and were changed within EMPTY_RECENT_DAYS of `now`. */
export function findEmptyFiles(dir: string, now: Date): EmptyFiles {
    const since = now.getTime() - EMPTY_RECENT_DAYS * 24 * 60 * 60 * 1000;
    const found: EmptyFile[] = [];
    let looked = 0;
    const walk = (folder: string, prefix: string, top: boolean) => {
        let names: string[];
        try {
            names = readdirSync(folder);
        } catch {
            return;
        }
        for (const name of names.sort()) {
            if (++looked > SCAN_LIMIT) return;
            if (top && SKIPPED_FOLDERS.has(name)) continue;
            const full = path.join(folder, name);
            let stat: ReturnType<typeof lstatSync>;
            try {
                stat = lstatSync(full);
            } catch {
                continue;
            }
            // A link is never followed: it may point anywhere, and what it points at is not the ticket's.
            if (stat.isDirectory()) walk(full, `${prefix}${name}/`, false);
            else if (stat.isFile() && stat.size === 0 && !name.endsWith(".tmp") && stat.mtimeMs >= since) {
                found.push({ file: `${prefix}${name}`, changed: stat.mtime });
            }
        }
    };
    walk(dir, "", true);
    found.sort((a, b) => b.changed.getTime() - a.changed.getTime() || a.file.localeCompare(b.file));
    return { shown: found.slice(0, EMPTY_SHOWN), total: found.length };
}

/** The notice, or undefined when there is nothing to say. A file changed today shows its time; an older one, its date too. */
export function emptyFilesText(key: string, found: EmptyFiles, now: Date): string | undefined {
    if (found.total === 0) return undefined;
    const today = localDate(now);
    const when = (changed: Date) =>
        localDate(changed) === today ? localTime(changed) : `${localDate(changed)} ${localTime(changed)}`;
    const list = found.shown.map((entry) => `${entry.file} (changed ${when(entry.changed)})`).join(", ");
    const more = found.total > found.shown.length ? `, and ${found.total - found.shown.length} more` : "";
    const are = found.total === 1 ? "This file is" : "These files are";
    return `[ticket ${key}] ${are} empty, possibly cut short by a crash or an unfinished write: ${list}${more}. Check before using them.`;
}
