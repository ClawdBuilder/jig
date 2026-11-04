// The versions `/jig doctor` reports: Pi's, Jig's own, and the Node.js version the package says it needs. Pi has no API
// for its version, so it is read from the package.json of the package Pi loaded, found from the module's own URL.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PI_PACKAGE = "@earendil-works/pi-coding-agent";
/** Where the loop stops: a package folder is a few levels above its `dist/index.js`. */
const MAX_LEVELS = 8;

/** Pi's version, or undefined when the package cannot be found (a bundled build, say). */
export function piVersion(): string | undefined {
    try {
        let dir = path.dirname(fileURLToPath(import.meta.resolve(PI_PACKAGE)));
        for (let level = 0; level < MAX_LEVELS; level++) {
            const found = readPackage(path.join(dir, "package.json"));
            if (found?.name === PI_PACKAGE && typeof found.version === "string") return found.version;
            const parent = path.dirname(dir);
            if (parent === dir) break;
            dir = parent;
        }
    } catch {
        // No package.json, no resolution, or a runtime without import.meta.resolve: the doctor says "unknown".
    }
    return undefined;
}

/** Jig's version, the Node.js range its package.json requires, and where its repository is. Empty when it cannot be
 *  read. `file` is for a test; the default is this checkout's own package.json. */
export function jigPackage(file: string | URL = new URL("../../../package.json", import.meta.url)): {
    version?: string;
    node?: string;
    repository?: string;
} {
    const found = readPackage(file);
    const node = typeof found?.engines?.node === "string" ? found.engines.node : undefined;
    const repository = repositoryOf(found?.repository);
    return {
        ...(typeof found?.version === "string" ? { version: found.version } : {}),
        ...(node ? { node } : {}),
        ...(repository === undefined ? {} : { repository }),
    };
}

/** Where `pi install git:` should fetch Jig from, from its `repository` field: `host/path`, without a scheme or `.git`.
 *  Undefined when the field is missing or is not a location this can read, so a fork can correct it in one place. */
export function installLocation(repository: string | undefined): string | undefined {
    if (repository === undefined) return undefined;
    const trimmed = repository.trim().replace(/^git\+/, "");
    if (trimmed === "") return undefined;
    const shorthand = /^(github|gitlab|bitbucket):(.+)$/i.exec(trimmed);
    if (shorthand !== null) {
        const host =
            shorthand[1]?.toLowerCase() === "github"
                ? "github.com"
                : shorthand[1]?.toLowerCase() === "gitlab"
                  ? "gitlab.com"
                  : "bitbucket.org";
        return cleanLocation(`${host}/${shorthand[2]}`);
    }
    if (!trimmed.includes("://")) {
        const scp = /^(?:[^@/]+@)?([^:/]+):(.+)$/.exec(trimmed);
        if (scp !== null) return cleanLocation(`${scp[1]}/${scp[2]}`);
        if (/^[A-Za-z0-9.-]+\.[A-Za-z]{2,}\/.+/.test(trimmed)) return cleanLocation(trimmed);
        return undefined;
    }
    try {
        const url = new URL(trimmed);
        if (url.hostname === "" || url.pathname === "" || url.pathname === "/") return undefined;
        return cleanLocation(`${url.hostname}/${url.pathname.replace(/^\/+/, "")}`);
    } catch {
        return undefined;
    }
}

/** The one command that reinstalls Jig, or plain words when the package does not say where its repository is. */
export function reinstallFix(repository: string | undefined): string {
    const location = installLocation(repository);
    return location === undefined
        ? "Reinstall Jig the way you installed it."
        : `Reinstall Jig: pi install git:${location}`;
}

function cleanLocation(location: string): string {
    return location
        .replace(/\.git$/i, "")
        .replace(/\/+$/, "")
        .replace(/^\/+/, "");
}

function repositoryOf(value: unknown): string | undefined {
    if (typeof value === "string") return value;
    if (typeof value === "object" && value !== null && "url" in value) {
        const url = (value as { url?: unknown }).url;
        if (typeof url === "string") return url;
    }
    return undefined;
}

/** A version from an `engines` range such as `>=22.19.0` or `^22.19.0`: the first number group, or undefined. */
export function minimumVersion(range: string | undefined): string | undefined {
    const match = /(\d+)(?:\.(\d+))?(?:\.(\d+))?/.exec(range ?? "");
    return match === null ? undefined : [match[1], match[2] ?? "0", match[3] ?? "0"].join(".");
}

/** Compares two `x.y.z` versions: negative when `a` is lower, 0 when equal, positive when higher. */
export function compareVersions(a: string, b: string): number {
    const left = a
        .split(/[.+-]/)
        .slice(0, 3)
        .map((part) => Number.parseInt(part, 10) || 0);
    const right = b
        .split(/[.+-]/)
        .slice(0, 3)
        .map((part) => Number.parseInt(part, 10) || 0);
    for (let index = 0; index < 3; index++) {
        const difference = (left[index] ?? 0) - (right[index] ?? 0);
        if (difference !== 0) return difference;
    }
    return 0;
}

/** Whether `version` is at least `minimum`. A version that cannot be read counts as not meeting it. */
export function meetsMinimum(version: string | undefined, minimum: string): boolean {
    return version !== undefined && /^\d/.test(version) && compareVersions(version, minimum) >= 0;
}

interface PackageJson {
    name?: unknown;
    version?: unknown;
    engines?: { node?: unknown };
    repository?: unknown;
}

function readPackage(file: string | URL): PackageJson | undefined {
    try {
        const value: unknown = JSON.parse(readFileSync(file, "utf8"));
        return typeof value === "object" && value !== null ? (value as PackageJson) : undefined;
    } catch {
        return undefined;
    }
}
