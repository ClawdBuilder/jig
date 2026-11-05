// The programs the sandbox runtime needs, found on PATH or named in `sandbox.programs`. On Linux that is bubblewrap
// (the sandbox itself), socat (the runtime's bridge to its proxy, used by every network mode) and ripgrep (which the
// runtime uses to look for files it must protect). macOS has its sandbox built in. This lives in the kit so the command's
// doctor reads the same rules the sandbox uses, instead of a copy that could drift.
import { accessSync, constants, realpathSync, statSync } from "node:fs";
import path from "node:path";

export type ProgramName = "bwrap" | "socat" | "ripgrep";

export interface ProgramPaths {
    bwrap?: string;
    socat?: string;
    ripgrep?: string;
}

export interface FoundPrograms {
    /** Absolute paths of the programs that were found. */
    found: Partial<Record<ProgramName, string>>;
    /** What is missing, as the doctor says it. */
    missing: Array<{ name: ProgramName; command: string }>;
}

const COMMAND: Record<ProgramName, string> = { bwrap: "bwrap", socat: "socat", ripgrep: "rg" };
const PACKAGE: Record<ProgramName, string> = { bwrap: "bubblewrap", socat: "socat", ripgrep: "ripgrep" };

function isExecutable(file: string): boolean {
    try {
        if (!statSync(file).isFile()) return false;
        accessSync(file, constants.X_OK);
        return true;
    } catch {
        return false;
    }
}

/** An absolute path for a program name from the folders of `pathValue`, or undefined. */
export function onPath(
    command: string,
    pathValue: string | undefined,
    writable: (place: string) => boolean = () => false,
): string | undefined {
    for (const folder of (pathValue ?? "").split(path.delimiter)) {
        if (!path.isAbsolute(folder)) continue;
        const candidate = path.join(folder, command);
        if (!isExecutable(candidate)) continue;
        // The host runs these programs outside the sandbox: one found where a command in the sandbox can write could
        // have been planted there, so it is passed over (a project's own `bin` folder on PATH, say).
        let real: string;
        try {
            real = realpathSync(candidate);
        } catch {
            continue;
        }
        if (writable(candidate) || writable(real)) continue;
        return candidate;
    }
    return undefined;
}

/** The programs the platform needs: the configured path when there is one, else PATH. */
export function findPrograms(
    platform: "linux" | "darwin",
    configured: ProgramPaths,
    pathValue: string | undefined,
    writable: (place: string) => boolean = () => false,
): FoundPrograms {
    const found: FoundPrograms["found"] = {};
    const missing: FoundPrograms["missing"] = [];
    if (platform !== "linux") return { found, missing };
    for (const name of ["bwrap", "socat", "ripgrep"] as const) {
        const given = configured[name];
        const real =
            given !== undefined
                ? isExecutable(given)
                    ? given
                    : undefined
                : onPath(COMMAND[name], pathValue, writable);
        if (real === undefined) missing.push({ name, command: given ?? COMMAND[name] });
        else found[name] = real;
    }
    return { found, missing };
}

export type Distro = "apt" | "dnf" | "pacman" | "zypper";

/** The distro family to name in an install command, from /etc/os-release; apt when nothing says otherwise. */
export function distroOf(osRelease: string): Distro {
    const id = /^ID=(.*)$/m.exec(osRelease)?.[1]?.replace(/^"|"$/g, "").toLowerCase() ?? "";
    const like = /^ID_LIKE=(.*)$/m.exec(osRelease)?.[1]?.replace(/^"|"$/g, "").toLowerCase() ?? "";
    const names = `${id} ${like}`;
    if (/\b(fedora|rhel|centos|rocky|almalinux)\b/.test(names)) return "dnf";
    if (/\b(arch|manjaro)\b/.test(names)) return "pacman";
    if (/\b(opensuse|suse|sles)\b/.test(names)) return "zypper";
    return "apt";
}

/** The command that installs what is missing, for a message. */
export function installCommand(
    platform: "linux" | "darwin",
    missing: ReadonlyArray<{ name: ProgramName }>,
    distro: Distro = "apt",
): string {
    if (platform === "darwin") return "the sandbox is part of macOS; nothing to install";
    const packages = missing.length === 0 ? Object.values(PACKAGE) : missing.map((item) => PACKAGE[item.name]);
    const list = packages.join(" ");
    switch (distro) {
        case "dnf":
            return `sudo dnf install ${list}`;
        case "pacman":
            return `sudo pacman -S ${list}`;
        case "zypper":
            return `sudo zypper install ${list}`;
        default:
            return `sudo apt install ${list}`;
    }
}

/** The command that lifts Ubuntu 24.04's AppArmor restriction on user namespaces, when it is set. */
export const APPARMOR_SYSCTL = "sudo sysctl -w kernel.apparmor_restrict_unprivileged_userns=0";
