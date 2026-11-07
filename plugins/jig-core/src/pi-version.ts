// The versions `/jig doctor` reports: Pi's, Jig's own, and the Node.js version the package says it needs. Pi has no API
// for its version, so it is read from the package.json of the package Pi loaded, found from the module's own URL.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PI_PACKAGE = "@earendil-works/pi-coding-agent";
/** Where the loop stops: a package folder is a few levels above its `dist/index.js`. */
const MAX_LEVELS = 8;

/** The package.json of the module this one resolves, walking up to `PI_PACKAGE`'s folder. */
function versionFrom(resolved: string): string | undefined {
    let dir = path.dirname(resolved);
    for (let level = 0; level < MAX_LEVELS; level++) {
        const found = readPackage(path.join(dir, "package.json"));
        if (found?.name === PI_PACKAGE && typeof found.version === "string") return found.version;
        const parent = path.dirname(dir);
        if (parent === dir) break;
        dir = parent;
    }
    return undefined;
}

/** Pi's version. Resolved from the extension's own module first; then from the program Pi runs, which works when Jig is
 *  installed as a package beside nothing (a global Pi, a bundled build): the launcher sits inside Pi's own package. */
export function piVersion(): string | undefined {
    try {
        const found = versionFrom(fileURLToPath(import.meta.resolve(PI_PACKAGE)));
        if (found !== undefined) return found;
    } catch {
        // Fall through to the program's own folder.
    }
    try {
        const launcher = process.argv[1];
        if (launcher !== undefined && launcher !== "") {
            // The launcher sits inside Pi's package in a bundled or global install. Walk up from it first: Pi's
            // package has `exports` but no root export, so `require.resolve(PI_PACKAGE)` fails there.
            const fromLauncher = versionFrom(path.resolve(launcher));
            if (fromLauncher !== undefined) return fromLauncher;
            const require = createRequire(path.join(path.dirname(path.resolve(launcher)), "probe.js"));
            const found = versionFrom(require.resolve(PI_PACKAGE));
            if (found !== undefined) return found;
        }
    } catch {
        // No launcher, or it is not inside Pi: the version stays unknown.
    }
    return undefined;
}

/** Jig's version, the Node.js range its package.json requires, and where its repository is. Empty when it cannot be
 *  read. `file` is for a test; the default is this checkout's own package.json. */
export function jigPackage(file: string | URL = new URL("../../../package.json", import.meta.url)): {
    name?: string;
    version?: string;
    node?: string;
    repository?: string;
} {
    const found = readPackage(file);
    const node = typeof found?.engines?.node === "string" ? found.engines.node : undefined;
    const repository = repositoryOf(found?.repository);
    return {
        ...(typeof found?.name === "string" ? { name: found.name } : {}),
        ...(typeof found?.version === "string" ? { version: found.version } : {}),
        ...(node ? { node } : {}),
        ...(repository === undefined ? {} : { repository }),
    };
}

/** The agent versions a Jig release states: the oldest Pi it runs with, and the one it is tested with. */
export interface PiRequirement {
    minimum: string;
    tested: string;
}

/** The Pi requirement a release states in `jig.agents.pi`, or undefined when the package does not say. */
export function piRequirement(
    file: string | URL = new URL("../../../package.json", import.meta.url),
): PiRequirement | undefined {
    const found = readPackage(file);
    const agents = found?.jig?.agents;
    const pi = agents?.pi;
    if (typeof pi?.minimum !== "string" || typeof pi?.tested !== "string") return undefined;
    if (!/^\d+\.\d+\.\d+$/.test(pi.minimum) || !/^\d+\.\d+\.\d+$/.test(pi.tested)) return undefined;
    return { minimum: pi.minimum, tested: pi.tested };
}

/** The requirement this Jig runs with; a package that does not state one is treated as the old floor. */
export function currentPiRequirement(file?: string | URL): PiRequirement {
    return piRequirement(file) ?? { minimum: "1.4.0", tested: "1.5.0" };
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
/** The npm spec a person installs Jig from: the package's own name, as npm and Pi take it. */
export function npmInstall(name: string | undefined, version?: string): string {
    const packageName = name === undefined || name === "" ? "@clawdbuilder/jig" : name;
    return `npm:${packageName}${version === undefined || version === "" ? "" : `@${version}`}`;
}

export function reinstallFix(repository: string | undefined): string {
    const location = installLocation(repository);
    return location === undefined
        ? "Reinstall Jig the way you installed it."
        : `Reinstall Jig: pi install npm:${npmPackageName()}`;
}

function npmPackageName(): string {
    return jigPackage().name ?? "@clawdbuilder/jig";
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
    jig?: { agents?: { pi?: { minimum?: unknown; tested?: unknown } } };
}

function readPackage(file: string | URL): PackageJson | undefined {
    try {
        const value: unknown = JSON.parse(readFileSync(file, "utf8"));
        return typeof value === "object" && value !== null ? (value as PackageJson) : undefined;
    } catch {
        return undefined;
    }
}
