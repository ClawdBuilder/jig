// The "Other agents" group of `/jig doctor`: the gateway that starts, the settings folder another agent's plugin must be given, and Claude Code
// with Jig's marketplace and plugin in it. The checks run against fakes: `run` answers for the programs and `pathLookup` says what is installed, so
// no test starts Claude Code, and the calls a check makes are recorded so a test can show that it only reads.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, test } from "node:test";
import { defaultConfig, emptyAdditions } from "../src/config.ts";
import type { RunOptions, RunResult } from "../src/contract.ts";
import { formatDoctor, runDoctor } from "../src/doctor.ts";
import type { DoctorContext, DoctorLine, DoctorOptions } from "../src/doctor.ts";
import { agentChecks, CLAUDE_ALLOW_RULE } from "../src/doctor-agents.ts";
import { DOCTOR_CHECKS } from "../src/doctor-checks.ts";
import { jigPackage, reinstallFix } from "../src/pi-version.ts";

const ROOT = path.resolve(import.meta.dirname, "../../..");
const BUILT = path.join(ROOT, "plugins/jig-core/dist/jig-gateway.mjs");
const VERSION = jigPackage().version as string;
const MARKETPLACE = '[{"name":"clawdbuilder","source":"directory","path":"/somewhere","installLocation":"/somewhere"}]';

let home: string;
let folder: string;

beforeEach(() => {
    home = mkdtempSync(path.join(tmpdir(), "jig-doctor-agents-"));
    folder = path.join(home, "settings");
    mkdirSync(folder);
});

afterEach(() => {
    rmSync(home, { recursive: true, force: true });
});

function context(overrides: Partial<DoctorContext> = {}): DoctorContext {
    return {
        env: { PATH: "" },
        personal: {
            file: path.join(folder, "jig.json"),
            found: true,
            config: defaultConfig(),
            problems: [],
            sections: new Map(),
            incomplete: new Map(),
            invalid: new Set(),
            removed: new Map(),
        },
        sectionChecks: new Map(),
        company: emptyAdditions(),
        sections: new Map(),
        commands: {},
        protectedPaths: () => [],
        sandbox: undefined,
        recordsProblem: undefined,
        agentDir: folder,
        configPath: path.join(folder, "jig.json"),
        stateDir: path.join(home, "state"),
        workingDir: home,
        secrets: { passStoreDir: () => path.join(home, "pass") },
        now: () => new Date("2026-11-26T00:00:00Z"),
        ...overrides,
    };
}

/** What a fake program says: an exit code and text, a timeout, or a thrown error (the program could not start). */
type Answer = Partial<RunResult> | Error;

interface Call {
    file: string;
    args: readonly string[];
    options: RunOptions | undefined;
}

/**
 * A `run` that answers by what is asked: `gateway` for node starting a file, else the program and its arguments as one string. A question nobody
 * prepared an answer for fails the test, so no check starts a program the test did not expect.
 */
function fake(answers: Record<string, Answer>): { run: NonNullable<DoctorOptions["run"]>; calls: Call[] } {
    const calls: Call[] = [];
    const run: NonNullable<DoctorOptions["run"]> = async (file, args, options) => {
        calls.push({ file, args, options });
        const key = file === process.execPath ? "gateway" : [file, ...args].join(" ");
        const answer = answers[key];
        if (answer === undefined) throw new assert.AssertionError({ message: `an unexpected program: ${key}` });
        if (answer instanceof Error) throw answer;
        return { code: 0, stdout: "", stderr: "", timedOut: false, ...answer };
    };
    return { run, calls };
}

const GATEWAY_OK: Answer = { stdout: `${VERSION}\n` };
const CLAUDE_VERSION: Answer = { stdout: "2.1.332 (Claude Code)\n" };
const MARKETPLACES = "claude plugin marketplace list --json";
const PLUGINS = "claude plugin list --json";

/** What `claude plugin list --json` printed for Jig's plugin (shapes captured from Claude Code 2.1.332), with the given fields. */
function installed(fields: Record<string, unknown> = {}): string {
    return JSON.stringify([
        { id: "cc-plugin-privacy@builtin", version: "unknown", scope: "user", enabled: true },
        {
            id: "jig@clawdbuilder",
            version: VERSION,
            scope: "user",
            enabled: true,
            installPath: "/somewhere/cache/clawdbuilder/jig",
            readFromFolder: ROOT,
            folderVersion: VERSION,
            projectEnabled: false,
            hasUserConfig: true,
            ...fields,
        },
    ]);
}

const FULL = (): Record<string, Answer> => ({
    gateway: GATEWAY_OK,
    "claude --version": CLAUDE_VERSION,
    [MARKETPLACES]: { stdout: MARKETPLACE },
    [PLUGINS]: { stdout: installed() },
});

function options(run: DoctorOptions["run"], overrides: Partial<DoctorOptions> = {}): DoctorOptions {
    return { home, platform: "linux", run, pathLookup: (program) => `/usr/bin/${program}`, ...overrides };
}

async function lines(
    answers: Record<string, Answer>,
    overrides: Partial<DoctorOptions> = {},
    ctx = context(),
): Promise<DoctorLine[]> {
    return agentChecks(ctx, options(fake(answers).run, overrides));
}

const byId = (found: DoctorLine[], id: string): DoctorLine | undefined => found.find((line) => line.id === id);
const shown = (found: DoctorLine[]): string =>
    found.map((line) => `${line.level} ${line.title}: ${line.detail ?? ""} ${line.fix ?? ""}`).join("\n");

describe("the gateway", () => {
    test("starts: node runs the built file in this package with --version, and it prints this package's version", async () => {
        const { run, calls } = fake({ gateway: GATEWAY_OK, "claude --version": CLAUDE_VERSION });
        const found = await agentChecks(context(), options(run, { pathLookup: () => undefined }));
        const line = byId(found, "agents.gateway");
        assert.equal(line?.level, "ok", shown(found));
        assert.equal(line?.title, "Jig gateway");
        assert.equal(line?.group, "agents");
        assert.match(line?.detail ?? "", new RegExp(`version ${VERSION.replaceAll(".", "\\.")}`));
        assert.equal(line?.fix, undefined);
        assert.equal(calls.length, 1);
        assert.deepEqual([calls[0]?.file, calls[0]?.args], [process.execPath, [BUILT, "--version"]]);
        assert.equal(calls[0]?.options?.timeoutMs, 5000, "the doctor's own time limit");
    });

    test("uses the doctor's time limit when it has been given one", async () => {
        const { run, calls } = fake({ gateway: GATEWAY_OK });
        await agentChecks(context(), options(run, { pathLookup: () => undefined, timeoutMs: 1234 }));
        assert.equal(calls[0]?.options?.timeoutMs, 1234);
    });

    test("fails with the reinstall line when it prints another version, and names both", async () => {
        const found = await lines({ ...FULL(), gateway: { stdout: "0.0.1\n" } }, { pathLookup: () => undefined });
        const line = byId(found, "agents.gateway");
        assert.equal(line?.level, "fail");
        assert.match(line?.detail ?? "", /said "0\.0\.1" when asked for its version, but this package is /);
        assert.ok(line?.detail?.includes(VERSION));
        assert.equal(line?.fix, reinstallFix(jigPackage().repository));
    });

    test("fails when it prints nothing, exits with a code, times out, cannot be started or is not in the package", async () => {
        const cases: Array<[string, Answer, RegExp]> = [
            ["nothing", { stdout: "" }, /said "" when asked/],
            ["a code", { code: 1, stdout: VERSION }, /stopped with exit code 1/],
            ["a timeout", { timedOut: true, code: 124 }, /did not answer in time/],
            ["a throw", new Error("spawn failed"), /could not be started/],
        ];
        for (const [name, answer, says] of cases) {
            const found = await lines({ gateway: answer }, { pathLookup: () => undefined });
            const line = byId(found, "agents.gateway");
            assert.equal(line?.level, "fail", name);
            assert.match(line?.detail ?? "", says, name);
            assert.equal(line?.fix, reinstallFix(jigPackage().repository), name);
        }
        const { run, calls } = fake({});
        const missing = await agentChecks(
            context(),
            options(run, { pathLookup: () => undefined, gatewayFile: path.join(home, "no-gateway.mjs") }),
        );
        const line = byId(missing, "agents.gateway");
        assert.equal(line?.level, "fail");
        assert.match(line?.detail ?? "", /not in this copy of Jig/);
        assert.deepEqual(calls, [], "nothing is started for a file that is not there");
    });
});

describe("the settings folder for other agents", () => {
    const answers = { gateway: GATEWAY_OK };
    const find = async (ctx: DoctorContext) =>
        byId(await lines(answers, { pathLookup: () => undefined }, ctx), "agents.folder");

    test("is the folder of the jig.json this doctor reads, and what another agent's plugin must be given", async () => {
        const line = await find(context({ env: { PATH: "", JIG_HOME: folder } }));
        assert.equal(line?.level, "ok");
        assert.equal(line?.title, "Settings folder for other agents");
        assert.equal(
            line?.detail,
            `Give another agent's Jig plugin ${folder.replace(home, "~")}, the folder of the jig.json this doctor reads.`,
        );
        assert.equal(line?.fix, undefined);
    });

    test("says that a gateway started with nothing set finds no folder, and runs on built-in defaults", async () => {
        const line = await find(context());
        assert.match(line?.detail ?? "", /Without it the gateway finds no jig\.json and runs on built-in defaults\.$/);
    });

    test("says that a gateway started with nothing set would read another folder: JIG_HOME, or the default home when it holds a jig.json", async () => {
        const other = path.join(home, "other");
        const named = await find(context({ env: { PATH: "", JIG_HOME: other } }));
        assert.match(named?.detail ?? "", /Without it the gateway reads ~\/other instead\.$/);
        mkdirSync(path.join(home, ".jig"));
        writeFileSync(path.join(home, ".jig", "jig.json"), "{}");
        const byDefault = await find(context());
        assert.match(byDefault?.detail ?? "", /Without it the gateway reads ~\/\.jig instead\.$/);
        const same = await find(context({ configPath: path.join(home, ".jig", "jig.json") }));
        assert.doesNotMatch(same?.detail ?? "", /Without it/, "the default home is the folder in use");
    });

    test("is a skip when Jig has not been told where its settings are", async () => {
        const line = await find(context({ configPath: "" }));
        assert.equal(line?.level, "skip");
        assert.match(line?.detail ?? "", /not known yet/);
    });
});

describe("Claude Code", () => {
    test("is one skip line when it is not on the path, and nothing about it is run", async () => {
        const { run, calls } = fake({ gateway: GATEWAY_OK });
        const found = await agentChecks(context(), options(run, { pathLookup: () => undefined }));
        const claude = found.filter((line) => line.id.startsWith("agents.claude"));
        assert.equal(claude.length, 1, shown(found));
        assert.deepEqual(
            [claude[0]?.level, claude[0]?.title, claude[0]?.detail],
            ["skip", "Claude Code", "Claude Code is not installed."],
        );
        assert.equal(claude[0]?.fix, undefined);
        assert.deepEqual(
            calls.map((call) => call.file),
            [process.execPath],
        );
    });

    test("looks for claude by name on the doctor's PATH", async () => {
        const asked: string[] = [];
        await lines({ gateway: GATEWAY_OK }, { pathLookup: (program) => (asked.push(program), undefined) });
        assert.deepEqual(asked, ["claude"]);
    });

    test("is ok with its version when it is new enough", async () => {
        const line = byId(await lines(FULL()), "agents.claude");
        assert.deepEqual([line?.level, line?.detail, line?.fix], ["ok", "2.1.332", undefined]);
    });

    test("warns when it is older than the minimum in package.json, naming both versions", async () => {
        const found = await lines({ ...FULL(), "claude --version": { stdout: "2.1.100 (Claude Code)\n" } });
        const line = byId(found, "agents.claude");
        assert.equal(line?.level, "warn");
        assert.equal(line?.detail, "2.1.100 (Jig's plugin needs 2.1.326 or later)");
        assert.match(line?.fix ?? "", /Update Claude Code/);
        assert.ok(byId(found, "agents.claude.jig"), "the plugin is still looked at");
    });

    test("is one skip line, and nothing more is run, when its version cannot be read", async () => {
        const answers: Answer[] = [
            { stdout: "" },
            { stdout: "usage: claude [options]" },
            { code: 1, stdout: "2.1.332" },
            { timedOut: true },
            new Error("could not start"),
        ];
        for (const answer of answers) {
            const { run, calls } = fake({ gateway: GATEWAY_OK, "claude --version": answer });
            const found = await agentChecks(context(), options(run));
            const claude = found.filter((line) => line.id.startsWith("agents.claude"));
            assert.equal(claude.length, 1, shown(found));
            assert.deepEqual(
                [claude[0]?.level, claude[0]?.detail],
                ["skip", "its version could not be read, so Jig's plugin was not checked."],
            );
            assert.deepEqual(
                calls.map((call) => (call.file === process.execPath ? "gateway" : call.args.join(" "))),
                ["gateway", "--version"],
            );
        }
    });

    test("is given Claude Code's own settings folder when the environment names one, and no other variable", async () => {
        const { run, calls } = fake(FULL());
        await agentChecks(context({ env: { PATH: "", CLAUDE_CONFIG_DIR: "/somewhere/claude" } }), options(run));
        const claude = calls.filter((call) => call.file === "claude");
        assert.equal(claude.length, 3);
        for (const call of claude) assert.deepEqual(call.options?.env, { CLAUDE_CONFIG_DIR: "/somewhere/claude" });
        const none = fake(FULL());
        await agentChecks(context({ env: { PATH: "", CLAUDE_CONFIG_DIR: "" } }), options(none.run));
        for (const call of none.calls.filter((one) => one.file === "claude"))
            assert.equal(call.options?.env, undefined);
    });
});

describe("Jig in Claude Code", () => {
    const find = async (answers: Record<string, Answer>, ctx = context()) =>
        byId(await lines(answers, {}, ctx), "agents.claude.jig");

    test("is not set up when Jig's marketplace is not added: a skip that is not a failure, with the command that adds it", async () => {
        const { run, calls } = fake({ ...FULL(), [MARKETPLACES]: { stdout: "[]" } });
        const line = byId(await agentChecks(context(), options(run)), "agents.claude.jig");
        assert.equal(line?.level, "skip");
        assert.equal(line?.title, "Jig in Claude Code");
        assert.equal(line?.detail, "not set up: Claude Code does not have Jig's marketplace, clawdbuilder.");
        assert.equal(line?.fix, `claude plugin marketplace add ${ROOT}`);
        assert.equal(
            calls.some((call) => call.args.join(" ") === PLUGINS),
            false,
            "the plugin list is not asked for",
        );
    });

    test("is not set up for a marketplace of another name, such as the stand-in the spikes used", async () => {
        const other = '[{"name":"jig-mkt","source":"directory","path":"/x","installLocation":"/x"}]';
        assert.equal((await find({ ...FULL(), [MARKETPLACES]: { stdout: other } }))?.level, "skip");
    });

    test("warns when the marketplace is added and the plugin is not installed, with the install command and the settings folder", async () => {
        const none = JSON.stringify([
            { id: "cc-plugin-privacy@builtin", version: "unknown", scope: "user", enabled: true },
        ]);
        const line = await find({ ...FULL(), [PLUGINS]: { stdout: none } });
        assert.equal(line?.level, "warn");
        assert.equal(line?.detail, "Jig's marketplace is added, but the plugin jig@clawdbuilder is not installed.");
        assert.equal(line?.fix, `claude plugin install jig@clawdbuilder --config jig_home=${folder}`);
    });

    test("quotes a settings folder that has a space or a quote in its name, and leaves the option out when the folder is not known", async () => {
        const none = { ...FULL(), [PLUGINS]: { stdout: "[]" } };
        const odd = path.join(home, "my settings", "it's");
        const quoted = await find(none, context({ configPath: path.join(odd, "jig.json") }));
        assert.equal(
            quoted?.fix,
            `claude plugin install jig@clawdbuilder --config jig_home='${odd.replaceAll("'", "'\\''")}'`,
        );
        const unknown = await find(none, context({ configPath: "" }));
        assert.equal(unknown?.fix, "claude plugin install jig@clawdbuilder");
    });

    test("warns when the plugin is installed and switched off, with the command that switches it on", async () => {
        const line = await find({ ...FULL(), [PLUGINS]: { stdout: installed({ enabled: false }) } });
        assert.equal(line?.level, "warn");
        assert.equal(line?.detail, "installed, but switched off.");
        assert.equal(line?.fix, "claude plugin enable jig@clawdbuilder");
    });

    test("warns when Claude Code runs another version of Jig than this one, and names both: the installed one, or the one its folder holds now", async () => {
        const installedOld = await find({ ...FULL(), [PLUGINS]: { stdout: installed({ version: "0.5.0" }) } });
        assert.equal(installedOld?.level, "warn");
        assert.equal(installedOld?.detail, `Claude Code runs Jig 0.5.0, and this package is ${VERSION}.`);
        assert.equal(installedOld?.fix, "Run claude plugin update jig@clawdbuilder, then restart Claude Code.");
        const folderNewer = await find({ ...FULL(), [PLUGINS]: { stdout: installed({ folderVersion: "9.9.9" }) } });
        assert.equal(folderNewer?.level, "warn");
        assert.equal(folderNewer?.detail, `Claude Code runs Jig 9.9.9, and this package is ${VERSION}.`);
    });

    test("is ok when it is installed, on and the same version, and says Claude Code asks before each tool unless the rule is allowed", async () => {
        const line = await find(FULL());
        assert.equal(line?.level, "ok");
        assert.equal(line?.fix, undefined);
        assert.equal(CLAUDE_ALLOW_RULE, "mcp__plugin_jig_jig__*");
        assert.equal(
            line?.detail,
            `version ${VERSION}, on. Claude Code asks before each Jig tool unless you allow mcp__plugin_jig_jig__* in its own permissions.`,
        );
    });

    test("is ok from a plugin that has no folderVersion, and takes the enabled one when it is installed in two scopes", async () => {
        const noFolder = JSON.stringify([{ id: "jig@clawdbuilder", version: VERSION, scope: "user", enabled: true }]);
        assert.equal((await find({ ...FULL(), [PLUGINS]: { stdout: noFolder } }))?.level, "ok");
        const two = JSON.stringify([
            { id: "jig@clawdbuilder", version: VERSION, scope: "project", enabled: false },
            { id: "jig@clawdbuilder", version: VERSION, scope: "user", enabled: true },
        ]);
        assert.equal((await find({ ...FULL(), [PLUGINS]: { stdout: two } }))?.level, "ok");
    });

    test("is a skip, and not a guess, when Claude Code does not say which version of Jig it runs", async () => {
        const nothing = JSON.stringify([{ id: "jig@clawdbuilder", version: "unknown", scope: "user", enabled: true }]);
        const line = await find({ ...FULL(), [PLUGINS]: { stdout: nothing } });
        assert.deepEqual(
            [line?.level, line?.detail],
            ["skip", "Claude Code did not say which version of Jig it runs."],
        );
    });

    test("is one skip line that says the answer could not be read, never a crash and never a guess, for every answer it cannot use", async () => {
        const bad: Answer[] = [
            { stdout: "" },
            { stdout: "Error: unknown command" },
            { stdout: '{"id":"jig@clawdbuilder"}' },
            { stdout: "[1, 2]" },
            { stdout: "[null]" },
            { stdout: "[" },
            { code: 1, stdout: "[]" },
            { timedOut: true, code: 124 },
            new Error("could not start"),
        ];
        for (const answer of bad) {
            for (const command of [MARKETPLACES, PLUGINS]) {
                const found = await lines({ ...FULL(), [command]: answer });
                const line = byId(found, "agents.claude.jig");
                assert.deepEqual(
                    [line?.level, line?.detail],
                    ["skip", "Claude Code's answer about its plugins could not be read."],
                    `${command}: ${JSON.stringify(answer)}`,
                );
                assert.equal(line?.fix, undefined);
                assert.equal(found.filter((one) => one.id === "agents.claude.jig").length, 1);
            }
        }
    });
});

describe("what the group does", () => {
    test("only reads: it starts the gateway with --version and asks claude for its version and two lists, and nothing else", async () => {
        const { run, calls } = fake(FULL());
        const found = await agentChecks(context(), options(run));
        assert.equal(found.length, 4, shown(found));
        assert.deepEqual(
            calls.map((call) => (call.file === process.execPath ? "gateway" : [call.file, ...call.args].join(" "))),
            ["gateway", "claude --version", MARKETPLACES, PLUGINS],
        );
        assert.deepEqual(calls[0]?.args, [BUILT, "--version"]);
    });

    test("is registered last in the doctor, in a group of its own with the title Other agents", async () => {
        assert.equal(DOCTOR_CHECKS.at(-1)?.[0], "agents");
        assert.equal(DOCTOR_CHECKS.at(-1)?.[1], agentChecks);
        const { run } = fake(FULL());
        const report = await runDoctor(context(), { ...options(run), piVersion: () => "1.5.0", jigVersion: VERSION });
        const groups = [...new Set(report.lines.map((line) => line.group))];
        assert.equal(groups.at(-1), "agents");
        const text = formatDoctor(report).join("\n");
        assert.ok(text.indexOf("Other agents") > text.indexOf("Records"), "after the last group the report had");
        assert.match(text, /Other agents\n {2}\S+ Jig gateway — starts, and is version /);
        assert.match(text, /Settings folder for other agents — Give another agent's Jig plugin /);
        assert.match(text, /Claude Code — 2\.1\.332/);
        assert.match(text, /Jig in Claude Code — version /);
    });

    test("answers when no program can be started: the gateway fails, Claude Code is a skip, and the rest of the report is there", async () => {
        const report = await runDoctor(context(), {
            ...options(async () => {
                throw new Error("boom");
            }),
        });
        assert.deepEqual(
            report.lines.filter((line) => line.id.endsWith(".crashed")),
            [],
        );
        assert.ok(report.lines.some((line) => line.group === "machine"));
        assert.equal(report.lines.find((line) => line.id === "agents.gateway")?.level, "fail");
        assert.equal(report.lines.find((line) => line.id === "agents.claude")?.level, "skip");
    });
});
