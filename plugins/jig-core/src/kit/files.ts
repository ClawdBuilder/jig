// Writing a file so that it survives a crash: the bytes reach the disk before the name points at them. A file that was
// only renamed into place can still come back empty, or as zeros, after a power cut or a killed virtual machine, because
// the system wrote the new name before the data. So the data is synced first, then renamed, then the folder that holds
// the name is synced. A plugin imports this as it does `client.ts`; nothing here holds state or talks to Pi.
import { randomBytes } from "node:crypto";
import { closeSync, fchmodSync, fsyncSync, openSync, renameSync, unlinkSync, writeSync } from "node:fs";
import path from "node:path";

/** Error codes a folder sync may give on a file system or platform that cannot sync a folder. They are ignored. */
const NO_FOLDER_SYNC: ReadonlySet<string> = new Set(["EINVAL", "ENOTSUP", "EOPNOTSUPP", "EISDIR", "EPERM", "EACCES"]);

/**
 * Creates a new file with `data` and syncs it to disk before closing it. Fails with `EEXIST` when the file exists, so a
 * caller can pick another name instead of overwriting something. The mode is set on the open file, whatever the umask.
 */
export function createFileDurably(file: string, data: string | Uint8Array, mode = 0o600): void {
    const bytes = typeof data === "string" ? Buffer.from(data, "utf8") : data;
    const fd = openSync(file, "wx", mode);
    try {
        fchmodSync(fd, mode);
        let written = 0;
        while (written < bytes.length) written += writeSync(fd, bytes, written, bytes.length - written);
        fsyncSync(fd);
    } finally {
        closeSync(fd);
    }
}

/**
 * Replaces a file whole: the data goes to a new temporary file beside it, which is synced, renamed over the file, and
 * then the folder is synced. A reader, or a crash, sees the old text or the new, never a cut one. The temporary file is
 * removed when anything before the rename fails.
 */
export function replaceFileDurably(file: string, data: string | Uint8Array, mode = 0o600): void {
    const temp = `${file}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`;
    try {
        createFileDurably(temp, data, mode);
        renameSync(temp, file);
    } catch (error) {
        try {
            unlinkSync(temp);
        } catch {
            // Never made, or already renamed.
        }
        throw error;
    }
    syncFolder(path.dirname(file));
}

/**
 * Syncs a folder, so a name just created or renamed in it survives a crash. Best effort: a file system or platform that
 * cannot sync a folder (`EINVAL` and the like) is ignored; any other failure is thrown.
 */
export function syncFolder(dir: string): void {
    let fd: number;
    try {
        fd = openSync(dir, "r");
    } catch (error) {
        if (NO_FOLDER_SYNC.has(String((error as NodeJS.ErrnoException).code))) return;
        throw error;
    }
    try {
        fsyncSync(fd);
    } catch (error) {
        if (!NO_FOLDER_SYNC.has(String((error as NodeJS.ErrnoException).code))) throw error;
    } finally {
        closeSync(fd);
    }
}
