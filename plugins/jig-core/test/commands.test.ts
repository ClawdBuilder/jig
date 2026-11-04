// The /jig commands: status, setup, doctor, rules per tool and action, and records.
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
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
    h = await start(options);
    return h;
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

    test("setup refuses without a screen, and points at the doctor", async () => {
        const harness = await begin({ ui: false, plugins: setupSections });
        assert.match(await jigCommand(harness, "setup"), /Setup needs Pi's screen[\s\S]*\/jig doctor/);
        assert.equal(existsSync(path.join(harness.agentDir, "jig.json")), false);
    });

    test("setup cancel writes nothing", async () => {
        const harness = await begin({
            config: { lens: { port: "high" } },
            plugins: setupSections,
            ui: { select: (title) => (title.startsWith("Acme") ? "Cancel setup" : undefined) },
        });
        const file = path.join(harness.agentDir, "jig.json");
        const before = readFileSync(file, "utf8");
        assert.match(await jigCommand(harness, "setup"), /Nothing was written/);
        assert.equal(readFileSync(file, "utf8"), before);
    });

    test("setup asks again after a rejection, in plain words", async () => {
        let harnessInputs = 0;
        const harness = await begin({
            config: { lens: { port: "high" } },
            plugins: (api) =>
                api.config.registerSection("lens", (raw) =>
                    typeof (raw as { port?: unknown }).port === "number" ? [] : ["lens.port must be a number"],
                ),
            ui: {
                select: (title) => {
                    if (title.startsWith("Lens")) return "Answer these";
                    if (title === "Review these changes") return "Save these changes";
                    return undefined;
                },
                input: () => (harnessInputs++ === 0 ? "high" : "8080"),
                confirm: () => true,
            },
        });
        const shown = await jigCommand(harness, "setup");
        assert.match(shown, /Lens port must be a number\./);
        assert.match(shown, /Lens port: 8080 \(changed\)/);
        assert.equal(harness.ui.inputs.length, 2);
        assert.equal(JSON.parse(readFileSync(path.join(harness.agentDir, "jig.json"), "utf8")).lens.port, 8080);
    });

    test("setup shows the plain changes, the exact change on request, then writes and backs up", async () => {
        const harness = await begin({
            config: { lens: { port: "high" } },
            plugins: setupSections,
            ui: {
                select: (title) => {
                    if (title.startsWith("Acme") || title.startsWith("Lens")) return "Answer these";
                    if (title === "Review these changes") return "Show the exact change";
                    if (title === "The exact change") return "Only these fields change:";
                    return undefined;
                },
                input: (title) => (title === "Acme bastion login" ? "jdoe" : "8080"),
                confirm: () => true,
            },
        });
        const shown = await jigCommand(harness, "setup");
        assert.match(shown, /Acme bastion login: jdoe \(new\)/);
        assert.match(shown, /Lens port: 8080 \(changed\)/);
        assert.match(shown, /"user": "jdoe"/);
        assert.match(shown, /Run \/reload to apply/);

        const summary = harness.ui.notifications
            .map((entry) => entry.message)
            .find((message) => message.includes("Acme bastion login:"));
        assert.ok(summary);
        assert.ok(!summary.includes("{"));
        assert.doesNotMatch(summary, /\b(pass|env|cmd|file|keychain):|op:\/\//);
        assert.equal(harness.ui.confirms.length, 1);
        assert.equal(harness.ui.confirms[0]?.title, "Save these changes?");
        assert.match(harness.ui.confirms[0]?.message ?? "", /Acme bastion login: jdoe \(new\)/);
        assert.ok(!(harness.ui.confirms[0]?.message ?? "").includes("{"));

        const file = path.join(harness.agentDir, "jig.json");
        const after = JSON.parse(readFileSync(file, "utf8"));
        assert.equal(after.acme.bastion.user, "jdoe");
        assert.equal(after.lens.port, 8080);
        assert.equal(readdirSync(harness.agentDir).filter((name) => name.endsWith(".bak")).length, 1);
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
        assert.match(await jigCommand(harness), /Setup: 1 thing needs you\. Run \/jig setup\./);
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
        assert.match(status, /jig\.json: rule: is not a known field/);
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
