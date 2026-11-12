// `jig update`: move the packages in the Jig home through Pi's own update, and never the Pi binary, which the person's own
// `pi` and other Jig homes share. Jig's entry is pinned by setup, so `jig update --self` reads npm and installs the newest
// release with `pi install`; every other form is Pi's `pi update` with the home as PI_CODING_AGENT_DIR. `--check` says what
// would happen and changes nothing, and a release that needs a newer Pi stops the run before anything else moves.
import { spawn } from "node:child_process";
import { accessSync, constants, readFileSync } from "node:fs";
import path from "node:path";
import { errorMessage } from "../errors.ts";
import { compareVersions, currentPiRequirement, jigPackage, meetsMinimum, npmInstall } from "../pi-version.ts";
import { companyRanges } from "../update-company.ts";
import { selectTarget } from "../update-versions.ts";
import type { RegistryMetadata, RegistryRelease } from "../update-versions.ts";
import { helpFor, strayWordsMessage } from "./help.ts";
import { homeCommand, homeVersion, jigHome } from "./home.ts";
import { findPi } from "./pi-command.ts";
import type { PiProgram } from "./pi-command.ts";
import { parseNpmSource, readPackages } from "./packages.ts";

const MAX_OUTPUT = 512 * 1024;
const PI_REFSUSAL = `Jig never updates Pi itself (your pi and others share it). Run: pi update --self`;

/** One form of the command, before anything runs. */
type Form =
    | { kind: "all" }
    | { kind: "self" }
    | { kind: "extensions" }
    | { kind: "models" }
    | { kind: "source"; source: string };

export interface UpdateOptions {
    /** The home. Default: `JIG_HOME`, else `~/.jig`. */
    home?: string;
    /** Pi's package folder. Default: found on PATH. */
    pi?: PiProgram;
    env?: NodeJS.ProcessEnv;
    /** For a test: the prompt's answer. */
    ask?: (question: string) => Promise<boolean>;
}

interface CommandResult {
    code: number;
    stdout: string;
    stderr: string;
}

function run(
    command: string,
    args: readonly string[],
    options: { cwd: string; env: NodeJS.ProcessEnv },
): Promise<CommandResult> {
    return new Promise((resolve) => {
        const child = spawn(command, [...args], {
            cwd: options.cwd,
            env: options.env,
            stdio: ["ignore", "pipe", "pipe"],
        });
        let stdout = "";
        let stderr = "";
        child.stdout.on("data", (chunk: Buffer) => {
            if (stdout.length < MAX_OUTPUT) stdout += chunk.toString();
        });
        child.stderr.on("data", (chunk: Buffer) => {
            if (stderr.length < MAX_OUTPUT) stderr += chunk.toString();
        });
        child.on("error", (error) => resolve({ code: 1, stdout, stderr: error.message }));
        child.on("close", (code) => resolve({ code: code ?? 1, stdout, stderr }));
    });
}

function outputOf(result: CommandResult): string {
    return (result.stdout || result.stderr).trim();
}

function writable(target: string): boolean {
    try {
        accessSync(target, constants.W_OK);
        return true;
    } catch {
        return false;
    }
}

/** Whether a word is a package source Pi could install or update, rather than a stray word of a message. */
export function looksLikeSource(word: string): boolean {
    const trimmed = word.trim();
    if (/^(npm|git):/.test(trimmed)) return trimmed.length > 4;
    if (/^(https?|ssh|git):\/\//i.test(trimmed)) return true;
    if (/^[A-Za-z0-9.-]+\.[A-Za-z]{2,}\/.+/.test(trimmed)) return true;
    return /^(\.{0,2}\/|~\/)/.test(trimmed) || trimmed.endsWith(".tgz");
}

/** The published versions, asked of npm itself so its registry scope, auth and .npmrc rules apply. */
async function fetchRegistry(name: string, cwd: string, env: NodeJS.ProcessEnv): Promise<RegistryMetadata> {
    const result = await run("npm", ["view", name, "versions", "--json"], { cwd, env });
    if (result.code !== 0) throw new Error(npmViewProblem(name, result.stdout, result.stderr));
    if (result.stdout.trim() === "") throw new Error(`npm view returned no versions for ${name}; is it published?`);
    let parsed: unknown;
    try {
        parsed = JSON.parse(result.stdout);
    } catch {
        throw new Error(`npm view returned something that is not JSON for ${name}.`);
    }
    if (typeof parsed === "object" && parsed !== null && "error" in parsed) {
        throw new Error(npmViewProblem(name, result.stdout, result.stderr));
    }
    const list = Array.isArray(parsed) ? parsed : typeof parsed === "string" ? [parsed] : [];
    return { versions: Object.fromEntries(list.filter((v): v is string => typeof v === "string").map((v) => [v, {}])) };
}

/** A missing package or a registry error from npm, without showing its raw JSON to the person. */
function npmViewProblem(name: string, stdout: string, stderr: string): string {
    const text = `${stdout}\n${stderr}`.trim();
    try {
        const parsed = JSON.parse(stdout) as { error?: { code?: unknown; summary?: unknown; detail?: unknown } };
        const error = parsed.error;
        const detail = [error?.code, error?.summary, error?.detail]
            .filter((part) => typeof part === "string")
            .join(": ");
        if (detail !== "") return `npm view could not read ${name}: ${detail}`;
    } catch {
        // Not npm's JSON error; use the text below.
    }
    return `npm view could not read ${name}: ${text.slice(0, 300) || "no output"}`;
}

/** One release's package.json fields, again from npm view. */
async function fetchRelease(
    name: string,
    version: string,
    cwd: string,
    env: NodeJS.ProcessEnv,
): Promise<RegistryRelease> {
    const result = await run("npm", ["view", `${name}@${version}`, "jig", "version", "deprecated", "--json"], {
        cwd,
        env,
    });
    if (result.code !== 0) throw new Error(npmViewProblem(name, result.stdout, result.stderr));
    if (result.stdout.trim() === "") throw new Error(`npm view returned no metadata for ${name}@${version}.`);
    let parsed: unknown;
    try {
        parsed = JSON.parse(result.stdout);
    } catch {
        throw new Error(`npm view returned something that is not JSON for ${name}@${version}.`);
    }
    const value = Array.isArray(parsed) ? parsed[0] : parsed;
    if (typeof value === "object" && value !== null && "error" in value) {
        throw new Error(npmViewProblem(name, result.stdout, result.stderr));
    }
    return (value ?? {}) as RegistryRelease;
}

/** The Pi pair a release states, or undefined when it is missing or malformed. */
function piPair(
    release: RegistryRelease | { jig?: { agents?: { pi?: { minimum?: string; tested?: string } } } },
): { minimum: string; tested: string } | undefined {
    const pi = release.jig?.agents?.pi;
    if (typeof pi?.minimum !== "string" || typeof pi?.tested !== "string") return undefined;
    if (!/^\d+\.\d+\.\d+$/.test(pi.minimum) || !/^\d+\.\d+\.\d+$/.test(pi.tested)) return undefined;
    if (compareVersions(pi.tested, pi.minimum) < 0) return undefined;
    return { minimum: pi.minimum, tested: pi.tested };
}

async function promptYes(question: string): Promise<boolean> {
    const { createInterface } = await import("node:readline/promises");
    const readline = createInterface({ input: process.stdin, output: process.stderr, terminal: false });
    try {
        const answer = (await readline.question(`${question} [y/N] `)).trim().toLowerCase();
        return answer === "y" || answer === "yes";
    } finally {
        process.stderr.write("\n");
        readline.close();
    }
}

/** Whether a check should say the running Jig is already the newest it may use. */
export function upToDate(current: string, target: string, requested: string | undefined): boolean {
    return requested === undefined && compareVersions(target, current) <= 0;
}

/** The Pi commands a form runs, in order, as a person would type them after `pi `. */
export function piCommands(form: Form, name: string, approve: string[], target: string | undefined): string[][] {
    const tail = approve.length === 0 ? [] : [approve[0] as string];
    if (form.kind === "models") return [["update", "--models", ...tail]];
    if (form.kind === "extensions") return [["update", "--extensions", ...tail]];
    if (form.kind === "all") {
        if (target === undefined) return [["update", "--extensions", ...tail]];
        return [
            ["install", npmInstall(name, target), ...tail],
            ["update", "--extensions", ...tail],
        ];
    }
    if (form.kind === "self") {
        return target === undefined ? [] : [["install", npmInstall(name, target), ...tail]];
    }
    if (isJigSource(form.source, name)) {
        return target === undefined ? [] : [["install", npmInstall(name, target), ...tail]];
    }
    return [["update", "--extension", form.source, ...tail]];
}

/** Parses the words, or returns the message to print and exit 2 with. */
export function parse(
    args: readonly string[],
):
    | { form: Form; approve: string[]; check: boolean; json: boolean; yes: boolean; requested?: string }
    | { problem: string } {
    let form: Form | undefined;
    let approve: string[] = [];
    let check = false;
    let json = false;
    let yes = false;
    let requested: string | undefined;
    const usage = "\nRun jig update --help for usage.";
    const setForm = (next: Form): { problem: string } | undefined => {
        if (form !== undefined) {
            return {
                problem: `jig update takes one target at a time: name one of --all, --self, --extensions, --models or a package.${usage}`,
            };
        }
        form = next;
        return undefined;
    };
    for (let index = 0; index < args.length; index++) {
        const word = args[index] as string;
        if (word === "--check") check = true;
        else if (word === "--json") json = true;
        else if (word === "--yes" || word === "-y") yes = true;
        else if (word === "--all") {
            const problem = setForm({ kind: "all" });
            if (problem !== undefined) return problem;
        } else if (word === "--self") {
            const problem = setForm({ kind: "self" });
            if (problem !== undefined) return problem;
        } else if (word === "--extensions") {
            const problem = setForm({ kind: "extensions" });
            if (problem !== undefined) return problem;
        } else if (word === "--models") {
            const problem = setForm({ kind: "models" });
            if (problem !== undefined) return problem;
        } else if (word === "--extension") {
            const value = args[++index];
            if (value === undefined || value.startsWith("-")) {
                return { problem: `jig update: --extension needs a package source.${usage}` };
            }
            const problem = setForm({ kind: "source", source: value });
            if (problem !== undefined) return problem;
        } else if (word === "--to") {
            const value = args[++index];
            if (value === undefined || value.startsWith("-")) {
                return { problem: `jig update: --to needs a version.${usage}` };
            }
            requested = value;
        } else if (word === "--approve" || word === "-a") {
            approve = ["--approve"];
        } else if (word === "--no-approve" || word === "-na") {
            approve = ["--no-approve"];
        } else if (word === "--force" || word === "pi") {
            return { problem: PI_REFSUSAL };
        } else if (word === "self") {
            const problem = setForm({ kind: "self" });
            if (problem !== undefined) return problem;
        } else if (word.startsWith("-")) {
            return { problem: `jig update: unknown option ${word}.${usage}` };
        } else if (looksLikeSource(word)) {
            const problem = setForm({ kind: "source", source: word });
            if (problem !== undefined) return problem;
        } else {
            return { problem: strayWordsMessage("update", args, word) };
        }
    }
    return {
        form: form ?? { kind: "all" },
        approve,
        check,
        json,
        yes,
        ...(requested === undefined ? {} : { requested }),
    };
}

/** The `jig update` command. Returns the process exit code. */
export async function update(args: readonly string[], options: UpdateOptions = {}): Promise<number> {
    if (args.includes("--help") || args.includes("-h")) {
        process.stdout.write(`${helpFor("update")}\n`);
        return 0;
    }
    const parsed = parse(args);
    if ("problem" in parsed) {
        process.stderr.write(`${parsed.problem}\n`);
        return 2;
    }
    const { form, approve, check, json, yes, requested } = parsed;
    const env = options.env ?? process.env;
    const home = options.home ?? jigHome(env);
    const cwd = process.cwd();
    const nonTTY = process.stdin.isTTY !== true || process.stdout.isTTY !== true;
    const assumeYes = yes || (env.CI === "true" && nonTTY);
    if (json && !check && !assumeYes && nonTTY) {
        process.stderr.write("jig update --json needs --check (a plan) or --yes (a result).\n");
        return 2;
    }
    if (!check && nonTTY && !assumeYes) {
        process.stderr.write(
            "jig update: no terminal to confirm on. Run `jig update --check` to see the plan, or `jig update --yes` to apply it.\n",
        );
        return 2;
    }
    const pi = options.pi ?? findPi(env);
    if (pi === undefined) {
        process.stderr.write("jig update needs Pi installed; install Pi first.\n");
        return 1;
    }
    const own = jigPackage();
    const name = own.name ?? "@clawdbuilder/jig";
    const installed = homeVersion(home, name);
    if (homeCommand(home, name) === undefined || installed === undefined) {
        process.stderr.write(`Jig is not installed in ${home}. Run: npx ${name} setup\n`);
        return 1;
    }
    const touchesJig =
        form.kind === "all" || form.kind === "self" || (form.kind === "source" && isJigSource(form.source, name));
    let target: string | undefined;
    let requirement: { minimum: string; tested: string } | undefined;
    if (touchesJig) {
        let metadata: RegistryMetadata;
        try {
            metadata = await fetchRegistry(name, cwd, env);
        } catch (error) {
            process.stderr.write(
                `jig update could not read ${name} from npm: ${errorMessage(error)}. Nothing was changed.\n`,
            );
            return 1;
        }
        const listed = readPackages(home, cwd).listed;
        const chosen = selectTarget(metadata, companyRanges(listed, name), requested ?? versionOfSource(form));
        if ("problem" in chosen) {
            process.stderr.write(`${chosen.problem} Nothing was changed.\n`);
            return 1;
        }
        target = chosen.target.version;
        try {
            chosen.target.release = await fetchRelease(name, target, cwd, env);
        } catch (error) {
            process.stderr.write(
                `jig update could not read Jig ${target} from npm: ${errorMessage(error)}. Nothing was changed.\n`,
            );
            return 1;
        }
        requirement = piPair(chosen.target.release) ?? currentPiRequirement();
        if (upToDate(installed, target, requested ?? versionOfSource(form))) {
            target = undefined;
        } else if (!meetsMinimum(pi.version, requirement.minimum)) {
            process.stderr.write(
                `Jig ${target} needs Pi ${requirement.minimum} or later; this is ${pi.version ?? "an unknown version"}.\n${PI_REFSUSAL}\nNothing was changed.\n`,
            );
            return 1;
        }
    }
    const commands = piCommands(form, name, approve, target);
    if (check) {
        if (json) {
            process.stdout.write(
                `${JSON.stringify(
                    {
                        schema: 1,
                        home,
                        current: installed,
                        target: target ?? installed,
                        action: target === undefined && touchesJig ? "up-to-date" : "update",
                        commands: commands.map((one) => `pi ${one.join(" ")}`),
                        code: 0,
                    },
                    null,
                    2,
                )}\n`,
            );
            return 0;
        }
        if (touchesJig) {
            process.stdout.write(
                target === undefined
                    ? `Jig ${installed} is up to date.\n`
                    : `Jig ${installed} -> ${target} in ${home}.\n`,
            );
        }
        for (const one of commands) process.stdout.write(`Runs in ${home}: pi ${one.join(" ")}\n`);
        process.stdout.write("No changes were made.\n");
        return 0;
    }
    if (commands.length === 0) {
        process.stdout.write(`Nothing to do: Jig ${installed} is up to date.\n`);
        return 0;
    }
    if (!assumeYes) {
        const question = `Update the packages in ${home}?`;
        const answer = options.ask === undefined ? await promptYes(question) : await options.ask(question);
        if (!answer) {
            process.stdout.write("Nothing was changed.\n");
            return 0;
        }
    }
    if (!writable(home)) {
        process.stderr.write(`Jig cannot write ${home}. Nothing was changed.\n`);
        return 1;
    }
    for (const one of commands) {
        process.stdout.write(`pi ${one.join(" ")}\n`);
        const result = await run(pi.command, [...pi.prefix, ...one], {
            cwd,
            env: { ...env, PI_CODING_AGENT_DIR: home },
        });
        const shown = outputOf(result);
        if (shown !== "") process.stdout.write(`${shown}\n`);
        if (result.code !== 0) {
            process.stderr.write(`pi ${one[0]} exited ${result.code} in ${home}; the update stopped there.\n`);
            return 1;
        }
    }
    // After moving Jig: the version now in the home is the one that says which Pi it needs. Jig never installs or moves Pi.
    if (target !== undefined) {
        const needs = installedRequirement(home, name) ?? currentPiRequirement();
        if (!meetsMinimum(pi.version, needs.minimum)) {
            process.stderr.write(
                `Jig is now ${homeVersion(home, name) ?? target} in ${home}, and it needs Pi ${needs.minimum} or later; this is ${pi.version ?? "an unknown version"}.\n${PI_REFSUSAL}\n`,
            );
            return 1;
        }
    }
    process.stdout.write(`Updated the packages in ${home}.\n`);
    return 0;
}

/** The Pi requirement of the Jig now installed in the home, read from its own manifest. */
export function installedRequirement(home: string, name: string): { minimum: string; tested: string } | undefined {
    try {
        const manifest = JSON.parse(
            readFileSync(path.join(home, "npm", "node_modules", ...name.split("/"), "package.json"), "utf8"),
        ) as { jig?: { agents?: { pi?: { minimum?: string; tested?: string } } } };
        return piPair(manifest);
    } catch {
        return undefined;
    }
}

function isJigSource(source: string, name: string): boolean {
    return parseNpmSource(source)?.name === name;
}

/** The version a source pins, for `jig update npm:@clawdbuilder/jig@0.6.0`. */
function versionOfSource(form: Form): string | undefined {
    if (form.kind !== "source") return undefined;
    const match = /^npm:(?:@[^/]+\/)?[^@]+@(.+)$/.exec(form.source.trim());
    return match?.[1];
}
