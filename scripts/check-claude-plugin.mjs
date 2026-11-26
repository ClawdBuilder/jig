// `npm run check:claude`: the Claude Code plugin, checked by Claude Code itself. No sign-in and no model.
//
// The plugin is two JSON files and a skill, and the tests of this repository read them field by field. Only Claude Code can say whether it
// accepts them, so this script asks it, the way a person does who adds the marketplace and installs the plugin:
//   1. Claude Code is found (JIG_CLAUDE_BIN, else `claude` on the PATH), and its version must be the one in package.json's
//      `jig.agents["claude-code"]` or a newer one: older than `minimum` stops the check, and a version other than `tested` is said;
//   2. the tracked files of this working tree are copied to a temporary folder, which is the plugin;
//   3. `claude plugin validate --strict` must accept it and name the server `jig` and the skill `jig:git`;
//   4. `claude plugin marketplace add`, `claude plugin install jig@clawdbuilder --config jig_home=...` and `claude plugin list` must say the
//      plugin is there, at the package's version, and on;
//   5. `claude mcp list` starts the plugin's server and must say it is connected;
//   6. the plugin and the marketplace are removed again.
// Nothing here needs a sign-in or a model: these commands only read and write files, and `mcp list` starts the plugin's own server.
// Only Node's own modules are imported, so it runs with no `npm ci`, on Linux, macOS and Windows.
//   node scripts/check-claude-plugin.mjs [--keep] [--verbose]
//     --keep      the temporary folder is removed at the end; --keep, or a failure, leaves it and prints where it is
//     --verbose   prints every command and what Claude Code answered
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { copyTree } from "./lib/tree-copy.mjs";

const REPO = path.resolve(import.meta.dirname, "..");
const keep = process.argv.includes("--keep");
const verbose = process.argv.includes("--verbose");
const read = (file) => JSON.parse(readFileSync(file, "utf8"));

const PLUGIN = "jig";
const MARKETPLACE = "clawdbuilder";
const ID = `${PLUGIN}@${MARKETPLACE}`;
const SERVER = `plugin:${PLUGIN}:${PLUGIN}`;
const SKILL = `${PLUGIN}:git`;
const CLAUDE = process.env.JIG_CLAUDE_BIN?.trim() || "claude";

/** A refusal that is one plain line and leaves nothing to look at: Claude Code is missing or too old. */
class Stop extends Error {}

/** Quotes one argument for cmd.exe, which reads a command as one string. */
const quoted = (word) => (/[\s"&|<>^()%]/.test(word) ? `"${word.replaceAll('"', '\\"')}"` : word);

/** The numbers of a version such as "2.1.332", or "2.1.332 (Claude Code)": undefined when there are not three. */
const numbers = (text) => /(\d+)\.(\d+)\.(\d+)/.exec(text)?.slice(1).map(Number);

/** True when version a is at least version b. */
function atLeast(a, b) {
    for (let index = 0; index < 3; index += 1) if (a[index] !== b[index]) return a[index] > b[index];
    return true;
}

/**
 * What Claude Code is started with: a short list and nothing else. A developer's own session (CLAUDE_CODE_*, CLAUDECODE), their keys
 * (ANTHROPIC_*) and their settings (the real home and config folder) must never be read or changed by this check, so no variable
 * passes unless it is named here, and the home and the config folder are temporary ones.
 */
function environment(home, config) {
    const env = { HOME: home, CLAUDE_CONFIG_DIR: config };
    for (const name of ["PATH", "TMPDIR", "TEMP", "TMP", "LANG"]) {
        if (process.env[name] !== undefined) env[name] = process.env[name];
    }
    if (process.platform === "win32") {
        env.SystemRoot = process.env.SystemRoot;
        env.USERPROFILE = home;
        env.APPDATA = path.join(home, "AppData", "Roaming");
        env.LOCALAPPDATA = path.join(home, "AppData", "Local");
    }
    return env;
}

/** The JSON a command printed. Claude Code may print a line before it, so the first bracket is where it is looked for. */
function jsonOf(text) {
    for (const start of [0, text.search(/[[{]/)]) {
        if (start < 0) continue;
        try {
            return JSON.parse(text.slice(start));
        } catch {
            // The next place.
        }
    }
    return undefined;
}

/** The names in what Claude Code lists: strings, objects with a name or an id, or an object keyed by name. */
function namesIn(value) {
    if (Array.isArray(value))
        return value.map((item) => (typeof item === "string" ? item : (item?.name ?? item?.id))).filter(Boolean);
    return value !== null && typeof value === "object" ? Object.keys(value) : [];
}

/** Claude Code, one command at a time, with the small environment. Never throws on a non-zero exit: the answer says what happened. */
function claude(args, context) {
    const options = { cwd: context.work, env: context.env, encoding: "utf8", timeout: 180_000 };
    // A shell reads one string, and Node warns when it is given arguments beside a shell, so the string is made here.
    const result =
        process.platform === "win32"
            ? spawnSync([CLAUDE, ...args].map(quoted).join(" "), { ...options, shell: true })
            : spawnSync(CLAUDE, args, options);
    const text = `${result.stdout ?? ""}${result.stderr ?? ""}`.trim();
    const answer = {
        command: `claude ${args.join(" ")}`,
        code: result.status,
        text,
        json: jsonOf(result.stdout ?? ""),
    };
    if (verbose) console.log(`$ ${answer.command}\n[exit ${answer.code ?? result.error?.message}]\n${text}\n`);
    return answer;
}

/** The problems with one answer, as lines: the exit code, then what `check` finds wrong with the JSON. */
function judge(answer, check) {
    if (answer.code !== 0) return [`${answer.command} exited with ${answer.code}`];
    if (check === undefined) return [];
    if (answer.json === undefined) return [`${answer.command} did not print JSON`];
    return check(answer.json).map((problem) => `${answer.command}: ${problem}`);
}

/** One step: the command, and what its answer must show. A step that finds a problem stops the check with the answer in full. */
function step(context, args, check) {
    const answer = claude(args, context);
    const problems = judge(answer, check);
    if (problems.length > 0) throw new Error(`${problems.join("\n")}\nit answered:\n${answer.text}`);
    return answer;
}

/** Claude Code's version, as text. A missing program and one that is too old are refusals of one line each. */
function claudeVersion(context, manifest) {
    const { tested, minimum } = manifest.jig.agents["claude-code"];
    const answer = claude(["--version"], context);
    const version = answer.code === 0 ? numbers(answer.text) : undefined;
    if (version === undefined) {
        throw new Stop(
            `Claude Code was not found. Install the tested version: npm install -g --allow-scripts=@anthropic-ai/claude-code @anthropic-ai/claude-code@${tested}, or set JIG_CLAUDE_BIN`,
        );
    }
    const found = version.join(".");
    if (!atLeast(version, numbers(minimum)))
        throw new Stop(
            `Claude Code ${found} is older than ${minimum}, which Jig's plugin needs. Tested version: ${tested}`,
        );
    return `${found} (${found === tested ? "the tested version" : `Jig is tested with ${tested}`})`;
}

/** The plugin and its answers, in order. */
function checkPlugin(context, manifest) {
    const { plugin, settings } = context;
    step(context, ["plugin", "validate", "--strict", "--json", plugin], (json) => [
        ...(json.success === true ? [] : ["success is not true"]),
        ...(namesIn(json.provides?.mcpServers).includes(PLUGIN) ? [] : [`it provides no MCP server named ${PLUGIN}`]),
        ...(namesIn(json.provides?.skills).includes(SKILL) ? [] : [`it provides no skill named ${SKILL}`]),
    ]);
    step(context, ["plugin", "marketplace", "add", plugin, "--json"], (json) => [
        ...(json.outcome === "ok" ? [] : [`outcome is ${JSON.stringify(json.outcome)}, not "ok"`]),
        ...(namesIn([json.marketplace]).includes(MARKETPLACE) ? [] : [`the marketplace is not ${MARKETPLACE}`]),
    ]);
    step(context, ["plugin", "install", ID, "--config", `jig_home=${settings}`, "--json"], (json) =>
        json.outcome === "ok" ? [] : [`outcome is ${JSON.stringify(json.outcome)}, not "ok"`],
    );
    step(context, ["plugin", "list", "--json"], (json) => {
        const entry = Array.isArray(json) ? json.find((item) => item?.id === ID) : undefined;
        if (entry === undefined) return [`${ID} is not in the list`];
        return [
            ...(entry.version === manifest.version ? [] : [`its version is ${entry.version}, not ${manifest.version}`]),
            ...(entry.enabled === true ? [] : ["it is not enabled"]),
        ];
    });
    // The list starts the server of every plugin and says which of them answered, so a server that cannot start shows here.
    const servers = step(context, ["mcp", "list"]);
    if (!servers.text.split("\n").some((line) => line.startsWith(SERVER) && /\bConnected\b/.test(line)))
        throw new Error(`claude mcp list does not show ${SERVER} as Connected:\n${servers.text}`);
    for (const args of [
        ["plugin", "uninstall", ID, "--json"],
        ["plugin", "marketplace", "remove", MARKETPLACE, "--json"],
    ]) {
        step(context, args, (json) =>
            json.outcome === "ok" ? [] : [`outcome is ${JSON.stringify(json.outcome)}, not "ok"`],
        );
    }
}

function main() {
    const manifest = read(path.join(REPO, "package.json"));
    const root = realpathSync(mkdtempSync(path.join(tmpdir(), "jig-claude-check-")));
    const context = {
        home: path.join(root, "home"),
        config: path.join(root, "config"),
        settings: path.join(root, "settings"),
        plugin: path.join(root, "plugin"),
        work: path.join(root, "work"),
    };
    for (const folder of [context.home, context.config, context.settings, context.work]) mkdirSync(folder);
    writeFileSync(path.join(context.settings, "jig.json"), "{}\n");
    context.env = environment(context.home, context.config);
    let leave = keep;
    try {
        const version = claudeVersion(context, manifest);
        console.log(`Claude Code ${version}, Node ${process.version}, Jig ${manifest.version}`);
        const copied = copyTree(REPO, context.plugin);
        console.log(`the plugin: ${copied.length} files copied`);
        checkPlugin(context, manifest);
        console.log(
            `ok: Jig ${manifest.version} passed in Claude Code ${version}: validated, installed, on, connected, removed (Node ${process.version}, ${process.platform})`,
        );
    } catch (error) {
        console.error(error instanceof Error ? error.message : error);
        process.exitCode = 1;
        leave = leave || !(error instanceof Stop);
    } finally {
        if (leave) console.log(`kept: ${root}`);
        else rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    }
}

main();
