// Where the status files live, and how one is written and removed. A status file is replaced in one step (a temporary
// file, then a rename), so a reader never sees half of one.
import { randomBytes } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

/** `$JIG_STATE_DIR`, else `${XDG_STATE_HOME:-~/.local/state}/jig`: jig-core's rule, repeated, because a plugin never imports its modules. */
export function stateDir(env: NodeJS.ProcessEnv = process.env): string {
    const chosen = env.JIG_STATE_DIR;
    if (chosen !== undefined && chosen !== "") return path.resolve(chosen);
    const xdg = env.XDG_STATE_HOME;
    const base = xdg !== undefined && path.isAbsolute(xdg) ? xdg : path.join(homedir(), ".local", "state");
    return path.join(base, "jig");
}

/** The folder of the status files: `<state dir>/sessions`. */
export const sessionsDir = (state: string): string => path.join(state, "sessions");

/** A session id as a file name: letters, digits, dot, dash and underscore; anything else becomes `_`. */
export function fileName(sessionId: string): string {
    const safe = sessionId.replace(/[^A-Za-z0-9._-]/g, "_").replace(/^\.+/, "_");
    return `${safe.slice(0, 120) || "session"}.json`;
}

/** Writes `text` to `file` through a temporary file in the same folder and a rename. The folder is made, private, when missing. */
export function writeAtomic(file: string, text: string): void {
    mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    const temp = `${file}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`;
    try {
        writeFileSync(temp, text, { mode: 0o600 });
        renameSync(temp, file);
    } catch (error) {
        rmSync(temp, { force: true });
        throw error;
    }
}

export function removeFile(file: string): void {
    rmSync(file, { force: true });
}

/** Whether a process with this id runs. A process of another user counts as running (`EPERM`). */
export function running(pid: number): boolean {
    try {
        process.kill(pid, 0);
        return true;
    } catch (error) {
        return (error as NodeJS.ErrnoException).code === "EPERM";
    }
}

/**
 * Removes the status files that a Pi which ended without its shutdown (a crash, a killed terminal) left behind: those whose
 * `pid` no longer runs, and leftover temporary files. Returns the names removed.
 */
export function sweep(dir: string, isRunning: (pid: number) => boolean = running): string[] {
    let names: string[];
    try {
        names = readdirSync(dir);
    } catch {
        return [];
    }
    const removed: string[] = [];
    for (const name of names) {
        const file = path.join(dir, name);
        if (name.endsWith(".tmp")) {
            const pid = Number(/\.(\d+)\.[0-9a-f]+\.tmp$/.exec(name)?.[1]);
            if (Number.isInteger(pid) && !isRunning(pid)) {
                rmSync(file, { force: true });
                removed.push(name);
            }
            continue;
        }
        if (!name.endsWith(".json")) continue;
        let pid: unknown;
        try {
            pid = (JSON.parse(readFileSync(file, "utf8")) as { pid?: unknown }).pid;
        } catch {
            continue; // not ours to judge
        }
        if (typeof pid === "number" && Number.isInteger(pid) && pid > 0 && !isRunning(pid)) {
            rmSync(file, { force: true });
            removed.push(name);
        }
    }
    return removed;
}
