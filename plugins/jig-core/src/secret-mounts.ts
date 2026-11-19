// Whether a file lives on a Windows drive where the mode means nothing, seen from WSL. Linux reports every file there as
// readable by everyone, and chmod changes nothing: Windows's own access rules decide who can read it. The secret probe uses
// this to leave out the mode warning for such a file. A drive mounted with the `metadata` option (WSL's
// `automount.options`) keeps Linux permissions and chmod works, so it is an ordinary file system here. The answer comes
// from the kernel's mount table (/proc/mounts), and only when that table is not there from the /mnt/<letter>/ prefix on a
// WSL kernel.
import { readFileSync, realpathSync } from "node:fs";
import { release as kernelRelease } from "node:os";

/** What the check reads, which a test gives instead: the mount table's text and the kernel's release. */
export interface MountFacts {
    mounts?: string;
    release?: string;
}

/** How a file was found to be on a Windows drive without a mode. */
export type DriveEvidence = "mount table" | "path prefix";

/** The mount table's text, or undefined when this system has none (not Linux, or `/proc` is not mounted). */
function readMounts(): string | undefined {
    try {
        return readFileSync("/proc/mounts", "utf8");
    } catch {
        return undefined;
    }
}

/** A mount point as the kernel writes it: a space, a tab, a newline and a backslash are octal (`\040`, `\134`). */
function unescapeMount(text: string): string {
    return text.replace(/\\([0-7]{3})/g, (_all, octal: string) => String.fromCharCode(Number.parseInt(octal, 8)));
}

/** Whether a mount is a Windows drive whose files carry no Linux mode: WSL 1's `drvfs`, or WSL 2's `9p` with `aname=drvfs`
 *  (other 9p mounts are not), unless it is mounted with `metadata`, which keeps the mode and lets chmod work. */
function isDrive(type: string, options: string): boolean {
    const drive = type === "drvfs" || (type === "9p" && /(?:^|[,;])aname=drvfs(?:[,;]|$)/.test(options));
    return drive && !/(?:^|[,;])metadata(?:[,;=]|$)/.test(options);
}

/** The type and options of the mount that holds `file`: the one with the longest mount point that is a parent of it. */
function mountHolding(file: string, table: string): { type: string; options: string } | undefined {
    let best: { at: number; type: string; options: string } | undefined;
    for (const line of table.split("\n")) {
        const [, point, type, options] = line.split(" ");
        if (point === undefined || type === undefined || options === undefined) continue;
        const where = unescapeMount(point);
        const holds = where === "/" || file === where || file.startsWith(`${where}/`);
        if (holds && (best === undefined || where.length >= best.at)) best = { at: where.length, type, options };
    }
    return best;
}

/** The place a path really is: through links, so a link into a drive is found there. A path that is not there stays as written. */
function placeOf(file: string): string {
    try {
        return realpathSync(file);
    } catch {
        return file;
    }
}

/**
 * Whether `file` is on a Windows drive, and how that was found. A mount table that lists the file's mount is the answer. With
 * no table, a `/mnt/<letter>/...` path on a WSL kernel is taken for one, because WSL mounts every drive there. Off WSL
 * nothing is a Windows drive.
 */
export function windowsDrive(file: string, facts: MountFacts = {}): DriveEvidence | undefined {
    const place = placeOf(file);
    const table = facts.mounts ?? readMounts();
    if (table !== undefined && table.trim() !== "") {
        const mount = mountHolding(place, table);
        return mount !== undefined && isDrive(mount.type, mount.options) ? "mount table" : undefined;
    }
    const wsl = /microsoft|wsl/i.test(facts.release ?? kernelRelease());
    return wsl && /^\/mnt\/[a-z]\/./.test(place) ? "path prefix" : undefined;
}
