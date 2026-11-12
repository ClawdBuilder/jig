// Finding the Pi that `jig` runs. It is the same rule bin/pi uses, so a shim called `pi` that runs the launcher is skipped:
// the first `pi` on PATH whose real path is inside Pi's own package. `JIG_PI_HOST` (or `PI_HOST_DIR`) names the package
// instead, which is how a test installs a fake Pi without touching the machine's.
import { existsSync, realpathSync } from "node:fs";
import path from "node:path";
import { manifestOf } from "./packages.ts";

export const PI_PACKAGE = "@earendil-works/pi-coding-agent";

export interface PiProgram {
    /** Pi's package folder: its version, and where its type declarations are. */
    host: string;
    /** The program to start, and any words before the arguments. */
    command: string;
    prefix: string[];
    version?: string;
}

function real(file: string): string | undefined {
    try {
        return realpathSync(file);
    } catch {
        return undefined;
    }
}

/** A folder is Pi's package when its package.json names it. */
function isPiPackage(folder: string): boolean {
    return manifestOf(folder)?.name === PI_PACKAGE;
}

/** Whether a program resolves into a Pi package, walking up from it as the launcher does. */
function piPackageOf(program: string): string | undefined {
    const resolved = real(program);
    if (resolved === undefined) return undefined;
    let folder = path.dirname(resolved);
    for (let level = 0; level < 8; level++) {
        if (isPiPackage(folder)) return folder;
        const parent = path.dirname(folder);
        if (parent === folder) break;
        folder = parent;
    }
    return undefined;
}

function pathLookup(program: string, env: NodeJS.ProcessEnv): string | undefined {
    const extensions = process.platform === "win32" ? (env.PATHEXT ?? ".EXE;.CMD;.BAT;.COM").split(";") : [""];
    for (const folder of (env.PATH ?? "").split(path.delimiter).filter(Boolean)) {
        for (const extension of extensions) {
            const candidate = path.join(folder, program + extension);
            if (existsSync(candidate)) return candidate;
        }
    }
    return undefined;
}

/** The program inside a Pi package: the `pi` on PATH that resolves into it, else its own bundled CLI. */
function programIn(host: string, env: NodeJS.ProcessEnv): { command: string; prefix: string[] } | undefined {
    const wanted = real(host);
    const candidate = pathLookup("pi", env);
    const found = candidate === undefined ? undefined : piPackageOf(candidate);
    if (candidate !== undefined && found !== undefined && real(found) === wanted) {
        return { command: candidate, prefix: [] };
    }
    const cli = path.join(host, "dist", "bundle", "cli.js");
    if (existsSync(cli)) return { command: process.execPath, prefix: [cli] };
    return undefined;
}

/** The Pi this command runs, or undefined when Pi is not installed. */
export function findPi(env: NodeJS.ProcessEnv = process.env): PiProgram | undefined {
    const named = env.JIG_PI_HOST ?? env.PI_HOST_DIR;
    const fromPath = (() => {
        const candidate = pathLookup("pi", env);
        return candidate === undefined ? undefined : piPackageOf(candidate);
    })();
    const global = path.join(path.dirname(process.execPath), "..", "lib", "node_modules", ...PI_PACKAGE.split("/"));
    const host =
        named !== undefined && isPiPackage(named) ? named : (fromPath ?? (isPiPackage(global) ? global : undefined));
    if (host === undefined) return undefined;
    const program = programIn(host, env);
    if (program === undefined) return undefined;
    const version = manifestOf(host)?.version;
    return { host, ...program, ...(version === undefined ? {} : { version }) };
}

/** The words to start that Pi with. */
export function piArgv(program: PiProgram, args: readonly string[]): { command: string; args: string[] } {
    return { command: program.command, args: [...program.prefix, ...args] };
}
