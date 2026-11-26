// The "Other agents" group of `/jig doctor`: does Jig's gateway start, which settings folder must another agent's Jig plugin be given, and,
// for Claude Code, is it installed, new enough, and set up with this Jig. Every check only reads. It starts this package's gateway with
// `--version` and asks `claude` for its version and its two plugin lists; it starts no agent session, changes no setting of any agent and
// installs nothing. Programs are started through `options.run` and found through `options.pathLookup`, as the login checks do, so a test
// passes fakes and never starts Claude Code.
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { RunOptions, RunResult } from "./contract.ts";
import type { DoctorContext, DoctorLine, DoctorOptions, RunProgram } from "./doctor.ts";
import { findOnPath } from "./doctor-secrets.ts";
import { run as runProgram } from "./exec.ts";
import { isObject } from "./kit/values.ts";
import { jigPackage, meetsMinimum, packageFile, reinstallFix } from "./pi-version.ts";
import { shorten } from "./secret-status.ts";
import { settingsHome } from "./settings-home.ts";

/** The names the package gives its Claude Code plugin in `.claude-plugin/`. `adapters-claude-code.test.ts` keeps them equal to the files. */
export const CLAUDE_MARKETPLACE = "clawdbuilder";
export const CLAUDE_PLUGIN = "jig";
/** The permission rule that lets Claude Code run Jig's tools without asking: `mcp__plugin_<plugin>_<server>__*`. */
export const CLAUDE_ALLOW_RULE = "mcp__plugin_jig_jig__*";

/** The built gateway, below the package folder. */
const GATEWAY_FILE = "plugins/jig-core/dist/jig-gateway.mjs";
/** Claude Code's version line, `2.1.332 (Claude Code)`: the numbers at the start. */
const CLAUDE_VERSION = /^(\d+\.\d+\.\d+)\b/;
/** How long one program may take, as in the login checks. */
const TIME_LIMIT_MS = 5000;
/** A plugin list is a few hundred bytes for each plugin; this is room for a long one. */
const LIST_BYTES = 256 * 1024;

/** The folder of this package: `packageFile()` is the one place that knows where its package.json is. */
function packageRoot(): string {
    return path.dirname(fileURLToPath(packageFile()));
}

/** The oldest version of an agent this release is made for, from `jig.agents` in package.json. Undefined when it says none. */
function minimumOf(agent: string): string | undefined {
    try {
        const manifest: unknown = JSON.parse(readFileSync(packageFile(), "utf8"));
        const agents = isObject(manifest) && isObject(manifest.jig) ? manifest.jig.agents : undefined;
        const entry = isObject(agents) ? agents[agent] : undefined;
        const minimum = isObject(entry) ? entry.minimum : undefined;
        return typeof minimum === "string" && /^\d+\.\d+\.\d+$/.test(minimum) ? minimum : undefined;
    } catch {
        return undefined;
    }
}

/** A value as one word of a command: bare when it holds only plain characters, else in single quotes. */
function word(value: string): string {
    return /^[\w@%+=:,./-]+$/.test(value) ? value : `'${value.replaceAll("'", "'\\''")}'`;
}

export async function agentChecks(context: DoctorContext, options: DoctorOptions): Promise<DoctorLine[]> {
    const home = options.home ?? homedir();
    const folder = context.configPath === "" ? undefined : path.dirname(context.configPath);
    const lines = [await gatewayLine(options), folderLine(context, home, folder)];
    return [...lines, ...(await claudeLines(context, options, folder))];
}

// ---- the gateway ----------------------------------------------------------------------------------------------------

/** Starts the built gateway with `--version`, as an agent's configuration would start it, and compares what it prints with this package. */
async function gatewayLine(options: DoctorOptions): Promise<DoctorLine> {
    const pkg = jigPackage();
    const gateway = options.gatewayFile ?? path.join(packageRoot(), GATEWAY_FILE);
    const line = { id: "agents.gateway", group: "agents" as const, title: "Jig gateway" };
    const fix = reinstallFix(options.jigRepository ?? pkg.repository);
    const fail = (detail: string): DoctorLine => ({ ...line, level: "fail", detail, fix });
    if (!existsSync(gateway)) return fail("the built gateway is not in this copy of Jig.");
    let result: RunResult;
    try {
        result = await (options.run ?? runProgram)(process.execPath, [gateway, "--version"], {
            timeoutMs: options.timeoutMs ?? TIME_LIMIT_MS,
            maxOutputBytes: 8192,
        });
    } catch {
        return fail("could not be started.");
    }
    if (result.timedOut) return fail("did not answer in time.");
    if (result.code !== 0) return fail(`stopped with exit code ${result.code} when asked for its version.`);
    const said = result.stdout.trim();
    if (pkg.version === undefined) return fail("this package's version could not be read, so it cannot be compared.");
    if (said !== pkg.version) {
        return fail(`said "${said.slice(0, 40)}" when asked for its version, but this package is ${pkg.version}.`);
    }
    return { ...line, level: "ok", detail: `starts, and is version ${said}.` };
}

// ---- the settings folder --------------------------------------------------------------------------------------------

/**
 * The folder of the jig.json this doctor reads is the one another agent's Jig plugin must be given. A gateway started with nothing set
 * looks only in `JIG_HOME` and the default home, so the line also says when that would be another folder, or none.
 */
function folderLine(context: DoctorContext, home: string, folder: string | undefined): DoctorLine {
    const line = { id: "agents.folder", group: "agents" as const, title: "Settings folder for other agents" };
    if (folder === undefined) {
        return { ...line, level: "skip", detail: "not known yet: Jig has not been told where its settings are." };
    }
    const said = `Give another agent's Jig plugin ${shorten(folder, home)}, the folder of the jig.json this doctor reads.`;
    const found = settingsHome([], context.env, home);
    if (found === undefined) {
        return {
            ...line,
            level: "ok",
            detail: `${said} Without it the gateway finds no jig.json and runs on built-in defaults.`,
        };
    }
    if (path.resolve(found.folder) !== path.resolve(folder)) {
        return {
            ...line,
            level: "ok",
            detail: `${said} Without it the gateway reads ${shorten(found.folder, home)} instead.`,
        };
    }
    return { ...line, level: "ok", detail: said };
}

// ---- Claude Code ----------------------------------------------------------------------------------------------------

/** Claude Code: not installed, too old, or installed; and, when it can answer, how Jig's marketplace and plugin stand in it. */
async function claudeLines(
    context: DoctorContext,
    options: DoctorOptions,
    folder: string | undefined,
): Promise<DoctorLine[]> {
    const lookup =
        options.pathLookup ?? ((program: string, env: NodeJS.ProcessEnv) => findOnPath(program, env, options.platform));
    const line = { id: "agents.claude", group: "agents" as const, title: "Claude Code" };
    if (lookup("claude", context.env) === undefined) {
        return [{ ...line, level: "skip", detail: "Claude Code is not installed." }];
    }
    // The program runs with a small environment; the folder Claude Code keeps its settings in must still reach it.
    const configDir = context.env.CLAUDE_CONFIG_DIR;
    const runOptions: RunOptions = {
        timeoutMs: options.timeoutMs ?? TIME_LIMIT_MS,
        maxOutputBytes: LIST_BYTES,
        ...(configDir === undefined || configDir === "" ? {} : { env: { CLAUDE_CONFIG_DIR: configDir } }),
    };
    const run = options.run ?? runProgram;
    const version = await claudeVersion(run, runOptions);
    if (version === undefined) {
        return [{ ...line, level: "skip", detail: "its version could not be read, so Jig's plugin was not checked." }];
    }
    const minimum = minimumOf("claude-code");
    const versionLine: DoctorLine =
        minimum !== undefined && !meetsMinimum(version, minimum)
            ? {
                  ...line,
                  level: "warn",
                  detail: `${version} (Jig's plugin needs ${minimum} or later)`,
                  fix: "Update Claude Code, then run the doctor again.",
              }
            : { ...line, level: "ok", detail: version };
    return [versionLine, await pluginLine(run, runOptions, folder)];
}

/** `claude --version`, as the number; undefined when it did not answer or said something else. */
async function claudeVersion(run: RunProgram, runOptions: RunOptions): Promise<string | undefined> {
    try {
        const result = await run("claude", ["--version"], runOptions);
        if (result.timedOut || result.code !== 0) return undefined;
        return CLAUDE_VERSION.exec(result.stdout.trim())?.[1];
    } catch {
        return undefined;
    }
}

/** What `claude` prints for a command that answers in JSON: a list of objects, or undefined when it is anything else. */
async function claudeList(
    run: RunProgram,
    runOptions: RunOptions,
    args: readonly string[],
): Promise<Array<Record<string, unknown>> | undefined> {
    try {
        const result = await run("claude", args, runOptions);
        if (result.timedOut || result.code !== 0) return undefined;
        const value: unknown = JSON.parse(result.stdout);
        return Array.isArray(value) && value.every(isObject) ? value : undefined;
    } catch {
        return undefined;
    }
}

/** Jig's marketplace and plugin in Claude Code, from its two JSON lists. Every state that is not done names the next command. */
async function pluginLine(run: RunProgram, runOptions: RunOptions, folder: string | undefined): Promise<DoctorLine> {
    const line = { id: "agents.claude.jig", group: "agents" as const, title: "Jig in Claude Code" };
    const unreadable: DoctorLine = {
        ...line,
        level: "skip",
        detail: "Claude Code's answer about its plugins could not be read.",
    };
    const marketplaces = await claudeList(run, runOptions, ["plugin", "marketplace", "list", "--json"]);
    if (marketplaces === undefined) return unreadable;
    if (!marketplaces.some((entry) => entry.name === CLAUDE_MARKETPLACE)) {
        return {
            ...line,
            level: "skip",
            detail: `not set up: Claude Code does not have Jig's marketplace, ${CLAUDE_MARKETPLACE}.`,
            fix: `claude plugin marketplace add ${word(packageRoot())}`,
        };
    }
    const plugins = await claudeList(run, runOptions, ["plugin", "list", "--json"]);
    if (plugins === undefined) return unreadable;
    const id = `${CLAUDE_PLUGIN}@${CLAUDE_MARKETPLACE}`;
    const found = plugins.filter((entry) => entry.id === id);
    const entry = found.find((candidate) => candidate.enabled === true) ?? found[0];
    if (entry === undefined) {
        const config = folder === undefined ? "" : ` --config jig_home=${word(folder)}`;
        return {
            ...line,
            level: "warn",
            detail: `Jig's marketplace is added, but the plugin ${id} is not installed.`,
            fix: `claude plugin install ${id}${config}`,
        };
    }
    if (entry.enabled !== true) {
        return { ...line, level: "warn", detail: "installed, but switched off.", fix: `claude plugin enable ${id}` };
    }
    // `version` is the one Claude Code runs; `folderVersion` is what the folder it reads the plugin from holds now.
    const ours = jigPackage().version;
    const said = [entry.version, entry.folderVersion].filter(
        (value): value is string => typeof value === "string" && value !== "unknown",
    );
    if (ours === undefined || said.length === 0) {
        return { ...line, level: "skip", detail: "Claude Code did not say which version of Jig it runs." };
    }
    const other = said.find((value) => value !== ours);
    if (other !== undefined) {
        return {
            ...line,
            level: "warn",
            detail: `Claude Code runs Jig ${other}, and this package is ${ours}.`,
            fix: `Run claude plugin update ${id}, then restart Claude Code.`,
        };
    }
    return {
        ...line,
        level: "ok",
        detail: `version ${ours}, on. Claude Code asks before each Jig tool unless you allow ${CLAUDE_ALLOW_RULE} in its own permissions.`,
    };
}
