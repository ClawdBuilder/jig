// The first `jig setup` on a machine with no home: check Pi, make the home, install Jig into it, write the `jig` shim, say
// whether that folder is on PATH, and offer to copy the old Jig folder's settings. It moves and deletes nothing: the old
// folder stays where it is, and a file in the shim's place that is not Jig's is left alone.
import { spawn } from "node:child_process";
import { chmodSync, cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { currentPiRequirement, jigPackage, meetsMinimum, npmInstall } from "../pi-version.ts";
import { HOME_FOLDER, homeCommand, homeVersion } from "./home.ts";
import { findPi, piArgv } from "./pi-command.ts";
import type { PiProgram } from "./pi-command.ts";

/** The marker line that says a file is the shim `jig setup` writes, and never a file the person had there. */
export const SHIM_MARKER = "# jig-shim: written by jig setup";
const SHIM_NAME = "jig";
const OLD_HOME = path.join(".pi", "jig-agent");
const SETTINGS_FILE = "jig.json";

export interface BootstrapUi {
    notify(text: string, level: "info" | "warning" | "error"): void;
    confirm(title: string, message: string): Promise<boolean>;
}

/** `yes` answers the offers with their safe default, which is "copy jig.json" but never a credential file. */
export type Migrate = "ask" | "yes" | "no";

export interface BootstrapOptions {
    home: string;
    /** The source `pi install` takes. Default: this version on npm; a test names a tarball. */
    source?: string;
    /** Where the `jig` command goes. Default: the person's `~/.local/bin`. */
    binDir?: string;
    migrate: Migrate;
    /** The old folder to offer a copy from, when the default one has no jig.json. */
    from?: string;
    ui: BootstrapUi;
    env?: NodeJS.ProcessEnv;
}

export interface BootstrapResult {
    /** The folder the `jig` command went to, when it was this run that made one. */
    shim?: string;
    /** What `pi install` was given, when this run installed Jig. */
    installed?: string;
    /** The Jig version the home holds after this run, when it could be read. */
    version?: string;
    /** The old folder whose `jig.json` was copied, when one was. */
    copied?: string;
    /** Anything that stops the run, in the words the person sees. */
    problems: string[];
}

/** The user's own home folder, where `~/.local/bin` is. Not the Jig home. */
function personHome(env: NodeJS.ProcessEnv): string {
    return env.HOME?.trim() || homedir();
}

/** The shim: a shell script that runs the home's own `bin/jig.mjs`, following `JIG_HOME` at run time. */
export function shimText(home: string, homeFolder: string): string {
    const fallback =
        home === path.join(homeFolder, HOME_FOLDER) ? `$HOME/${HOME_FOLDER}` : home.replace(/(["\\$`])/g, "\\$1");
    return `#!/bin/sh
${SHIM_MARKER}
# The Jig home's command; safe to delete. JIG_HOME moves the home.
home="\${JIG_HOME:-${fallback}}"
exec node "$home/npm/node_modules/@clawdbuilder/jig/bin/jig.mjs" "$@"
`;
}

/** Whether the file is the shim this writes, and not somebody else's `jig`. */
export function isShim(file: string): boolean {
    try {
        return readFileSync(file, "utf8").includes(SHIM_MARKER);
    } catch {
        return false;
    }
}

function onPath(binDir: string, env: NodeJS.ProcessEnv): boolean {
    const wanted = path.resolve(binDir);
    return (env.PATH ?? "")
        .split(path.delimiter)
        .filter(Boolean)
        .some((folder) => path.resolve(folder) === wanted);
}

/** Where `pi install` says it put the package, checked once after it succeeds. */
function installedProblem(home: string): string | undefined {
    return homeCommand(home) === undefined
        ? `Pi install did not put Jig in ${home}; run: pi install ${npmInstall(jigPackage().name, jigPackage().version)}`
        : undefined;
}

/** Runs `pi install <source>` in the home and resolves with its exit code. */
function piInstall(pi: PiProgram, source: string, home: string, env: NodeJS.ProcessEnv): Promise<number> {
    return new Promise((resolve) => {
        const { command, args } = piArgv(pi, ["install", source]);
        const child = spawn(command, args, {
            cwd: home,
            env: { ...env, PI_CODING_AGENT_DIR: home },
            stdio: ["ignore", "inherit", "inherit"],
        });
        child.on("error", (error) => {
            process.stderr.write(`Could not start Pi: ${error.message}\n`);
            resolve(1);
        });
        child.on("close", (code) => resolve(code ?? 1));
    });
}

/** Asks one offer. `yes` is a blanket yes for jig.json and a no for a credential file, which needs its own yes. */
async function offered(question: string, copy: boolean, options: BootstrapOptions): Promise<boolean> {
    if (copy) return true;
    if (options.migrate !== "ask") return false;
    return options.ui.confirm(question, "Nothing is moved or deleted: the old folder stays where it is.");
}

/** Copies the old folder's jig.json, and its auth.json and sessions only on a separate yes. */
async function migration(home: string, options: BootstrapOptions): Promise<{ copied?: string; said: string[] }> {
    const env = options.env ?? process.env;
    const oldFolder = options.from === undefined ? path.join(personHome(env), OLD_HOME) : options.from;
    const oldJig = path.join(oldFolder, "jig.json");
    const said: string[] = [];
    if (path.resolve(oldFolder) === path.resolve(home) || !existsSync(oldJig)) return { said };
    if (existsSync(path.join(home, SETTINGS_FILE))) {
        return { said: [`${home} already has its own jig.json, so the old one was not copied.`] };
    }
    options.ui.notify(
        `An older Jig folder is at ${oldFolder}. Its settings can be copied into the home; it is not moved.`,
        "info",
    );
    if (!(await offered(`Copy ${SETTINGS_FILE} into the home?`, options.migrate === "yes", options))) {
        said.push(
            `Left the old folder alone. To copy its settings, run jig setup again in a terminal, or with --from.`,
        );
        return { said };
    }
    mkdirSync(home, { recursive: true });
    writeFileSync(path.join(home, SETTINGS_FILE), readFileSync(oldJig, "utf8"));
    said.push(`Copied ${oldJig} to ${path.join(home, SETTINGS_FILE)}.`);
    for (const name of ["auth.json", "sessions"]) {
        const from = path.join(oldFolder, name);
        if (!existsSync(from)) continue;
        if (!(await offered(`Copy ${name} into the home too?`, false, options))) continue;
        const to = path.join(home, name);
        if (existsSync(to)) continue;
        copyInto(from, to);
        said.push(`Copied ${from} to ${to}.`);
    }
    return { copied: oldFolder, said };
}

/** A copy, never a move: the old folder keeps everything it had. */
function copyInto(from: string, to: string): void {
    cpSync(from, to, { recursive: true, errorOnExist: true, force: false });
}

/**
 * The bootstrap steps. On an existing home it only repairs the `jig` command and says where it is: the rest is today's
 * setup. Returns what it did and any problem that stops the run.
 */
export async function bootstrap(options: BootstrapOptions): Promise<BootstrapResult> {
    const env = options.env ?? process.env;
    const { home } = options;
    const result: BootstrapResult = { problems: [] };
    const existing = homeCommand(home) !== undefined;
    if (!existing) {
        const pi = findPi(env);
        const required = currentPiRequirement();
        if (pi === undefined) {
            result.problems.push(
                `Jig needs Pi, and Pi is not installed. Install it with: npm install -g ${"@earendil-works/pi-coding-agent"}`,
            );
            return result;
        }
        if (!meetsMinimum(pi.version, required.minimum)) {
            result.problems.push(
                `Jig needs Pi ${required.minimum} or later; this is ${pi.version ?? "an unknown version"}. Install it with: npm install -g @earendil-works/pi-coding-agent`,
            );
            return result;
        }
        mkdirSync(home, { recursive: true });
        const pkg = jigPackage();
        const source = options.source ?? npmInstall(pkg.name, pkg.version);
        options.ui.notify(`Installing Jig (${source}) into ${home}…`, "info");
        const code = await piInstall(pi, source, home, env);
        if (code !== 0) {
            result.problems.push(`pi install exited ${code}; Jig was not installed in ${home}.`);
            return result;
        }
        const problem = installedProblem(home);
        if (problem !== undefined) {
            result.problems.push(problem);
            return result;
        }
        result.installed = source;
    }
    result.version = homeVersion(home);
    const binDir = options.binDir ?? path.join(personHome(env), ".local", "bin");
    const shim = path.join(binDir, SHIM_NAME);
    const expected = shimText(home, personHome(env));
    if (existsSync(shim) && !isShim(shim)) {
        result.problems.push(
            `There is a file at ${shim} that is not the Jig command, so it was left alone. Move it, or run jig setup --bin <folder>.`,
        );
        return result;
    }
    mkdirSync(binDir, { recursive: true });
    if (!existsSync(shim) || readFileSync(shim, "utf8") !== expected) {
        writeFileSync(shim, expected, { mode: 0o755 });
        chmodSync(shim, 0o755);
        options.ui.notify(`Wrote the jig command to ${shim}.`, "info");
        result.shim = shim;
    }
    if (onPath(binDir, env)) {
        options.ui.notify(`jig is on your PATH: ${shim}.`, "info");
    } else {
        options.ui.notify(
            `${binDir} is not on your PATH. Add this line to your shell's startup file:\nexport PATH="${binDir}:$PATH"`,
            "warning",
        );
    }
    if (!existing) {
        const found = await migration(home, options);
        result.copied = found.copied;
        for (const line of found.said) options.ui.notify(line, "info");
    }
    return result;
}
