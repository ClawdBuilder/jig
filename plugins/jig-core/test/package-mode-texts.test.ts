// Jig installed with `pi install` into a Pi folder that is not a Jig home: nothing a session says names a `jig` terminal
// command (there is none) or a Jig home (there is none). The test walks the doctor lines, the status lines, the
// not-set-up line, the lines setup prints, the update notices and the model line, and fails on the patterns below.
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, test } from "node:test";
import { VERSION } from "@earendil-works/pi-coding-agent";
import { defaultConfig, emptyAdditions } from "../src/config.ts";
import type { LoadedConfig } from "../src/config.ts";
import type { OnboardingEntry } from "../src/contract.ts";
import { formatDoctor, runDoctor } from "../src/doctor.ts";
import type { DoctorContext, DoctorOptions } from "../src/doctor.ts";
import { installMode } from "../src/install-mode.ts";
import { notSetUpMessage } from "../src/kit/values.ts";
import { modelProviderLine, modelSignInLine, modelStatus } from "../src/model-auth.ts";
import { availableNotice, deprecatedNotice, piNewerNotice } from "../src/update-notice-text.ts";
import { fakeContext } from "./support/fake-pi.ts";
import { start } from "./support/harness.ts";
import type { Harness, StartOptions } from "./support/harness.ts";
import { tempState } from "./support/state.ts";

/** A terminal `jig` command, a "inside jig" and a Jig home: what only a Jig home has. */
const PATTERNS: readonly RegExp[] = [
    /(?<![/\w-])jig (setup|doctor|update|install|auth)/,
    /inside jig(?!-)/,
    /Jig home/,
];

function assertClean(texts: ReadonlyArray<string | undefined>, where: string): void {
    const found = texts.filter((text): text is string => text !== undefined && text !== "");
    assert.ok(found.length > 0, `${where}: the walk saw no text`);
    for (const text of found) {
        for (const pattern of PATTERNS) assert.doesNotMatch(text, pattern, `${where}: ${text}`);
    }
}

const state = tempState();
let root: string;
let agentDir: string;
let harness: Harness | undefined;

beforeEach(() => {
    state.start();
    root = mkdtempSync(path.join(tmpdir(), "jig-package-mode-"));
    agentDir = path.join(root, "agent");
    mkdirSync(agentDir);
});
afterEach(async () => {
    await harness?.shutdown();
    harness = undefined;
    state.stop();
    rmSync(root, { recursive: true, force: true });
});

async function begin(options: StartOptions = {}): Promise<Harness> {
    harness = await start({ ...options, env: { ...process.env, LANG: "C", LC_ALL: "C", NO_COLOR: "1", TERM: "dumb" } });
    return harness;
}

/** Runs `/jig <args>` and returns everything it showed: notices, and the titles and lines of a selector. */
async function jigCommand(h: Harness, args = ""): Promise<string[]> {
    const before = [h.ui.notifications.length, h.ui.selects.length] as const;
    const command = h.host.commands.get("jig");
    assert.ok(command, "/jig is registered");
    await command.handler(args, h.ctx as never);
    return [
        ...h.ui.notifications.slice(before[0]).flatMap((entry) => entry.message.split("\n")),
        ...h.ui.selects.slice(before[1]).flatMap((entry) => entry.options),
    ];
}

describe("the session is in package mode", () => {
    test("its folder is not the Jig home, whatever else the environment says", async () => {
        const h = await begin();
        assert.equal(installMode(h.agentDir), "package");
    });
});

describe("the doctor, in a folder that is not the Jig home", () => {
    /** A company package that caps Jig's version, listed in the folder's Pi settings. */
    function company(range: string): void {
        const folder = path.join(root, "company");
        mkdirSync(folder);
        writeFileSync(
            path.join(folder, "package.json"),
            JSON.stringify({ name: "@acme/jig-company", version: "1.0.0", jig: { range } }),
        );
        writeFileSync(path.join(agentDir, "settings.json"), JSON.stringify({ packages: [folder] }));
    }

    function loaded(): LoadedConfig {
        return {
            file: path.join(agentDir, "jig.json"),
            found: true,
            config: defaultConfig(),
            problems: [],
            sections: new Map(),
            incomplete: new Map(),
            invalid: new Set(),
            removed: new Map(),
        };
    }

    const onboarding: OnboardingEntry = {
        preferredStore: "pass",
        items: [
            { kind: "text", section: "acme", path: "bastion.user", label: "Your Acme login" },
            { kind: "reference", section: "acme", path: "token", label: "Your Acme token" },
            {
                kind: "object",
                section: "acme",
                path: "connections",
                label: "A database connection",
                keyLabel: "Which environment?",
                forms: [{ fields: [{ kind: "text", path: "uri", label: "Where is the database?" }] }],
            },
            { kind: "proposal", section: "acme", path: "rules", key: "x", value: 1, label: "A rule" },
        ],
    };

    function context(extra: Partial<DoctorContext> = {}): DoctorContext {
        return {
            env: { PATH: "" },
            personal: loaded(),
            sectionChecks: new Map([
                ["acme", () => ["acme: must hold a login"]],
                ["jira", () => ["jira.site is required"]],
            ]),
            company: emptyAdditions(),
            sections: new Map(),
            commands: {},
            protectedPaths: () => [{ path: agentDir, shown: agentDir, kind: "guarded", source: "default" }],
            sandbox: { active: true, mode: "filtered", canWrite: () => false },
            recordsProblem: undefined,
            agentDir,
            configPath: path.join(agentDir, "jig.json"),
            stateDir: path.join(root, "state"),
            workingDir: root,
            secrets: { passStoreDir: () => path.join(root, "pass") },
            now: () => new Date("2026-11-19T00:00:00Z"),
            onboarding,
            sectionSetup: new Map([
                [
                    "jira",
                    {
                        summary: "Read, search and comment on issues in your Jira.",
                        items: [{ kind: "text", section: "jira", path: "site", label: "Your Jira site" }],
                    },
                ],
            ]),
            projectSkipped: {
                sources: ["./tools"],
                detail: "not loaded: the folder is not trusted.",
                setupLine: "",
                jigIncluded: false,
            },
            ...extra,
        };
    }

    function options(extra: Partial<DoctorOptions> = {}): DoctorOptions {
        return {
            platform: "linux",
            nodeVersion: "24.15.0",
            piVersion: () => "1.3.9",
            jigVersion: "0.3.0",
            home: root,
            pathLookup: () => "/usr/bin/program",
            run: async () => ({ code: 0, stdout: "", stderr: "", timedOut: false }),
            ...extra,
        };
    }

    test("every title, detail and fix, and the report as it is shown, name no terminal jig command", async () => {
        company(">=0.4.0 <0.5.0");
        const report = await runDoctor(context(), options());
        const lines = report.lines;
        // The walk is only worth something if the lines that used to say `jig setup` were there.
        for (const id of [
            "config.section.jira",
            "config.proposals",
            "config.project-trust",
            "machine.pi",
            "logins.model",
        ]) {
            assert.ok(
                lines.some((line) => line.id === id),
                `the doctor has ${id}`,
            );
        }
        assert.ok(
            lines.some((line) => line.id.startsWith("config.company-range.")),
            "the company range line",
        );
        assert.ok(
            lines.some((line) => line.title.startsWith("You need: ")),
            "a you-need line",
        );
        assertClean(
            [...lines.flatMap((line) => [line.title, line.detail, line.fix]), ...formatDoctor(report)],
            "the doctor",
        );
        const byId = (id: string) => lines.find((line) => line.id === id);
        assert.equal(
            byId("config.section.jira")?.detail,
            "not set up: Read, search and comment on issues in your Jira. Run /jig setup jira.",
        );
        assert.equal(byId("config.project-trust")?.fix, "Open Pi here and choose Trust, then run the doctor again.");
        assert.equal(byId("machine.pi")?.fix, "Update Pi yourself: npm install -g @earendil-works/pi-coding-agent");
        assert.equal(byId("machine.agent")?.title, "Pi's folder");
        // A listed extension package may be the model provider, so with one the doctor cannot say; without, it can.
        assert.equal(byId("logins.model")?.level, "skip");
        rmSync(path.join(agentDir, "settings.json"));
        const plain = (await runDoctor(context(), options())).lines.find((line) => line.id === "logins.model");
        assert.equal(plain?.fix, "Type /login to choose one.");
        assert.equal(plain?.detail, "not signed in for this Pi folder.");
    });

    test("the Model line of a session is Pi's own count, in one wording", async () => {
        for (const [count, level, said] of [
            [3, "ok", "3 models available"],
            [1, "ok", "1 model available"],
            [0, "warn", "none available. Type /login."],
        ] as const) {
            const report = await runDoctor(
                context({ models: { getAvailable: () => new Array(count).fill({}) } }),
                options(),
            );
            const line = report.lines.find((entry) => entry.id === "logins.model");
            assert.deepEqual(
                [line?.level, line?.title, line?.detail, line?.fix],
                [level, "Model", said, level === "warn" ? "Type /login." : undefined],
            );
            assert.ok(
                formatDoctor(report).some((row) => row.includes(`Model — ${said}`)),
                said,
            );
        }
    });

    test("the doctor shows the Pi version it was given, and a session gives it Pi's own", async () => {
        const report = await runDoctor(context(), options({ piVersion: () => "1.5.2" }));
        assert.equal(report.lines.find((line) => line.id === "machine.pi")?.detail, "1.5.2");
        const h = await begin();
        const shown = (await jigCommand(h, "doctor")).find((row) => /^\s+\S+ Pi — /.test(row));
        assert.ok(shown?.endsWith(`Pi — ${VERSION}`) || shown?.includes(`Pi — ${VERSION}`), String(shown));
    });
});

describe("the status of /jig", () => {
    test("the setup nudge and the model line name no terminal command, with and without Pi's registry", async () => {
        const config = { jira: { token: "pass:work/jig-test-does-not-exist" } };
        const plugins = (api: Parameters<NonNullable<StartOptions["plugins"]>>[0]) =>
            api.config.registerSection("jira", () => []);
        for (const models of [undefined, 0, 2]) {
            const h = await begin({ config, plugins, ...(models === undefined ? {} : { models }) });
            const lines = await jigCommand(h);
            assert.ok(
                lines.some((line) => line === "Setup: 1 thing needs you. Run /jig setup."),
                lines.join("\n"),
            );
            assertClean(lines, `/jig with ${models ?? "no"} models`);
            const model = lines.find((line) => /^Model — |^No model provider/.test(line));
            assert.equal(
                model,
                models === undefined
                    ? `No model provider is signed in for ${h.agentDir}. Type /login to choose one.`
                    : models === 0
                      ? "Model — none available. Type /login."
                      : "Model — 2 models available",
            );
            await h.shutdown();
            harness = undefined;
        }
    });
});

describe("the line for a section that is not set up", () => {
    test("neither the missing nor the wrong section line names a terminal command, for the model or the person", () => {
        const input = { section: "orders", plugin: "jig-orders", needs: 'an "orders" section with "services"' };
        assertClean(
            [
                notSetUpMessage(input),
                notSetUpMessage({ ...input, reader: "person" }),
                notSetUpMessage({ ...input, problem: "orders.url must be an https address" }),
                notSetUpMessage({ ...input, problem: "orders.url must be an https address", reader: "person" }),
            ],
            "notSetUpMessage",
        );
    });
});

describe("/jig setup, in a folder that is not the Jig home", () => {
    const scripted = (extra: { confirm?: () => boolean } = {}): StartOptions["ui"] => ({
        select: (_title, options) =>
            options.includes("Answer these")
                ? "Answer these"
                : options.includes("Save these changes")
                  ? "Save these changes"
                  : (options.find((option) => option.startsWith("Done")) ?? options[0]),
        input: () => "orders-api",
        confirm: extra.confirm ?? (() => true),
    });
    const plugins = (api: Parameters<NonNullable<StartOptions["plugins"]>>[0]) => {
        api.config.addSectionDefaults("acme", { bastion: {} });
        api.config.registerSection("acme", (raw) => {
            const user = (raw as { bastion?: { user?: unknown } }).bastion?.user;
            return typeof user === "string" && user !== "" ? [] : ["acme.bastion.user is required"];
        });
    };

    /** Everything the screen was shown: notices, selector titles and lines, input titles, confirmations. */
    const shown = (h: Harness): string[] => [
        ...h.ui.notifications.flatMap((entry) => entry.message.split("\n")),
        ...h.ui.selects.flatMap((entry) => [entry.title, ...entry.options]),
        ...h.ui.inputs.map((entry) => entry.title),
        ...h.ui.confirms.flatMap((entry) => [entry.title, entry.message]),
    ];

    test("the questions, the result lines and the closing words name no terminal command, and a section lands in this folder", async () => {
        const h = await begin({ mode: "tui", plugins, ui: scripted(), models: 0 });
        const said = await jigCommand(h, "setup");
        const file = path.join(h.agentDir, "jig.json");
        assert.ok(existsSync(file), "the file was written in the folder in use");
        assert.equal(
            (JSON.parse(readFileSync(file, "utf8")) as { acme?: { bastion?: { user?: string } } }).acme?.bastion?.user,
            "orders-api",
        );
        assert.ok(said.includes("Run /reload to apply."), said.join("\n"));
        // With no model, setup ends by saying so, in the one wording.
        assert.ok(said.includes("Model — none available. Type /login."), said.join("\n"));
        assertClean(shown(h), "/jig setup");
    });

    test("a refusal that says to run setup again does not name a terminal command", async () => {
        let h: Harness | undefined;
        h = await begin({
            mode: "tui",
            plugins,
            ui: scripted({
                confirm: () => {
                    // Somebody else changes the file while setup is open.
                    writeFileSync(path.join((h as Harness).agentDir, "jig.json"), '{"rules":[{"x":1}]}\n');
                    return true;
                },
            }),
        });
        writeFileSync(path.join(h.agentDir, "jig.json"), '{"rules":[]}\n');
        const said = await jigCommand(h, "setup");
        assert.ok(
            said.some((line) => line.includes("changed while setup was open") && line.endsWith("Run setup again.")),
            said.join("\n"),
        );
        assertClean(shown(h), "a refused setup");
    });

    test("a cancel and a usage error name no terminal command", async () => {
        const h = await begin({ mode: "tui", plugins, ui: { select: () => undefined } });
        await jigCommand(h, "setup");
        assert.deepEqual(await jigCommand(h, "setup a b"), ["Usage: /jig setup [section]"]);
        assertClean(shown(h), "a cancelled setup");
    });

    test("with no screen, it says to open Pi in a terminal, and names the npx command for no Jig", async () => {
        for (const mode of ["print", "rpc"] as const) {
            const h = await begin({ mode, ui: false, env: undefined, plugins });
            const said = await jigCommand(h, "setup");
            assert.deepEqual(said, [
                "This Pi mode has no interactive setup screen.",
                "Open Pi in a terminal and run /jig setup.",
            ]);
            assertClean(said, `setup in ${mode} mode`);
            await h.shutdown();
            harness = undefined;
        }
    });
});

describe("the update notices", () => {
    test("none of the three, in package mode, names a terminal command", () => {
        const texts = [
            piNewerNotice("package", "1.6.0", "1.5.2"),
            deprecatedNotice("package", "@clawdbuilder/jig", "0.5.10", "use 0.6.0", "0.6.0"),
            deprecatedNotice("package", "@clawdbuilder/jig", "0.5.10", "gone", "0.5.10"),
            availableNotice({
                mode: "package",
                packageName: "@clawdbuilder/jig",
                current: "0.5.10",
                target: "0.6.0",
                capped: true,
                pinned: false,
            }),
            availableNotice({
                mode: "package",
                packageName: "@clawdbuilder/jig",
                current: "0.5.10",
                target: "0.6.0",
                capped: false,
                pinned: true,
            }),
        ];
        assertClean(texts, "the update notices");
        assert.equal(
            availableNotice({
                mode: "package",
                packageName: "@clawdbuilder/jig",
                current: "0.5.10",
                target: "0.6.0",
                capped: false,
                pinned: false,
            }),
            undefined,
            "Pi's own notice says it",
        );
    });

    test("in a home, the same three say jig update, as they did", () => {
        assert.match(piNewerNotice("home", "1.6.0", "1.5.2"), /use jig update in a terminal\.$/);
        assert.match(
            deprecatedNotice("home", "@clawdbuilder/jig", "0.5.10", "x", "0.5.10"),
            /Run jig update in a terminal now\.$/,
        );
        assert.equal(
            availableNotice({
                mode: "home",
                packageName: "@clawdbuilder/jig",
                current: "0.5.10",
                target: "0.6.0",
                capped: false,
                pinned: false,
            }),
            "Jig 0.6.0 is available (you have 0.5.10). Run jig update in a terminal.",
        );
    });
});

describe("the model line", () => {
    test("the file reading and Pi's count both name /login only", () => {
        const folder = path.join(root, "plain");
        mkdirSync(folder);
        assertClean(
            [
                modelSignInLine(folder),
                modelProviderLine(folder, {}).detail,
                modelProviderLine(folder, {}).fix,
                modelStatus(folder, {})?.line,
                modelStatus(folder, {}, { getAvailable: () => [] })?.line,
                modelStatus(folder, {}, { getAvailable: () => [{}] })?.line,
            ],
            "the model line",
        );
    });

    test("a context with a registry carries it to the session", async () => {
        const { ctx } = fakeContext({ models: 5 });
        assert.equal(
            (ctx as unknown as { modelRegistry: { getAvailable(): unknown[] } }).modelRegistry.getAvailable().length,
            5,
        );
    });
});

describe("the source", () => {
    /**
     * The only lines of a plugin's source allowed to name a terminal `jig` command, a "Jig home" or "inside jig": each is
     * the home's own wording (a home has the command) or the title of one of Pi's dialogs, found by the file and a literal
     * in the line, so a new line in the same file is not covered. Every entry must still be found.
     */
    const ALLOWED: ReadonlyArray<readonly [file: string, literal: string]> = [
        ["jig-core/src/install-mode.ts", `"jig update"`],
        ["jig-core/src/install-mode.ts", "Type /login inside jig to choose one, or run"],
        ["jig-core/src/install-mode.ts", `"this Jig home"`],
        ["jig-core/src/update-notice-text.ts", "use jig update in a terminal."],
        ["jig-core/src/update-notice-text.ts", "Run jig update in a terminal now."],
        ["jig-core/src/setup-command.ts", `"Run jig setup in a terminal."`],
        // Titles of Pi's dialogs, and the terminal doctor's row, which is a home.
        ["jig-core/src/setup-command.ts", `ctx.ui.select("jig setup"`],
        ["jig-core/src/commands.ts", `show(ctx, "jig doctor"`],
        ["jig-core/src/doctor-folder.ts", `"Jig home"`],
        // The gateway has no Pi. Its `status` text points a person to the terminal doctor, which reports the problems of jig.json in full.
        ["jig-core/src/gateway/jig-tool.ts", "Run `jig doctor` to see these problems in full."],
    ];
    const codeFiles = (dir: string): string[] =>
        readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
            entry.isDirectory()
                ? entry.name === "cli"
                    ? []
                    : codeFiles(path.join(dir, entry.name))
                : entry.name.endsWith(".ts")
                  ? [path.join(dir, entry.name)]
                  : [],
        );
    const plugins = path.join(import.meta.dirname, "..", "..");

    test("no line of a plugin's source names a terminal jig command in a string, but the allowed ones", () => {
        const found: Array<{ file: string; line: string }> = [];
        for (const plugin of readdirSync(plugins)) {
            const src = path.join(plugins, plugin, "src");
            if (!existsSync(src)) continue;
            for (const file of codeFiles(src)) {
                for (const line of readFileSync(file, "utf8").split("\n")) {
                    if (/^\s*(\/\/|\*|\/\*)/.test(line)) continue;
                    if (PATTERNS.some((pattern) => pattern.test(line)))
                        found.push({ file: path.relative(plugins, file).split(path.sep).join("/"), line: line.trim() });
                }
            }
        }
        const stray = found.filter(
            (hit) => !ALLOWED.some(([file, literal]) => file === hit.file && hit.line.includes(literal)),
        );
        assert.deepEqual(stray, []);
        for (const [file, literal] of ALLOWED) {
            assert.ok(
                found.some((hit) => hit.file === file && hit.line.includes(literal)),
                `the allowed line is gone, so its entry goes too: ${file}: ${literal}`,
            );
        }
    });

    test("the skills and the agent roles, which go into the model's context, name no terminal jig command", () => {
        const found: string[] = [];
        const scan = (dir: string): void => {
            for (const entry of readdirSync(dir, { withFileTypes: true })) {
                const full = path.join(dir, entry.name);
                if (entry.isDirectory()) scan(full);
                else if (entry.name.endsWith(".md")) {
                    for (const [index, line] of readFileSync(full, "utf8").split("\n").entries())
                        if (PATTERNS.some((pattern) => pattern.test(line)))
                            found.push(`${path.relative(plugins, full)}:${index + 1}: ${line.trim()}`);
                }
            }
        };
        for (const plugin of readdirSync(plugins)) {
            for (const folder of ["skills", "agents"]) {
                const dir = path.join(plugins, plugin, folder);
                if (existsSync(dir)) scan(dir);
            }
        }
        assert.deepEqual(found, []);
    });
});
