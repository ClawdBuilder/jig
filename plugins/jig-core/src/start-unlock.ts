// Unlocking the secret store when a session starts, so a passphrase prompt does not interrupt a task later.
//
// `secrets.pass.unlockAtStart` asks for it. jig-core finds one entry of the pass store and has `pass` decrypt it. If the
// store is locked, gpg-agent shows its own prompt (often a desktop dialog); jig-core never asks for the passphrase, never
// sees it and never keeps it, and drops what the entry held at once. Once the agent has the key, the lookups tools make
// later are silent. Lookups through `pass` run one after another, so a tool that asks meanwhile waits for this one
// instead of raising a second prompt.
import type { Dirent } from "node:fs";
import { readdir } from "node:fs/promises";
import path from "node:path";
import { isPassEntry, SecretError } from "./secrets.ts";
import type { Secrets } from "./secrets.ts";

/** A decryption that took this long had a person in the loop: the store was locked, and a prompt was answered. */
export const PROMPT_AFTER_MS = 1500;
/** The most folders read to find an entry. A store is small, and the first folder usually has one. */
const MAX_FOLDERS = 200;

export const UNLOCKED = "secret store unlocked";
export const STILL_LOCKED = "secret store still locked; a tool that needs it will ask again";

/**
 * One entry of the store that a lookup accepts, or undefined for a store that is missing, unreadable or empty. The
 * shallowest wins (the top folder is the one the store's main key covers), the first in name order. Only real files and
 * folders count: a link could lead out of the store. Names that start with a dot (`.git`, `.gpg-id`) are not entries.
 */
export async function findPassEntry(storeDir: string): Promise<string | undefined> {
    const queue = [""];
    for (let read = 0; read < MAX_FOLDERS && queue.length > 0; read++) {
        const folder = queue.shift() as string;
        let found: Dirent[];
        try {
            found = await readdir(path.join(storeDir, folder), { withFileTypes: true });
        } catch {
            continue;
        }
        found.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
        for (const item of found) {
            if (item.name.startsWith(".")) continue;
            const relative = folder === "" ? item.name : `${folder}/${item.name}`;
            if (item.isDirectory()) queue.push(relative);
            else if (item.isFile() && item.name.endsWith(".gpg") && isPassEntry(relative.slice(0, -".gpg".length)))
                return relative.slice(0, -".gpg".length);
        }
    }
    return undefined;
}

export interface UnlockJob {
    secrets: Pick<Secrets, "passStoreDir" | "unlockPass">;
    /** Tells the user. Never the model, and never anything that came out of the store. */
    notify(message: string, level: "info" | "warning"): void;
    now(): number;
    /** Aborted when the session ends. */
    signal: AbortSignal;
}

/**
 * Gets the store unlocked, and says only what the user can use:
 *   - nothing when it was already unlocked (the entry opened at once), or when there is no entry to open;
 *   - "secret store unlocked" after a prompt that was answered;
 *   - "secret store still locked ..." when `pass` reported that it is locked (a cancelled prompt, or no way to show one).
 * Any other failure, such as `pass` not being installed, is left for the tool that needs the store to report. Never throws.
 */
export async function unlockStoreAtStart(job: UnlockJob): Promise<void> {
    try {
        const entry = await findPassEntry(job.secrets.passStoreDir());
        if (entry === undefined || job.signal.aborted) return;
        const began = job.now();
        try {
            await job.secrets.unlockPass(entry, job.signal);
        } catch (error) {
            if (error instanceof SecretError && error.code === "locked" && !job.signal.aborted)
                job.notify(STILL_LOCKED, "warning");
            return;
        }
        if (job.now() - began >= PROMPT_AFTER_MS && !job.signal.aborted) job.notify(UNLOCKED, "info");
    } catch {
        // A session start must never fail on this.
    }
}
