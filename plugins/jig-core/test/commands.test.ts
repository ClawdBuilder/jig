// The /jig commands: status, setup, doctor, rules per tool and action, and records.
import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, test } from "node:test";
import type { CallClass, JigApi } from "../src/contract.ts";
import { fakeClock } from "./support/clock.ts";
import { start, text } from "./support/harness.ts";
import type { Harness, StartOptions } from "./support/harness.ts";
import { tempState } from "./support/state.ts";
import { rig, scripted } from "./support/watches.ts";

const state = tempState();
beforeEach(() => {
    state.start();
});

let h: Harness | undefined;
afterEach(async () => {
    await h?.shutdown();
    h = undefined;
    state.stop();
});
async function begin(options: StartOptions = {}): Promise<Harness> {
    // Human doctor rows are pinned to words: tests must not depend on the machine's locale.
    h = await start({
        ...options,
        env: { ...process.env, LANG: "C", LC_ALL: "C", NO_COLOR: "1", TERM: "dumb", ...options.env },
    });
    return h;
}

/** Runs a test with JIG_HOME at the harness's agent folder, so /jig setup is the home's own. */
async function inHome<T>(harness: Harness, work: () => Promise<T>): Promise<T> {
    const previous = process.env.JIG_HOME;
    process.env.JIG_HOME = harness.agentDir;
    try {
        return await work();
    } finally {
        if (previous === undefined) delete process.env.JIG_HOME;
        else process.env.JIG_HOME = previous;
    }
}

/** Runs `/jig <args>` and returns everything it showed: notices, and the lines of a selector. */
async function jigCommand(harness: Harness, args = ""): Promise<string> {
    const before = [harness.ui.notifications.length, harness.ui.selects.length] as const;
    const command = harness.host.commands.get("jig");
    assert.ok(command, "/jig is registered");
    await command.handler(args, harness.ctx as never);
    return [
        ...harness.ui.notifications.slice(before[0]).map((entry) => entry.message),
        ...harness.ui.selects.slice(before[1]).map((entry) => entry.options.join("\n")),
    ].join("\n");
}

const gitSchema = {
    properties: {
        action: {
            anyOf: [
                { const: "status", type: "string" },
                { const: "push", type: "string" },
            ],
        },
    },
};

function declareGit(api: JigApi): void {
    api.declareTool({
        tool: "git",
        plugin: "jig-git",
        classify: (input): CallClass | undefined => {
            if (input.action === "status") return { action: "status", environment: "local", effect: "read" };
            if (input.action === "push") return { action: "push", environment: "external", effect: "write" };
            return undefined;
        },
    });
}

/** An incomplete company section and an invalid user section, the two shapes setup asks about. */
function setupSections(api: JigApi): void {
    api.config.addSectionDefaults("acme", { bastion: {} });
    api.config.registerSection("acme", (raw) => {
        const user = (raw as { bastion?: { user?: unknown } }).bastion?.user;
        return typeof user === "string" && user !== "" ? [] : ["acme.bastion.user is required"];
    });
    api.config.registerSection("lens", (raw) =>
        typeof (raw as { port?: unknown }).port === "number" ? [] : ["lens.port must be a number"],
    );
}

describe("/jig", () => {
    test("is registered, with completions for its four words", async () => {
        const harness = await begin();
        const command = harness.host.commands.get("jig");
        assert.ok(command?.description);
        assert.deepEqual(command.getArgumentCompletions?.("r"), [
            { value: "records", label: "records" },
            { value: "rules", label: "rules" },
        ]);
        assert.deepEqual(command.getArgumentCompletions?.("rec"), [{ value: "records", label: "records" }]);
        assert.deepEqual(command.getArgumentCompletions?.("d"), [{ value: "doctor", label: "doctor" }]);
        assert.deepEqual(command.getArgumentCompletions?.("s"), [{ value: "setup", label: "setup" }]);
        assert.equal(command.getArgumentCompletions?.("x"), null);
    });

    test("runs the doctor and shows its groups", async () => {
        const harness = await begin();
        const shown = await jigCommand(harness, "doctor");
        assert.match(shown, /^Jig doctor · \d+ ok/m);
        assert.match(shown, /\nThis machine\n/);
        assert.match(shown, /\nConfiguration\n/);
        assert.match(shown, /\nSecrets\n/);
        assert.match(shown, /\nLogins\n/);
        assert.match(shown, /\nSandbox\n/);
        assert.match(shown, /\nRecords\n/);
    });

    test("doctor uses markers when the Pi environment is a UTF-8 colour terminal", async () => {
        const harness = await begin({
            plugins: setupSections,
            env: { ...process.env, LANG: "C.UTF-8", LC_ALL: undefined, NO_COLOR: undefined, TERM: "xterm-256color" },
        });
        const shown = await jigCommand(harness, "doctor --quiet");
        assert.match(shown, /^  [!✗] /m);
        assert.doesNotMatch(shown, /^  (warn|fail) /m);
    });

    test("doctor --json writes the report in the state folder and says where", async () => {
        const harness = await begin();
        const shown = await jigCommand(harness, "doctor --json");
        assert.match(shown, /Report: .*doctor\.json/);
        const file = path.join(harness.stateDir, "doctor.json");
        const report = JSON.parse(readFileSync(file, "utf8"));
        assert.equal(report.schema, 1);
        assert.equal(report.network, false);
        assert.equal(
            report.summary.ok + report.summary.warn + report.summary.fail + report.summary.skip,
            report.groups.reduce((total: number, group: { checks: unknown[] }) => total + group.checks.length, 0),
        );
    });

    test("doctor --quiet shows only warnings and failures, with the summary", async () => {
        const harness = await begin();
        const shown = await jigCommand(harness, "doctor --quiet");
        assert.match(shown, /^Jig doctor · \d+ ok/m);
        assert.match(shown, /^  warn /m);
        assert.doesNotMatch(shown, /^  ok /m);
        assert.doesNotMatch(shown, /^  skip /m);
    });

    test("doctor refuses a flag it does not know", async () => {
        const harness = await begin();
        assert.match(
            await jigCommand(harness, "doctor --frobnicate"),
            /Usage: \/jig doctor \[--json\] \[--network\] \[--quiet\]/,
        );
    });

    test("setup refuses when the agent folder is not the Jig home", async () => {
        const harness = await begin({ mode: "tui", plugins: setupSections });
        const shown = await jigCommand(harness, "setup");
        assert.match(shown, /not the Jig home/);
        assert.match(shown, /npx @clawdbuilder\/jig setup/);
        assert.equal(existsSync(path.join(harness.agentDir, "jig.json")), false, "nothing was written");
    });

    test("runs setup with Pi's dialogs in the TUI, and writes the same file", async () => {
        const harness = await begin({
            mode: "tui",
            plugins: setupSections,
            ui: {
                select: (_title, options) =>
                    options.includes("Answer these")
                        ? "Answer these"
                        : options.includes("Save these changes")
                          ? "Save these changes"
                          : // The plugin list always holds jig-core's session relay, so it is finished with "Done".
                            (options.find((option) => option.startsWith("Done")) ?? options[0]),
                input: () => "orders-api",
                confirm: () => true,
            },
        });
        const shown = await inHome(harness, () => jigCommand(harness, "setup"));
        const file = path.join(harness.agentDir, "jig.json");
        assert.ok(existsSync(file), "the settings file was written");
        assert.match(shown, /Run \/reload to apply\./);
        assert.doesNotMatch(shown, /Start Pi again/);
        const written = JSON.parse(readFileSync(file, "utf8")) as { acme?: { bastion?: { user?: string } } };
        assert.equal(written.acme?.bastion?.user, "orders-api");
        assert.ok(harness.ui.selects.some((entry) => entry.title.includes("Acme")));
        assert.ok(harness.ui.inputs.length > 0);
    });

    test("Escape after the company choice restores the file and names its backup", async () => {
        const harness = await begin({
            mode: "tui",
            plugins: (api) => {
                setupSections(api);
                api.profiles?.register("acme", { displayName: "Acme" });
            },
            ui: {
                select: (title, options) =>
                    title.startsWith("Which company")
                        ? options.find((option) => option.startsWith("Acme"))
                        : title.startsWith("Use Acme")
                          ? "Everywhere"
                          : undefined,
                confirm: () => true,
            },
        });
        const file = path.join(harness.agentDir, "jig.json");
        writeFileSync(file, '{"rules":[]}\n');
        const shown = await inHome(harness, () => jigCommand(harness, "setup"));
        assert.equal(readFileSync(file, "utf8"), '{"rules":[]}\n');
        assert.match(shown, /restored/);
        assert.match(shown, /Backup: .*\.bak/);
    });

    test("an exception after the company write restores the file", async () => {
        const harness = await begin({
            mode: "tui",
            plugins: (api) => {
                setupSections(api);
                api.profiles?.register("acme", { displayName: "Acme" });
            },
            ui: {
                select: (title, options) =>
                    title.startsWith("Which company")
                        ? options.find((option) => option.startsWith("Acme"))
                        : title.startsWith("Use Acme")
                          ? "Everywhere"
                          : options[0],
                input: () => {
                    throw new Error("screen went away");
                },
                confirm: () => true,
            },
        });
        const file = path.join(harness.agentDir, "jig.json");
        writeFileSync(file, '{"rules":[]}\n');
        const shown = await inHome(harness, () => jigCommand(harness, "setup"));
        assert.equal(readFileSync(file, "utf8"), '{"rules":[]}\n');
        assert.match(shown, /restored.*screen went away/);
    });

    test("setup <section> asks only that section", async () => {
        const harness = await begin({
            mode: "tui",
            plugins: setupSections,
            ui: { select: (_title, options) => options[0], input: () => "orders-api", confirm: () => true },
        });
        await inHome(harness, () => jigCommand(harness, "setup acme"));
        const written = JSON.parse(readFileSync(path.join(harness.agentDir, "jig.json"), "utf8")) as {
            acme?: { bastion?: { user?: string } };
        };
        assert.equal(written.acme?.bastion?.user, "orders-api");
    });

    test("the no-screen fallback names the npm command when jig is not on PATH", async () => {
        const harness = await begin({ mode: "print", env: { PATH: "" }, plugins: setupSections });
        const shown = await inHome(harness, () => jigCommand(harness, "setup"));
        assert.match(shown, /Run jig setup in a terminal\./);
        assert.match(shown, /npx @clawdbuilder\/jig setup/);
    });

    test("Escape at the first Pi question writes nothing", async () => {
        const harness = await begin({ mode: "tui", plugins: setupSections, ui: { select: () => undefined } });
        await inHome(harness, () => jigCommand(harness, "setup"));
        assert.equal(existsSync(path.join(harness.agentDir, "jig.json")), false, "nothing was written");
        assert.match(
            harness.ui.notifications.map((entry) => entry.message).join("\n"),
            /cancelled|Nothing was written/i,
        );
    });

    test("counts a missing credential in the setup nudge", async () => {
        const harness = await begin({
            config: { jira: { token: "pass:work/jig-test-does-not-exist" } },
            plugins: (api) => api.config.registerSection("jira", () => []),
        });
        assert.match(await jigCommand(harness), /Setup: 1 thing needs you\. Run jig setup in a terminal\./);
    });

    test("adds one line about setup when a company's defaults are incomplete", async () => {
        const harness = await begin({
            plugins: (api) => {
                api.config.addSectionDefaults("acme", { bastion: {} });
                api.config.registerSection("acme", (raw) =>
                    (raw as { bastion?: { user?: unknown } }).bastion?.user === undefined
                        ? ["acme.bastion.user is required"]
                        : [],
                );
            },
        });
        assert.match(await jigCommand(harness), /Setup: 1 thing needs you\. Run jig setup in a terminal\./);
    });

    test("shows the status: tools governed, plugins, tools on the unknown default, watches and the configuration", async () => {
        const harness = await begin({
            tools: [
                { name: "read" },
                { name: "mystery" },
                { name: "viewer", annotations: { readOnlyHint: true } },
                { name: "git" },
            ],
            plugins: declareGit,
        });
        const status = await jigCommand(harness);
        // The four tools given, and jig-core's own `watch`.
        assert.match(status, /jig-core governs 5 tools in session session-test/);
        assert.match(status, /Plugins: jig-core, jig-git/);
        assert.match(status, /Tools on the unknown default \(they ask until classified\): mystery\n/);
        assert.match(status, /Open watches: 0/);
        assert.match(status, /Configuration: none found \(.*jig\.json\), defaults apply/);
    });

    test("shows the lines plugins registered for it, one line each; a plugin that fails is named and the others still show", async () => {
        const harness = await begin({
            plugins: (api) => {
                api.status?.register("jig-test", () => ["jig-test: a check is off\nby your setting", "x".repeat(400)]);
                api.status?.register("quiet", () => []);
                api.status?.register("broken", () => {
                    throw new Error("secret detail");
                });
                api.status?.register("replaced", () => ["the first"]);
                api.status?.register("replaced", () => ["the second"]);
            },
        });
        const status = await jigCommand(harness);
        assert.match(status, /\njig-test: a check is off by your setting\n/);
        assert.match(status, new RegExp(`\\n${"x".repeat(299)}…\\n`));
        assert.match(status, /\nbroken: its status could not be read\n/);
        assert.ok(!status.includes("secret detail"));
        assert.ok(!status.includes("the first"));
        assert.match(status, /\nthe second$/);
        assert.throws(() => harness.api.status?.register("", () => []), /the plugin needs a name/);
        assert.throws(() => harness.api.status?.register("x", "no" as never), /lines must be a function/);
    });

    test("counts the open watches, and says which of them are paused or wait for their plugin", async () => {
        // A watch this session saved before Pi was closed, whose plugin is not loaded now.
        const earlier = rig();
        earlier.engine.registerKind(scripted(earlier.clock, "gone", (n) => ({ state: n })).kind);
        earlier.begin("session-test");
        const waiting = earlier.engine.start({ kind: "gone", spec: {}, title: "from the plugin that is not loaded" });
        earlier.engine.end();

        const clock = fakeClock();
        const harness = await begin({
            clock,
            plugins: (api) => {
                api.watches.registerKind(scripted(clock, "ok", (n) => ({ state: n })).kind);
                api.watches.registerKind(
                    scripted(clock, "broken", () => {
                        throw new Error("down");
                    }).kind,
                );
            },
        });
        assert.match(await jigCommand(harness), /Open watches: 1 \(1 waiting for its plugin\)\n/);

        const one = harness.api.watches.start({ kind: "ok", spec: {}, title: "one" });
        harness.api.watches.start({ kind: "ok", spec: {}, title: "two" });
        assert.match(await jigCommand(harness), /Open watches: 3 \(1 waiting for its plugin\)\n/);

        const broken = harness.api.watches.start({ kind: "broken", spec: {}, title: "three" });
        await clock.advance(5 * 60_000);
        assert.match(await jigCommand(harness), /Open watches: 4 \(1 paused, 1 waiting for its plugin\)\n/);

        // The watch tool shows the same three states in its lines.
        const tool = harness.host.registered.get("watch");
        const listed = await tool?.execute(
            "call-1",
            { action: "list" } as never,
            undefined,
            undefined,
            harness.ctx as never,
        );
        const lines = (listed!.content[0] as { text: string }).text.split("\n");
        assert.equal(lines.length, 4);
        assert.match(
            lines.find((line) => line.startsWith(waiting)) ?? "",
            /\| from the plugin that is not loaded \| waiting for its plugin \(jig-test\) \| (?:\d+ s|\d+ min)$/,
        );
        assert.match(lines.find((line) => line.startsWith(one)) ?? "", /\| one \| open \| 5 min$/);
        assert.match(lines.find((line) => line.startsWith(broken)) ?? "", /\| three \| paused \| 5 min$/);
    });

    test("a watch that has finished is not counted as open", async () => {
        const clock = fakeClock();
        const harness = await begin({
            clock,
            plugins: (api) =>
                api.watches.registerKind(
                    scripted(clock, "ok", () => ({ state: 1, done: { outcome: "passed", summary: "ok" } })).kind,
                ),
        });
        harness.api.watches.start({ kind: "ok", spec: {}, title: "one" });
        assert.match(await jigCommand(harness), /Open watches: 1\n/);
        await clock.advance(5_000);
        assert.match(await jigCommand(harness), /Open watches: 0\n/);
    });

    test("shows a problem with the saved watches", async () => {
        const clock = fakeClock();
        const harness = await begin({
            clock,
            plugins: (api) => api.watches.registerKind(scripted(clock, "ok", (n) => ({ state: n })).kind),
        });
        assert.ok(!/Watches:/.test(await jigCommand(harness)));
        // A file in the folder that no version of Jig wrote.
        const { mkdirSync, writeFileSync } = await import("node:fs");
        mkdirSync(`${state.dir}/watches`, { recursive: true });
        writeFileSync(`${state.dir}/watches/abcdefgh.json`, "{ not json");
        await harness.host.fire("session_start", { reason: "reload" }, harness.ctx);
        assert.match(await jigCommand(harness), /\nWatches: 1 saved watch file could not be read$/);
    });

    test("jig-core's own watch tool is not on the unknown default", async () => {
        const harness = await begin({ tools: [{ name: "mystery" }] });
        const status = await jigCommand(harness);
        assert.match(status, /Plugins: jig-core\n/);
        assert.match(status, /Tools on the unknown default \(they ask until classified\): mystery\n/);
    });

    test("a declared tool whose classification depends on the call is not on the unknown default", async () => {
        const harness = await begin({ tools: [{ name: "git" }], plugins: declareGit });
        assert.match(await jigCommand(harness), /Tools on the unknown default \(they ask until classified\): none/);
    });

    test("lists configuration problems, with the file and the key", async () => {
        const harness = await begin({ config: { rule: [], records: { retentionDays: 0 } } });
        const status = await jigCommand(harness);
        assert.match(status, /Configuration problems \(2\):/);
        assert.match(status, /jig\.json: rule: unknown field/);
        assert.match(status, /jig\.json: records\.retentionDays: must be a whole number of days/);
        assert.doesNotMatch(status, /none found/);
    });

    test("names the sections plugins registered and whether each loaded", async () => {
        const harness = await begin({
            config: { git: { timeout: 5 }, lens: { port: "high" } },
            plugins: (api) => {
                api.config.registerSection("git", () => []);
                api.config.registerSection("lens", (raw) =>
                    typeof (raw as { port?: unknown }).port === "number" ? [] : ["lens.port must be a number"],
                );
                api.config.registerSection("flow", () => []);
            },
        });
        const status = await jigCommand(harness);
        assert.match(
            status,
            /Plugin sections in the file: git \(loaded\), lens \(not set or invalid\), flow \(not set\)/,
        );
        assert.match(status, /jig\.json: lens: lens\.port must be a number/);
    });

    test("a section nothing set, with no file at all, is plainly not set", async () => {
        const harness = await begin({ plugins: (api) => api.config.registerSection("git", () => []) });
        assert.match(await jigCommand(harness), /Plugin sections in the file: git \(not set\)$/m);
    });

    test("a section the file has that fails its check is not set or invalid, and one it lacks is not set", async () => {
        const harness = await begin({
            config: { lens: { port: "high" } },
            plugins: (api) => {
                api.config.registerSection("lens", () => ["lens.port must be a number"]);
                api.config.registerSection("flow", () => []);
            },
        });
        assert.match(await jigCommand(harness), /lens \(not set or invalid\), flow \(not set\)\n/);
    });

    test("when the file cannot be read as a whole, its sections are not called simply not set", async () => {
        const harness = await begin({
            config: "not an object",
            plugins: (api) => api.config.registerSection("git", () => []),
        });
        const status = await jigCommand(harness);
        assert.match(status, /Plugin sections in the file: git \(not set or invalid\)\n/);
        assert.match(status, /\(file\): must hold one JSON object/);
    });

    test("lists the environments by who defined them, with the kind of each that is not built in", async () => {
        const harness = await begin({
            config: { environments: { sandbox: { kind: "test" } } },
            plugins: (api) => api.config.addEnvironments({ staging: { kind: "test" }, prod: { kind: "production" } }),
        });
        assert.match(
            await jigCommand(harness),
            /^Environments \(any other name counts as production\): built in: local, external, production; a company plugin: staging \(test\), prod \(production\); your jig\.json: sandbox \(test\)$/m,
        );
    });

    test("shows only the built-in environments when nobody defined more", async () => {
        const harness = await begin();
        assert.match(
            await jigCommand(harness),
            /^Environments \(any other name counts as production\): built in: local, external, production$/m,
        );
    });

    test("an unknown word shows the usage", async () => {
        const harness = await begin();
        assert.match(
            await jigCommand(harness, "frobnicate"),
            /Usage: \/jig, \/jig setup, \/jig doctor, \/jig rules \[tool\], \/jig records/,
        );
    });
});

/** One plugin on setup's list that asks one text question, so the list, a cancel inside it and a cancel at the list can run. */
function deskSection(api: JigApi): void {
    api.config.registerSection(
        "desk",
        (raw) => {
            const user = (raw as { user?: unknown }).user;
            return typeof user === "string" && user !== "" ? [] : ["desk.user is required"];
        },
        {
            setup: {
                summary: "A desk to sit at.",
                items: [
                    {
                        kind: "text",
                        section: "desk",
                        path: "user",
                        label: "Desk user",
                        why: "Who sits at the desk.",
                        placeholder: "orders-api",
                    },
                ],
            },
        },
    );
}

const PLUGIN_LIST = "Jig setup: which plugin do you want to set up?";

describe("/jig setup in Pi: Esc", () => {
    // Pi's dialogs have no numbers and Esc closes one without an answer, so Esc is the terminal's Ctrl+C: inside one plugin's
    // questions it returns to the list, at the list with unsaved answers it asks to save (Pi's confirm has Yes selected), and
    // in the questions before the list, or at the last confirmations, it cancels the run and the settings file is restored.
    test("at the list with answers asks to save, and Yes goes to the review and writes", async () => {
        let visits = 0;
        const harness = await begin({
            mode: "tui",
            plugins: deskSection,
            ui: {
                select: (title, options) => {
                    if (title.startsWith(PLUGIN_LIST))
                        return ++visits === 1 ? options.find((one) => one.startsWith("Desk")) : undefined;
                    return options.includes("Save these changes") ? "Save these changes" : undefined;
                },
                input: () => "orders-api",
                confirm: () => true,
            },
        });
        const shown = await inHome(harness, () => jigCommand(harness, "setup"));
        const file = path.join(harness.agentDir, "jig.json");
        assert.deepEqual(JSON.parse(readFileSync(file, "utf8")), { desk: { user: "orders-api" } });
        assert.ok(
            harness.ui.selects.some((entry) => entry.title === `${PLUGIN_LIST} (1 unsaved change)`),
            "the list counts what is not saved",
        );
        assert.deepEqual(
            harness.ui.confirms.map((entry) => entry.title),
            ["Save the 1 change you made?", "Save these changes?"],
        );
        assert.match(shown, /Run \/reload to apply\./);
    });

    test("at the list with answers, closing the question about saving restores the file as it was", async () => {
        let visits = 0;
        const harness = await begin({
            mode: "tui",
            plugins: deskSection,
            ui: {
                select: (title, options) =>
                    title.startsWith(PLUGIN_LIST)
                        ? ++visits === 1
                            ? options.find((one) => one.startsWith("Desk"))
                            : undefined
                        : undefined,
                input: () => "orders-api",
                // Esc on Pi's Yes/No list answers false.
                confirm: () => false,
            },
        });
        const file = path.join(harness.agentDir, "jig.json");
        writeFileSync(file, '{"rules":[]}\n');
        const shown = await inHome(harness, () => jigCommand(harness, "setup"));
        assert.equal(readFileSync(file, "utf8"), '{"rules":[]}\n', "the file is as it was");
        assert.match(shown, /Nothing was written\./);
        assert.match(shown, /Setup cancelled; .*jig\.json was restored\./);
    });

    test("at the list with answers and no file before, nothing is left behind", async () => {
        let visits = 0;
        const harness = await begin({
            mode: "tui",
            plugins: deskSection,
            ui: {
                select: (title, options) =>
                    title.startsWith(PLUGIN_LIST) && ++visits === 1
                        ? options.find((one) => one.startsWith("Desk"))
                        : undefined,
                input: () => "orders-api",
                confirm: () => false,
            },
        });
        await inHome(harness, () => jigCommand(harness, "setup"));
        assert.equal(existsSync(path.join(harness.agentDir, "jig.json")), false, "no file was created");
    });

    test("at the list after the company's choice was written, a no restores that write too and names the backup", async () => {
        let visits = 0;
        const harness = await begin({
            mode: "tui",
            plugins: (api) => {
                deskSection(api);
                api.profiles?.register("acme", { displayName: "Acme" });
            },
            ui: {
                select: (title, options) => {
                    if (title.startsWith("Which company")) return options.find((option) => option.startsWith("Acme"));
                    if (title.startsWith("Use Acme")) return "Everywhere";
                    if (title.startsWith(PLUGIN_LIST)) {
                        return ++visits === 1 ? options.find((one) => one.startsWith("Desk")) : undefined;
                    }
                    return undefined;
                },
                input: () => "orders-api",
                // Yes to the company choice, which writes at once; no to saving the rest.
                confirm: (title) => title.startsWith("Save this company choice"),
            },
        });
        const file = path.join(harness.agentDir, "jig.json");
        writeFileSync(file, '{"rules":[]}\n');
        const shown = await inHome(harness, () => jigCommand(harness, "setup"));
        assert.equal(readFileSync(file, "utf8"), '{"rules":[]}\n', "the company's write was undone too");
        assert.match(shown, /Setup cancelled; .*jig\.json was restored\. Backup: .*\.bak/);
    });

    test("inside a plugin's questions returns to the list, and the run goes on", async () => {
        let visits = 0;
        const harness = await begin({
            mode: "tui",
            plugins: deskSection,
            ui: {
                select: (title, options) =>
                    title.startsWith(PLUGIN_LIST)
                        ? ++visits === 1
                            ? options.find((one) => one.startsWith("Desk"))
                            : options.find((one) => one.startsWith("Done"))
                        : undefined,
                // Esc in the text question.
                input: () => undefined,
                confirm: () => true,
            },
        });
        const file = path.join(harness.agentDir, "jig.json");
        writeFileSync(file, '{"rules":[]}\n');
        const shown = await inHome(harness, () => jigCommand(harness, "setup"));
        assert.equal(visits, 2, "the list came back after the cancelled plugin");
        assert.match(shown, /Desk was left as it was; nothing from it is kept\. Back to the list\./);
        assert.equal(readFileSync(file, "utf8"), '{"rules":[]}\n');
    });

    test("in the questions before the list cancels the whole run and restores the file", async () => {
        const harness = await begin({
            mode: "tui",
            plugins: (api) => {
                setupSections(api);
                deskSection(api);
            },
            ui: { select: () => undefined, confirm: () => true },
        });
        const file = path.join(harness.agentDir, "jig.json");
        writeFileSync(file, '{"rules":[]}\n');
        const shown = await inHome(harness, () => jigCommand(harness, "setup"));
        assert.equal(
            harness.ui.selects.some((entry) => entry.title.startsWith(PLUGIN_LIST)),
            false,
            "the list was never reached",
        );
        assert.equal(readFileSync(file, "utf8"), '{"rules":[]}\n');
        assert.match(shown, /Setup cancelled; .*jig\.json was restored\./);
    });

    test("at the review closes the run, and the file is restored", async () => {
        let visits = 0;
        const harness = await begin({
            mode: "tui",
            plugins: deskSection,
            ui: {
                select: (title, options) =>
                    title.startsWith(PLUGIN_LIST)
                        ? ++visits === 1
                            ? options.find((one) => one.startsWith("Desk"))
                            : options.find((one) => one.startsWith("Done"))
                        : undefined,
                input: () => "orders-api",
                confirm: () => true,
            },
        });
        const shown = await inHome(harness, () => jigCommand(harness, "setup"));
        assert.equal(existsSync(path.join(harness.agentDir, "jig.json")), false, "nothing was written");
        assert.match(shown, /Setup cancelled/);
    });
});

describe("/jig rules", () => {
    const tools = [
        { name: "read" },
        { name: "bash" },
        { name: "mystery" },
        { name: "viewer", annotations: { readOnlyHint: true } },
        { name: "git", parameters: gitSchema },
        { name: "other_db" },
    ];

    test("gives one line per tool with its environment, effect, decision and where each came from", async () => {
        const harness = await begin({ tools, plugins: declareGit });
        const rules = await jigCommand(harness, "rules");
        assert.match(rules, /^bash: local write -> allow \(decision: table; classified by: default\)$/m);
        assert.match(rules, /^read: local read -> allow \(decision: table; classified by: default\)$/m);
        assert.match(rules, /^viewer: external read -> allow \(decision: table; classified by: hint\)$/m);
    });

    test("flags a tool still on the unknown default, so the user can classify it", async () => {
        const harness = await begin({ tools });
        const rules = await jigCommand(harness, "rules");
        assert.match(
            rules,
            /^mystery: external write -> ask \(decision: unknown; classified by: default, not classified\)  <- not classified: add a classify rule, or a rule that names it$/m,
        );
    });

    test("gives a line per action for a tool whose schema lists its actions", async () => {
        const harness = await begin({ tools, plugins: declareGit });
        const rules = await jigCommand(harness, "rules git");
        assert.match(rules, /^git status: local read -> allow \(decision: table; classified by: declaration\)$/m);
        assert.match(rules, /^git push: external write -> ask \(decision: table; classified by: declaration\)$/m);
    });

    test("names a tool that asks every time", async () => {
        const harness = await begin({
            plugins: (api) =>
                api.declareTool({
                    tool: "always",
                    plugin: "jig-test",
                    classify: () => ({ environment: "local", effect: "write", always: "ask" }),
                }),
        });
        const rules = await jigCommand(harness, "rules always");
        assert.match(
            rules,
            /^always: local write -> ask \(decision: floor; classified by: declaration; always asks: no allow lowers it\)$/m,
        );
    });

    test("shows the effect of a rule in configuration", async () => {
        const harness = await begin({
            tools,
            config: {
                rules: [
                    { tool: "git", action: "status", decision: "deny" },
                    { tool: "read", decision: "ask" },
                ],
            },
            plugins: declareGit,
        });
        const rules = await jigCommand(harness, "rules");
        assert.match(rules, /^git status: local read -> deny \(decision: rule; classified by: declaration\)$/m);
        assert.match(rules, /^read: local read -> ask \(decision: rule; classified by: default\)$/m);
    });

    test("a classification rule that needs a parameter does not match a call with none", async () => {
        const config = {
            environments: { live: { kind: "production" } },
            classify: [{ tool: "other_db", param: "x", value: "y", environment: "live", effect: "write" }],
        };
        const harness = await begin({ tools, config });
        assert.match(
            await jigCommand(harness, "rules other_db"),
            /^other_db: external write -> ask \(decision: unknown/m,
        );
    });

    test("a declared tool that cannot be classified without a call says it decides per call", async () => {
        const harness = await begin({
            tools: [{ name: "fake" }],
            plugins: (api) =>
                api.declareTool({
                    tool: "fake",
                    plugin: "jig-test",
                    classify: (input) =>
                        input.env === undefined ? undefined : { environment: String(input.env), effect: "read" },
                }),
        });
        assert.match(
            await jigCommand(harness, "rules fake"),
            /^fake: decided per call by its declaration \(jig-test\)$/m,
        );
    });

    test("lists jig-core's own watch tool: list reads and stop writes, both on this machine", async () => {
        const harness = await begin();
        const rules = await jigCommand(harness, "rules watch");
        assert.match(rules, /^watch list: local read -> allow \(decision: table; classified by: declaration\)$/m);
        assert.match(rules, /^watch stop: local write -> allow \(decision: table; classified by: declaration\)$/m);
    });

    test("a tool that is named but unknown", async () => {
        const harness = await begin({ tools });
        assert.equal(await jigCommand(harness, "rules nothing"), "No tool named nothing.");
    });

    test("a long list is shown in a scrollable selector, a short one as a notice", async () => {
        const many = Array.from({ length: 30 }, (_, index) => ({
            name: `tool_${String(index).padStart(2, "0")}`,
            annotations: { readOnlyHint: true },
        }));
        const harness = await begin({ tools: many });
        await jigCommand(harness, "rules");
        assert.equal(harness.ui.selects.length, 1);
        const options = harness.ui.selects[0]?.options ?? [];
        assert.equal(
            options.findIndex((line) => line.startsWith("Protected paths")),
            32,
            "the 30 tools, and a line for each of the two actions of jig-core's own `watch`, then the protected paths",
        );
        await jigCommand(harness, "rules tool_03");
        assert.equal(harness.ui.selects.length, 1, "one line is a notice");
    });
});

describe("/jig records", () => {
    test("says where today's records are, and that there are none yet", async () => {
        const harness = await begin();
        const records = await jigCommand(harness, "records");
        assert.match(
            records,
            new RegExp(
                `Today's records: ${state.dir.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/records/\\d{4}-\\d{2}-\\d{2}\\.jsonl`,
            ),
        );
        assert.match(records, /Nothing recorded yet today\./);
    });

    test("summarises calls, errors, questions asked and time waited", async () => {
        const harness = await begin({
            ui: { select: () => "Allow" },
            plugins: (api) =>
                api.declareTool({
                    tool: "fake",
                    plugin: "jig-test",
                    classify: (input): CallClass => ({
                        environment: String(input.env ?? "local"),
                        effect: input.effect === "write" ? "write" : "read",
                    }),
                }),
        });
        await harness.call({ tool: "fake", input: { env: "local" }, result: text("ok") });
        await harness.call({
            tool: "fake",
            input: { env: "local" },
            run: () => {
                throw new Error("broke");
            },
        });
        await harness.call({ tool: "fake", input: { env: "external", effect: "write" } });
        await harness.call({ tool: "fake", input: { env: "elsewhere", effect: "write" } });
        const records = await jigCommand(harness, "records");
        assert.match(
            records,
            /4 calls \(1 errors, 1 blocked\), 1 questions asked, \d+ ms waited for you, 0 model turns/,
        );
    });
});
