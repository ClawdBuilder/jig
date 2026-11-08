// `jig update`: move the global `jig` command and Pi's Jig copy to one published version, with Pi only when the release
// needs it. It reads the registry first, refuses before changing anything it cannot finish, and puts every recorded version
// back when a step fails. `--check` says what it would do and changes nothing.
import { spawn } from "node:child_process";
import { accessSync, constants, existsSync, lstatSync, readFileSync, realpathSync } from "node:fs";

import path from "node:path";
import { pathToFileURL } from "node:url";
import { errorMessage } from "../errors.ts";
import { jigPackage, piVersion } from "../pi-version.ts";

import { compareVersions } from "../pi-version.ts";
import { selectTarget } from "../update-versions.ts";
import { companyRanges } from "../update-company.ts";
import type { CompanyRange, RegistryMetadata, RegistryRelease } from "../update-versions.ts";
import type { JigEntry } from "./packages.ts";
import { describePlan, planUpdate, statedRequirement } from "../update-plan.ts";
import type { UpdateCopy } from "../update-plan.ts";
import { executeUpdate } from "../update-run.ts";
import type { CommandResult, InstallCommand, UpdateIo } from "../update-run.ts";
import { agentDirFor, ownPackage } from "./headless.ts";
import { globalNpmRoot, manifestOf, packageFolder, parseGitSource, parseNpmSource, readPackages } from "./packages.ts";

const PI = "@earendil-works/pi-coding-agent";
const MAX_OUTPUT = 512 * 1024;

export interface PiConfigModule {
    detectInstallMethod(): string;
    getSelfUpdateCommand(
        packageName: string,
        npmCommand?: string[],
        target?: string | { packageName: string; installSpec?: string },
    ):
        | {
              command: string;
              args: string[];
              display: string;
              steps?: Array<{ command: string; args: string[]; display: string }>;
          }
        | undefined;
    getConfiguredSelfUpdateArgv(setting: string[] | undefined): string[] | undefined;
    makeConfiguredSelfUpdateCommand(
        argv: string[],
        release: { packageName: string; version: string },
    ): { command: string; args: string[]; display: string };
    getSelfUpdateUnavailableInstruction(
        packageName: string,
        npmCommand?: string[],
        target?: string | { packageName: string; installSpec?: string },
    ): string;
}

function run(command: string, args: readonly string[], cwd: string, signal?: AbortSignal): Promise<CommandResult> {
    return new Promise((resolve) => {
        const child = spawn(command, [...args], {
            cwd,
            env: process.env,
            stdio: ["ignore", "pipe", "pipe"],
        });
        const stop = (): void => {
            child.kill("SIGTERM");
        };
        signal?.addEventListener("abort", stop, { once: true });
        let stdout = "";
        let stderr = "";
        let timedOut = false;
        const timer = setTimeout(() => {
            timedOut = true;
            child.kill("SIGTERM");
        }, 180_000);
        child.stdout.on("data", (chunk: Buffer) => {
            if (stdout.length < MAX_OUTPUT) stdout += chunk.toString();
        });
        child.stderr.on("data", (chunk: Buffer) => {
            if (stderr.length < MAX_OUTPUT) stderr += chunk.toString();
        });
        child.on("error", (error) => {
            clearTimeout(timer);
            signal?.removeEventListener("abort", stop);
            resolve({ code: 1, stdout, stderr: error.message, ...(timedOut ? { timedOut } : {}) });
        });
        child.on("close", (code) => {
            clearTimeout(timer);
            signal?.removeEventListener("abort", stop);
            resolve({ code: code ?? 1, stdout, stderr, ...(timedOut ? { timedOut } : {}) });
        });
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

/** Pi's config module, loaded from the package `bin/jig` found. It is not an exported subpath, so this uses its file. */
async function piConfig(host: string): Promise<PiConfigModule> {
    return (await import(pathToFileURL(path.join(host, "dist", "config.js")).href)) as PiConfigModule;
}

/** The Pi version a package folder holds, or undefined. */
function versionAt(folder: string | undefined): string | undefined {
    return folder === undefined ? undefined : manifestOf(folder)?.version;
}

export function piSelfUpdateCommands(
    config: PiConfigModule,
    settings: { selfUpdateCommand?: string[] },
    version: string,
): InstallCommand[] | { problem: string } {
    if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) {
        return {
            problem: `Pi ${JSON.stringify(version)} is not a version jig update can install. Nothing was changed.`,
        };
    }
    const method = config.detectInstallMethod();
    const fromEnv = process.env.PI_SELF_UPDATE_COMMAND?.trim();
    const configured = config.getConfiguredSelfUpdateArgv(settings.selfUpdateCommand);
    if (configured !== undefined) {
        const text = fromEnv !== undefined && fromEnv !== "" ? fromEnv : configured.join(" ");
        if (!/\{(version|installSpec)\}/.test(text)) {
            return {
                problem:
                    "Pi's self-update command is configured without {version} or {installSpec}, so jig update cannot pin the tested Pi. Nothing was changed.",
            };
        }
        const command = config.makeConfiguredSelfUpdateCommand(configured, { packageName: PI, version });
        return [{ command: command.command, args: [...command.args], display: command.display }];
    }
    const command = config.getSelfUpdateCommand(PI, undefined, {
        packageName: PI,
        installSpec: `${PI}@${version}`,
    });
    if (command === undefined) {
        return {
            problem: `Pi was installed by ${method}. ${config.getSelfUpdateUnavailableInstruction(PI, undefined, {
                packageName: PI,
                installSpec: `${PI}@${version}`,
            })} Nothing was changed.`,
        };
    }
    const steps = command.steps ?? [command];
    return steps.map((step) => ({ command: step.command, args: [...step.args], display: step.display }));
}

/** The path to a package inside the global npm root, for a scoped name too. */
/** A package folder is linked when its own real path is not the expected one under the real root. A symlinked
 *  parent (an nvm prefix, for example) is not a linked package. */
export function linkedPackageFolder(root: string, folder: string, name: string): boolean {
    try {
        if (lstatSync(folder).isSymbolicLink()) return true;
        const expected = path.join(realpathSync(root), ...name.split("/"));
        return realpathSync(folder) !== expected;
    } catch {
        return false;
    }
}

/** A global command that is linked or a development checkout is not replaced. */
async function linkedGlobal(name: string, root: string, folder: string, cwd: string): Promise<boolean> {
    if (linkedPackageFolder(root, folder, name)) return true;
    const listed = await run("npm", ["ls", "-g", name, "--json"], cwd);
    if (listed.code !== 0) return false;
    try {
        const parsed = JSON.parse(listed.stdout) as {
            dependencies?: Record<string, { link?: unknown }>;
        };
        return parsed.dependencies?.[name]?.link === true;
    } catch {
        return false;
    }
}

function globalFolder(root: string, name: string): string {
    return path.join(root, ...name.split("/"));
}

/** npm's global prefix: `<prefix>/lib/node_modules` on Unix, `<prefix>/node_modules` on Windows. */
function npmPrefix(root: string): string {
    if (path.basename(root) !== "node_modules") return path.dirname(root);
    const parent = path.dirname(root);
    return path.basename(parent) === "lib" ? path.dirname(parent) : parent;
}

/** Reads the packages once and finds Jig's Pi copy and every company range. */
export function discover(
    agentDir: string,
    cwd: string,
    name: string,
): {
    piCopy?: UpdateCopy;
    company: CompanyRange[];
    problem?: string;
    jigEntries: JigEntry[];
    listed: ReturnType<typeof readPackages>["listed"];
} {
    const listed = readPackages(agentDir, cwd, { globalRoot: () => globalNpmRoot() }).listed;
    const jigEntries: JigEntry[] = [];
    const looksLikeJig = (source: string): boolean => {
        const npm = parseNpmSource(source)?.name;
        if (npm === name) return true;
        const git = parseGitSource(source);
        return git !== undefined && git.host === "github.com" && git.path.toLowerCase() === "clawdbuilder/jig";
    };
    let piCopy: UpdateCopy | undefined;
    for (const entry of listed) {
        const manifest = entry.folder === undefined ? undefined : manifestOf(entry.folder);
        const packageName = manifest?.name ?? parseNpmSource(entry.source)?.name;
        if (packageName !== name && !looksLikeJig(entry.source)) continue;
        jigEntries.push({
            source: entry.source,
            scope: entry.scope,
            ...(manifest?.version === undefined ? {} : { version: manifest.version }),
        });
        if (packageName === name && (piCopy === undefined || entry.scope === "user")) {
            piCopy = {
                ...(manifest?.version === undefined ? {} : { version: manifest.version }),
                source: entry.source,
                scope: entry.scope,
                ...(entry.folder === undefined ? {} : { folder: entry.folder }),
            };
        }
    }
    if (jigEntries.length > 1) {
        const lines = jigEntries.map(
            (entry) =>
                `${entry.scope}: ${entry.source}${entry.version === undefined ? "" : ` (${entry.version})`} — pi remove ${entry.source}${entry.scope === "project" ? " -l" : ""}`,
        );
        return {
            problem: `Pi lists ${jigEntries.length} Jig entries. jig update will not choose which to keep; remove all but one first:\n${lines.join("\n")}`,
            jigEntries,
            company: companyRanges(listed, name),
            listed,
        };
    }
    return {
        ...(piCopy === undefined ? {} : { piCopy }),
        company: companyRanges(listed, name),
        jigEntries,
        listed,
    };
}

function piSetting(agentDir: string): { selfUpdateCommand?: string[] } {
    try {
        const value = JSON.parse(readFileSync(path.join(agentDir, "settings.json"), "utf8")) as {
            selfUpdateCommand?: unknown;
        };
        return Array.isArray(value.selfUpdateCommand) &&
            value.selfUpdateCommand.every((item) => typeof item === "string")
            ? { selfUpdateCommand: value.selfUpdateCommand as string[] }
            : {};
    } catch {
        return {};
    }
}

/** The published versions, asked of npm itself so its registry scope, auth and .npmrc rules apply. */
async function fetchRegistry(name: string, cwd: string): Promise<RegistryMetadata> {
    const result = await run("npm", ["view", name, "versions", "--json"], cwd);
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
async function fetchRelease(name: string, version: string, cwd: string): Promise<RegistryRelease> {
    const result = await run("npm", ["view", `${name}@${version}`, "jig", "version", "deprecated", "--json"], cwd);
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

function usage(): string {
    return `Usage: jig update [--check] [--to <version>]\n\njig update moves both copies of Jig (Pi's and the global command) to one published version.\n--check  say what would happen, and change nothing.`;
}

/** The `jig update` command. Returns the process exit code; `host` is Pi's package folder. */
/** Whether a check should say the running Jig is already the newest it may use. */
export function upToDate(current: string, target: string, requested: string | undefined): boolean {
    return requested === undefined && compareVersions(target, current) <= 0;
}

export async function update(args: readonly string[], host: string | undefined): Promise<number> {
    let check = false;
    let requested: string | undefined;
    for (let index = 0; index < args.length; index++) {
        const word = args[index];
        if (word === "--check") check = true;
        else if (word === "--to") {
            const value = args[++index];
            if (value === undefined || value.startsWith("--")) {
                process.stderr.write(`--to needs a version.\n${usage()}\n`);
                return 2;
            }
            requested = value;
        } else {
            process.stderr.write(`Unknown option ${word}\n${usage()}\n`);
            return 2;
        }
    }
    if (!check && (process.stdin.isTTY !== true || process.stdout.isTTY !== true)) {
        process.stderr.write(
            "Update needs a terminal with a screen. Run jig update --check to see what it would do.\n",
        );
        return 1;
    }
    if (host === undefined) {
        process.stderr.write("jig update needs Pi installed; install Pi first.\n");
        return 1;
    }
    const own = ownPackage();
    const name = own.name ?? jigPackage().name ?? "@clawdbuilder/jig";
    const current = own.version ?? jigPackage().version;
    if (current === undefined) {
        process.stderr.write("jig update cannot read Jig's own version. Nothing was changed.\n");
        return 1;
    }
    const env = process.env;
    const agentDir = agentDirFor(env);
    const cwd = process.cwd();
    // PATH lookup without starting anything.
    const lookup = (program: string): string | undefined => {
        const folders = (env.PATH ?? "").split(path.delimiter).filter(Boolean);
        const extensions = process.platform === "win32" ? (env.PATHEXT ?? ".EXE;.CMD;.BAT;.COM").split(";") : [""];
        for (const folder of folders) {
            for (const extension of extensions) {
                const candidate = path.join(folder, program + extension);
                if (existsSync(candidate)) return candidate;
            }
        }
        return undefined;
    };

    const discovered = discover(agentDir, cwd, name);
    if (discovered.problem !== undefined) {
        process.stderr.write(`${discovered.problem}\nNothing was changed.\n`);
        return 1;
    }
    let metadata: RegistryMetadata;
    try {
        metadata = await fetchRegistry(name, cwd);
    } catch (error) {
        process.stderr.write(
            `jig update could not read ${name} from npm: ${errorMessage(error)}. Nothing was changed.\n`,
        );
        return 1;
    }
    const chosen = selectTarget(metadata, discovered.company, requested);
    if ("problem" in chosen) {
        process.stderr.write(`${chosen.problem} Nothing was changed.\n`);
        return 1;
    }
    if (upToDate(current, chosen.target.version, requested)) {
        process.stdout.write(`Jig ${current} is up to date.\n`);
        return 0;
    }
    try {
        chosen.target.release = await fetchRelease(name, chosen.target.version, cwd);
    } catch (error) {
        process.stderr.write(
            `jig update could not read Jig ${chosen.target.version} from npm: ${errorMessage(error)}. Nothing was changed.\n`,
        );
        return 1;
    }
    if (statedRequirement(chosen.target) === undefined) {
        process.stderr.write(
            `Jig ${chosen.target.version} does not say which Pi version it needs. Nothing was changed.\n`,
        );
        return 1;
    }
    const rootResult = await run("npm", ["root", "-g"], cwd);
    if (rootResult.code !== 0 || outputOf(rootResult) === "") {
        process.stderr.write(
            `jig update could not find the global npm folder: ${outputOf(rootResult)}. Nothing was changed.\n`,
        );
        return 1;
    }
    const root = outputOf(rootResult).split("\n")[0] as string;
    const globalCandidate = globalFolder(root, name);
    const globalManifest = manifestOf(globalCandidate);
    if (globalManifest?.name !== name) {
        process.stderr.write(
            `This jig command is not installed in npm's global folder. Install it with: npm install -g --ignore-scripts ${name}@${chosen.target.version}\nNothing was changed.\n`,
        );
        return 1;
    }
    const globalVersion = globalManifest.version ?? current;
    const globalLinked = await linkedGlobal(name, root, globalCandidate, cwd);
    const prefix = npmPrefix(root);
    const built = planUpdate({
        name,
        current,
        target: chosen.target,
        piVersion: piVersion(),
        ...(discovered.piCopy === undefined ? {} : { piCopy: discovered.piCopy }),
        globalVersion,
        globalLinked,
    });
    if ("problem" in built) {
        process.stderr.write(`${built.problem}\n`);
        return 1;
    }
    const plan = built.plan;
    let piTarget: InstallCommand[] | { problem: string } | undefined;
    let piBack: InstallCommand[] | { problem: string } | undefined;
    if (plan.pi !== undefined) {
        let config: PiConfigModule;
        try {
            config = await piConfig(host);
        } catch (error) {
            process.stderr.write(
                `jig update could not read how Pi was installed: ${errorMessage(error)}. Nothing was changed.\n`,
            );
            return 1;
        }
        piTarget = piSelfUpdateCommands(config, piSetting(agentDir), plan.pi.to);
        if ("problem" in piTarget) {
            process.stderr.write(`${piTarget.problem}\n`);
            return 1;
        }
        piBack = piSelfUpdateCommands(config, piSetting(agentDir), plan.pi.from);
        if ("problem" in piBack) {
            process.stderr.write(`${piBack.problem}\n`);
            return 1;
        }
    }
    if (check) {
        for (const line of describePlan(plan)) process.stdout.write(`${line}\n`);
        if (piTarget !== undefined && !("problem" in piTarget)) {
            for (const command of piTarget) process.stdout.write(`Pi installs with: ${command.display}\n`);
        }
        if (plan.piCopy?.needed === true) process.stdout.write(`Pi's copy: pi install npm:${name}@${plan.target}\n`);
        if (plan.global?.needed === true) {
            process.stdout.write(
                `The jig command: npm install -g --ignore-scripts --min-release-age=0 ${name}@${plan.target}\n`,
            );
        }
        process.stdout.write("No changes were made.\n");
        return plan.changes ? 2 : 0;
    }
    if (lookup("npm") === undefined) {
        process.stderr.write("jig update needs npm on PATH to move the global command. Nothing was changed.\n");
        return 1;
    }
    if (lookup("pi") === undefined) {
        process.stderr.write("jig update needs Pi's command on PATH. Nothing was changed.\n");
        return 1;
    }
    if (!writable(existsSync(path.join(agentDir, "settings.json")) ? path.join(agentDir, "settings.json") : agentDir)) {
        process.stderr.write(
            `Jig cannot write ${path.join(agentDir, "settings.json")} because its folder is missing or read-only. Nothing was changed.\n`,
        );
        return 1;
    }
    if (!writable(agentDir)) {
        process.stderr.write(`Jig cannot write its package list in ${agentDir}. Nothing was changed.\n`);
        return 1;
    }
    if (plan.changes) {
        for (const line of describePlan(plan)) process.stdout.write(`${line}\n`);
    }
    const piFolder = discovered.piCopy?.folder;
    const piAfter = (): string | undefined => {
        const folder = packageFolder(`npm:${name}`, agentDir).folder;
        return versionAt(folder) ?? versionAt(piFolder);
    };
    const confirm = async (title: string, message: string, signal?: AbortSignal): Promise<boolean> => {
        if (signal?.aborted === true) return false;
        const { createInterface } = await import("node:readline/promises");
        const readline = createInterface({ input: process.stdin, output: process.stdout });
        let onAbort: (() => void) | undefined;
        const aborted = new Promise<boolean>((resolve) => {
            onAbort = () => {
                readline.close();
                resolve(false);
            };
            signal?.addEventListener("abort", onAbort, { once: true });
        });
        try {
            const question = readline.question(`${title}\n${message}\n(y/N) `);
            return await Promise.race([
                question.then((answer) => answer.trim().toLowerCase() === "y" || answer.trim().toLowerCase() === "yes"),
                aborted,
            ]);
        } finally {
            if (onAbort !== undefined) signal?.removeEventListener("abort", onAbort);
            readline.close();
        }
    };
    const io: UpdateIo = {
        run: (command, commandArgs, signal) => run(command, commandArgs, cwd, signal),
        notify: (text, level) => {
            (level === "error" ? process.stderr : process.stdout).write(`${text}\n`);
        },
        confirm,
        async piInstall(version) {
            const chosenCommand = version === plan.pi?.to ? piTarget : version === plan.pi?.from ? piBack : undefined;
            if (chosenCommand === undefined) return { problem: `Cannot build the command for Pi ${version}.` };
            if ("problem" in chosenCommand) return chosenCommand;
            return chosenCommand;
        },
        piCopyInstall: (version) => ({
            command: "pi",
            args: ["install", `npm:${name}@${version}`],
            display: `pi install npm:${name}@${version}`,
        }),
        piCopyRestore: (version) => ({
            command: "pi",
            args: ["install", `npm:${name}@${version}`],
            display: `pi install npm:${name}@${version}`,
        }),
        globalInstall: (version) => ({
            command: "npm",
            args: [
                "install",
                "-g",
                "--prefix",
                prefix,
                "--ignore-scripts",
                "--min-release-age=0",
                `${name}@${version}`,
            ],
            display: `npm install -g --prefix ${prefix} --ignore-scripts --min-release-age=0 ${name}@${version}`,
        }),
        async verify() {
            return {
                pi: piVersion(),
                piCopy: piAfter(),
                global: versionAt(globalCandidate),
            };
        },
        async doctor() {
            const launcher = process.argv[1];
            const result =
                launcher === undefined
                    ? { code: 1, stdout: "", stderr: "the jig launcher is unknown" }
                    : await run(process.execPath, [launcher, "doctor", "--quiet"], cwd);
            return { code: result.code, output: outputOf(result) };
        },
    };
    const controller = new AbortController();
    const interrupt = (): void => {
        if (!controller.signal.aborted)
            process.stderr.write("Update interrupted; putting the changed versions back.\n");
        controller.abort();
    };
    process.once("SIGINT", interrupt);
    process.once("SIGTERM", interrupt);
    const result = await executeUpdate(plan, io, controller.signal).finally(() => {
        process.removeListener("SIGINT", interrupt);
        process.removeListener("SIGTERM", interrupt);
    });
    return result.code;
}
