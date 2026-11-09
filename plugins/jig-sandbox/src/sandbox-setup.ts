// What the sandbox is set up with before any command runs: the session's private folders (and the removal of those a crash left behind),
// and the base configuration given to the runtime. Both are plain functions of what they are given, so they are apart from the class
// that holds the session's state.
import { execFileSync } from "node:child_process";
import { chmodSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { NetworkMode } from "./config.ts";
import type { FoundPrograms } from "./programs.ts";
import type { SandboxDeps } from "./sandbox-types.ts";

const OWNER_FILE = "owner";

/** A process's start time: with the pid it names one process for good, so a reused pid is not the owner. */
function startToken(pid: number): string | undefined {
    try {
        const text = readFileSync(`/proc/${pid}/stat`, "utf8");
        const close = text.lastIndexOf(")");
        if (close >= 0) return text.slice(close + 2).split(" ")[19];
    } catch {
        // Not Linux or WSL: ask ps below.
    }
    try {
        const text = execFileSync("ps", ["-o", "lstart=", "-p", String(pid)], { encoding: "utf8" }).trim();
        return text === "" ? undefined : text;
    } catch {
        return undefined;
    }
}

function writeOwner(folder: string): void {
    const token = startToken(process.pid);
    if (token !== undefined) writeFileSync(path.join(folder, OWNER_FILE), `${process.pid} ${token}\n`, { mode: 0o600 });
}

function ownerAlive(folder: string): boolean {
    let pid: number;
    let token: string;
    try {
        const [rawPid, ...rest] = readFileSync(path.join(folder, OWNER_FILE), "utf8").trim().split(" ");
        pid = Number(rawPid);
        token = rest.join(" ");
    } catch {
        // A folder with no owner record cannot be proved dead, so it is not removed.
        return true;
    }
    if (!Number.isInteger(pid) || pid <= 1 || token === "") return true;
    try {
        process.kill(pid, 0);
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EPERM") return false;
    }
    return startToken(pid) === token;
}

/** Makes the session's private folders and returns the session folder: `broker/` for the broker, `tmp/` for the commands. */
export function makeSessionFolders(
    deps: Pick<SandboxDeps, "tmpRoot" | "uid" | "files" | "now">,
    sessionId: string,
): string {
    const root = path.join(deps.tmpRoot, `jig-sandbox-${deps.uid}`);
    mkdirSync(root, { recursive: true, mode: 0o700 });
    chmodSync(root, 0o700);
    removeStaleSessions(deps, root);
    const short = sessionId.replace(/[^A-Za-z0-9]/g, "").slice(0, 8) || "session";
    const folder = mkdtempSync(path.join(root, `${short}-`));
    return ensureSessionFolders(folder, deps);
}

/** Recreates a session folder that went missing, and records its owner. Safe to call on a folder that exists. */
export function ensureSessionFolders(folder: string, deps?: Pick<SandboxDeps, "files">): string {
    const root = path.dirname(folder);
    mkdirSync(root, { recursive: true, mode: 0o700 });
    const rootInfo = lstatSync(root);
    const uid = process.getuid?.();
    if (
        !rootInfo.isDirectory() ||
        rootInfo.isSymbolicLink() ||
        (uid !== undefined && rootInfo.uid !== uid) ||
        (rootInfo.mode & 0o077) !== 0
    ) {
        throw new Error(`refusing to use ${root}: it is not a private folder owned by this user`);
    }
    mkdirSync(folder, { recursive: true, mode: 0o700 });
    chmodSync(folder, 0o700);
    for (const name of ["broker", "tmp"]) {
        const child = path.join(folder, name);
        mkdirSync(child, { recursive: true, mode: 0o700 });
        chmodSync(child, 0o700);
    }
    writeOwner(folder);
    return deps?.files.real(folder) ?? folder;
}

/**
 * Session folders a crash left behind. Age is not evidence: a session can be open for days without touching its folder.
 * A folder goes only when its owner record names a process that is gone (or a pid that now belongs to another process);
 * a folder with no owner record is left alone, because it cannot be proved dead.
 */
function removeStaleSessions(deps: Pick<SandboxDeps, "files">, root: string): void {
    for (const name of deps.files.list(root)) {
        const folder = path.join(root, name);
        try {
            if (ownerAlive(folder)) continue;
            rmSync(folder, { recursive: true, force: true });
        } catch {
            // Not ours to worry about.
        }
    }
}

/** The runtime's configuration for the whole session. The file-system rules come with each command. */
export function runtimeConfig(
    mode: NetworkMode,
    found: FoundPrograms["found"],
    removedNames: readonly string[],
): Record<string, unknown> {
    return {
        // Network `open` is the absence of an allow list: the runtime then leaves the network alone. `off` is an empty one
        // that nothing may widen. `filtered` and `ask` are an empty one that nothing widens either, except through the
        // callback, which asks this plugin about each host (see `network/policy.ts`): the allow and deny lists are read
        // there, and not given to the runtime, since a list entry the runtime decides is not checked for a private address.
        network:
            mode === "off"
                ? { allowedDomains: [], deniedDomains: [], strictAllowlist: true }
                : mode === "open"
                  ? { deniedDomains: [] }
                  : { allowedDomains: [], deniedDomains: [] },
        filesystem: { denyRead: [], allowWrite: [], denyWrite: [], allowGitConfig: true },
        // The environment is cleaned before the command starts; the runtime removes the same names a second time.
        credentials: { envVars: removedNames.map((name) => ({ name, mode: "deny" })) },
        ...(found.bwrap === undefined ? {} : { bwrapPath: found.bwrap }),
        ...(found.socat === undefined ? {} : { socatPath: found.socat }),
        ...(found.ripgrep === undefined ? {} : { ripgrep: { command: found.ripgrep } }),
        // The runtime looks for dangerous files near the folder it runs in, the session's, which holds none.
        mandatoryDenySearchDepth: 1,
    };
}
