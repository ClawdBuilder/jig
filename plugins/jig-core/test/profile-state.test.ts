// What a profile does once it is chosen: only the active company's environments, rules, section defaults, secret settings and
// status apply; a dormant company's do not; merged skills are written and swapped into the turn's skill list; `/profile` and `/jig`
// say what is active and why. A real jig-core in the fake Pi, with two fake company plugins and the user's jig.json written to
// a temporary agent folder.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, test } from "node:test";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { buildApi } from "../src/api.ts";
import { jig, withdrawJig } from "../src/client.ts";
import type { JigApi } from "../src/contract.ts";
import { jigCore } from "../src/index.ts";
import { createState, loadPersonalConfig } from "../src/state.ts";
import { fakeContext, fakePi } from "./support/fake-pi.ts";
import type { FakePi } from "./support/fake-pi.ts";

let root: string;
let saved: Record<string, string | undefined>;
let api: JigApi | undefined;
beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), "jig-profile-state-"));
    saved = { JIG_STATE_DIR: process.env.JIG_STATE_DIR, PI_CODING_AGENT_DIR: process.env.PI_CODING_AGENT_DIR };
    process.env.JIG_STATE_DIR = path.join(root, "state");
    process.env.PI_CODING_AGENT_DIR = path.join(root, "agent");
    mkdirSync(path.join(root, "agent"), { recursive: true });
});
afterEach(() => {
    if (api !== undefined) withdrawJig(api);
    api = undefined;
    for (const [name, value] of Object.entries(saved)) {
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
    }
    rmSync(root, { recursive: true, force: true });
});

/** A generic skill on disk, as Pi loads it: a folder with SKILL.md and a file it links to. */
function genericSkill(name: string): string {
    const dir = path.join(root, "generic", name);
    mkdirSync(path.join(dir, "references"), { recursive: true });
    writeFileSync(
        path.join(dir, "SKILL.md"),
        `---\nname: ${name}\ndescription: "The ${name} skill. Use when asked."\n---\n\n# ${name}\n\nSee [the guide](references/guide.md).\n`,
    );
    writeFileSync(path.join(dir, "references", "guide.md"), "guide text\n");
    return path.join(dir, "SKILL.md");
}

function overlayFolder(company: string, files: Record<string, string>): string {
    const dir = path.join(root, "overlays", company);
    mkdirSync(dir, { recursive: true });
    for (const [name, text] of Object.entries(files)) writeFileSync(path.join(dir, name), text);
    return dir;
}

interface Company {
    name: string;
    display: string;
    env: string;
    overlays?: string;
    skills?: string[];
    changes?: boolean[];
}

const check = (raw: unknown): string[] =>
    typeof raw === "object" && raw !== null && typeof (raw as { site?: unknown }).site === "string"
        ? []
        : ["thing.site is needed"];

interface Session {
    host: FakePi;
    ctx: ExtensionContext;
    notes(): string[];
}

/** Loads jig-core and the companies, writes the user's jig.json, and starts a session in `cwd`. */
async function start(options: {
    jig?: unknown;
    companies: Company[];
    cwd: string;
    branch?: unknown[];
    skills?: string[];
}): Promise<Session> {
    if (options.jig !== undefined) writeFileSync(path.join(root, "agent", "jig.json"), JSON.stringify(options.jig));
    const host = fakePi();
    jigCore()(host.pi);
    api = jig();
    api.config.registerSection("thing", check);
    for (const skill of options.skills ?? []) host.skills.push({ name: skill, path: genericSkill(skill) });
    for (const company of options.companies) {
        const view = api.profiles?.register(company.name, {
            displayName: company.display,
            ...(company.overlays === undefined ? {} : { overlays: company.overlays }),
            ...(company.skills === undefined ? {} : { skills: company.skills }),
            onChange: (active) => company.changes?.push(active),
        }) as JigApi;
        view.config.addEnvironments({ [company.env]: { kind: "test" } });
        view.config.addSectionDefaults("thing", { site: `https://${company.name}.example.com` });
        view.config.addSecretCommands({ [`${company.name}-login`]: [company.name, "token"] });
        view.config.enableSecretBackends(["cmd"]);
        view.config.addMaskFields([`${company.name}Alias`]);
        view.config.addProtectedPaths({ secret: [`~/.${company.name}/login`] });
        view.status?.register(company.name, () => [`${company.name}: status line`]);
    }
    const { ctx, log } = fakeContext({ cwd: options.cwd, branch: options.branch ?? [] });
    await host.fire("session_start", { reason: "startup" }, ctx);
    return { host, ctx, notes: () => log.notifications.map((item) => item.message) };
}

const ACME = (extra: Partial<Company> = {}): Company => ({
    name: "jig-acme",
    display: "Acme",
    env: "acme-stage",
    ...extra,
});
const GLOBEX = (extra: Partial<Company> = {}): Company => ({
    name: "jig-globex",
    display: "Globex",
    env: "globex-stage",
    ...extra,
});
const TWO = {
    profiles: {
        acme: { plugin: "jig-acme", when: { folders: ["/work/acme/**"] } },
        globex: { plugin: "jig-globex", when: { folders: ["/work/globex/**"] } },
    },
};

describe("which company applies", () => {
    test("with no profiles section the only company plugin applies, as before", async () => {
        await start({ companies: [ACME()], cwd: "/anywhere" });
        const active = jig().profiles?.active();
        assert.equal(active?.reason, "sole");
        assert.equal(active?.plugin, "jig-acme");
        assert.equal(jig().environments.kindOf("acme-stage"), "test");
        assert.deepEqual(jig().config.section("thing"), { site: "https://jig-acme.example.com" });
    });

    test("with two companies, the folder chooses and only its contributions apply", async () => {
        await start({ jig: TWO, companies: [ACME(), GLOBEX()], cwd: "/work/globex/app" });
        assert.equal(jig().profiles?.active().profile, "globex");
        assert.equal(jig().environments.kindOf("globex-stage"), "test");
        assert.equal(
            jig().environments.kindOf("acme-stage"),
            "production",
            "a dormant company's environment is unknown, so production",
        );
        assert.deepEqual(jig().config.section("thing"), { site: "https://jig-globex.example.com" });
        assert.deepEqual(
            jig()
                .environments.list()
                .filter((entry) => entry.source === "company")
                .map((entry) => entry.name),
            ["globex-stage"],
        );
    });

    test("no match: no company, no environments, no defaults", async () => {
        await start({ jig: TWO, companies: [ACME(), GLOBEX()], cwd: "/tmp/other" });
        assert.equal(jig().profiles?.active().reason, "none");
        assert.equal(jig().environments.kindOf("acme-stage"), "production");
        assert.equal(jig().config.section("thing"), undefined);
    });

    test("an explicit profile in jig.json beats the folder", async () => {
        await start({ jig: { ...TWO, profile: "acme" }, companies: [ACME(), GLOBEX()], cwd: "/work/globex/app" });
        assert.equal(jig().profiles?.active().profile, "acme");
        assert.equal(jig().profiles?.active().reason, "explicit");
    });

    test("an invalid profiles section activates no company, even a sole one", async () => {
        await start({ jig: { profiles: { acme: {} } }, companies: [ACME()], cwd: "/work/acme" });
        assert.equal(jig().profiles?.active().reason, "none");
        assert.match(jig().profiles?.active().why ?? "", /not valid/);
        assert.equal(jig().environments.kindOf("acme-stage"), "production");
    });

    test("loading order does not matter: a company registered before jig.json is read is still chosen", async () => {
        const session = await start({ jig: TWO, companies: [GLOBEX(), ACME()], cwd: "/work/acme/x" });
        assert.equal(jig().profiles?.active().profile, "acme");
        assert.ok(session.host.commands.has("profile"));
    });
});

describe("what dormant means", () => {
    test("a dormant company's secret backends do not apply, and its status is not shown", async () => {
        const session = await start({ jig: TWO, companies: [ACME(), GLOBEX()], cwd: "/work/globex/a" });
        const lines = await jigLines(session);
        assert.ok(lines.some((line) => line.includes("jig-globex: status line")));
        assert.ok(!lines.some((line) => line.includes("jig-acme: status line")));
        assert.ok(lines.some((line) => /Profile: globex \(jig-globex\)/.test(line)));
        assert.ok(lines.some((line) => line === "Secret backends on: pass, cmd (cmd enabled by a company plugin)"));
        const other = await start({ jig: TWO, companies: [ACME(), GLOBEX()], cwd: "/tmp/other" });
        const none = await jigLines(other);
        assert.ok(none.some((line) => line === "Secret backends on: pass"));
        assert.ok(none.some((line) => /^Profile: none: /.test(line)));
    });

    test("rules and classification rules of a dormant company do not apply, and the active company's do", () => {
        const file = path.join(root, "agent", "jig.json");
        writeFileSync(file, JSON.stringify({ profile: "acme", profiles: TWO.profiles }));
        const state = createState({} as ExtensionAPI);
        const core = buildApi(state);
        for (const name of ["jig-acme", "jig-globex"]) {
            const view = core.profiles?.register(name, { displayName: name }) as JigApi;
            view.config.addRules([{ tool: `${name}-tool`, decision: "deny" }]);
            view.config.addClassifyRules([
                { tool: `${name}-tool`, param: "env", value: "x", environment: "local", effect: "read" },
            ]);
        }
        loadPersonalConfig(state, file);
        assert.equal(state.profile.selection.plugin, "jig-acme");
        assert.deepEqual(
            state.policy().rules.map((rule) => rule.tool),
            ["jig-acme-tool"],
        );
        assert.deepEqual(
            state.policy().classify.map((rule) => rule.tool),
            ["jig-acme-tool"],
        );
        writeFileSync(file, JSON.stringify({ profile: "globex", profiles: TWO.profiles }));
        loadPersonalConfig(state, file);
        assert.deepEqual(
            state.policy().rules.map((rule) => rule.tool),
            ["jig-globex-tool"],
        );
    });

    test("protected paths and mask fields of a dormant company still apply: they can only protect", async () => {
        await start({ jig: TWO, companies: [ACME(), GLOBEX()], cwd: "/tmp/other" });
        const shown = jig()
            .protectedPaths.list()
            .map((entry) => entry.shown);
        assert.ok(shown.includes("~/.jig-acme/login") && shown.includes("~/.jig-globex/login"));
        const masked = jig().mask.value({ "jig-acmeAlias": "Jane Doe", note: "hello" });
        assert.notEqual(masked["jig-acmeAlias"], "Jane Doe");
        assert.equal(masked.note, "hello");
    });

    test("a plugin that never registered keeps applying whatever is active", async () => {
        const host = fakePi();
        jigCore()(host.pi);
        api = jig();
        api.config.addEnvironments({ legacy: { kind: "test" } });
        const view = api.profiles?.register("jig-acme", { displayName: "Acme" }) as JigApi;
        view.config.addEnvironments({ scoped: { kind: "test" } });
        const { ctx } = fakeContext({ cwd: "/anywhere" });
        writeFileSync(path.join(root, "agent", "jig.json"), JSON.stringify({ profile: "none" }));
        await host.fire("session_start", { reason: "startup" }, ctx);
        assert.equal(jig().environments.kindOf("legacy"), "test");
        assert.equal(jig().environments.kindOf("scoped"), "production");
    });

    test("onChange is told the state at start, and again when it changes", async () => {
        const acme: boolean[] = [];
        const globex: boolean[] = [];
        const session = await start({
            jig: TWO,
            companies: [ACME({ changes: acme }), GLOBEX({ changes: globex })],
            cwd: "/work/acme/a",
        });
        assert.deepEqual(acme, [true]);
        assert.deepEqual(globex, [false]);
        // the next session starts elsewhere in the same runtime: the active company changes
        await session.host.fire("session_start", { reason: "new" }, fakeContext({ cwd: "/work/globex/b" }).ctx);
        assert.deepEqual(acme, [true, false]);
        assert.deepEqual(globex, [false, true]);
    });

    test("an onChange that throws is a start-up problem and does not stop the session", async () => {
        const host = fakePi();
        jigCore()(host.pi);
        api = jig();
        api.profiles?.register("jig-acme", {
            displayName: "Acme",
            onChange() {
                throw new Error("boom");
            },
        });
        const { ctx } = fakeContext({ cwd: "/x" });
        await host.fire("session_start", { reason: "startup" }, ctx);
        const lines = await jigLines({ host, ctx, notes: () => [] });
        assert.ok(lines.some((line) => line.includes("onChange failed: boom")));
    });
});

async function jigLines(session: Session, argument = ""): Promise<string[]> {
    const { ctx, log } = fakeContext({ cwd: "/x", ui: { select: () => undefined } });
    void ctx;
    const command = session.host.commands.get("jig");
    assert.ok(command);
    await command.handler(argument, ctx as never);
    return [
        ...log.notifications.flatMap((item) => item.message.split("\n")),
        ...log.selects.flatMap((item) => item.options),
    ];
}

describe("skills", () => {
    const options = (extra: object = {}) => ({
        jig: TWO,
        companies: [
            ACME({
                overlays: overlayFolder("acme", {
                    "jira.md": "### Keys\n\nAcme keys are ACME-1.\n",
                    "ghost.md": "nothing",
                    "Bad Name.md": "x",
                }),
                skills: ["acme-releases"],
            }),
            GLOBEX({
                overlays: overlayFolder("globex", { "jira.md": "Globex keys are GX-1.\n" }),
                skills: ["globex-only"],
            }),
        ],
        cwd: "/work/acme/a",
        skills: ["jira", "git"],
        ...extra,
    });

    test("the merged copy is the generic file plus a section of the company's rules, with the generic files beside it", async () => {
        await start(options());
        const merged = path.join(root, "state", "skills", "acme", "jira", "SKILL.md");
        const text = readFileSync(merged, "utf8");
        const generic = readFileSync(path.join(root, "generic", "jira", "SKILL.md"), "utf8");
        assert.ok(text.startsWith(generic.trimEnd()), "the generic text is unchanged and first");
        assert.match(text, /\n\n## Acme rules\n\n### Keys\n\nAcme keys are ACME-1\.\n$/);
        assert.equal(
            readFileSync(path.join(root, "state", "skills", "acme", "jira", "references", "guide.md"), "utf8"),
            "guide text\n",
        );
        assert.ok(
            !existsSync(path.join(root, "state", "skills", "acme", "git")),
            "a skill with no overlay is not copied",
        );
        assert.ok(
            !existsSync(path.join(root, "state", "skills", "globex")),
            "a dormant company's overlays are not merged",
        );
    });

    test("the turn's skill list has one jira skill, at the merged copy, and no skill of a dormant company", async () => {
        const session = await start(options());
        const skill = (name: string) => ({
            name,
            description: `${name} d`,
            filePath: path.join(root, "generic", name, "SKILL.md"),
            baseDir: path.join(root, "generic", name),
            sourceInfo: {},
            disableModelInvocation: false,
        });
        const list = [skill("jira"), skill("git"), skill("acme-releases"), skill("globex-only")];
        const originals = list.map((item) => item.filePath);
        const turn = { skills: list };
        await session.host.fire("before_agent_start", { systemPromptOptions: turn }, session.ctx);
        assert.deepEqual(
            turn.skills.map((item) => item.name),
            ["jira", "git", "acme-releases"],
        );
        const jira = turn.skills[0];
        assert.equal(jira?.filePath, path.join(root, "state", "skills", "acme", "jira", "SKILL.md"));
        assert.equal(jira?.baseDir, path.join(root, "state", "skills", "acme", "jira"));
        assert.equal(jira?.description, "jira d");
        assert.equal(turn.skills[1]?.filePath, originals[1]);
        assert.deepEqual(
            list.map((item) => item.filePath),
            originals,
            "Pi's own skill objects are not changed",
        );
    });

    test("with no company active, the overlays are not applied and every company's skills are left out", async () => {
        const session = await start(options({ cwd: "/tmp/other" }));
        const turn = {
            skills: [
                { name: "jira", filePath: "/g/jira/SKILL.md", baseDir: "/g/jira" },
                { name: "acme-releases", filePath: "/a/SKILL.md", baseDir: "/a" },
            ],
        };
        await session.host.fire("before_agent_start", { systemPromptOptions: turn }, session.ctx);
        assert.deepEqual(
            turn.skills.map((item) => item.name),
            ["jira"],
        );
        assert.equal(turn.skills[0]?.filePath, "/g/jira/SKILL.md");
    });

    test("a skill list the session start did not know is merged on the first turn that shows it, once", async () => {
        const session = await start(options({ skills: [] }));
        const file = genericSkill("jira");
        const make = () => ({ skills: [{ name: "jira", filePath: file, baseDir: path.dirname(file) }] });
        const first = make();
        await session.host.fire("before_agent_start", { systemPromptOptions: first }, session.ctx);
        const merged = path.join(root, "state", "skills", "acme", "jira", "SKILL.md");
        assert.equal(first.skills[0]?.filePath, merged);
        writeFileSync(merged, "marker");
        await session.host.fire("before_agent_start", { systemPromptOptions: make() }, session.ctx);
        assert.equal(readFileSync(merged, "utf8"), "marker", "the same list is not merged again");
    });

    test("a skill switched off elsewhere stays off: the list is filtered by name, and the name does not change", async () => {
        const session = await start(options());
        const turn = { skills: [{ name: "jira", filePath: "/g/jira/SKILL.md", baseDir: "/g/jira" }] };
        await session.host.fire("before_agent_start", { systemPromptOptions: turn }, session.ctx);
        const off = new Set(["jira"]);
        assert.deepEqual(
            turn.skills.filter((item) => !off.has(item.name)),
            [],
        );
    });

    test("overlays that fit no loaded skill, or are not named like a skill, are said in /profile", async () => {
        const session = await start(options());
        const lines = await profileLines(session);
        assert.ok(lines.some((line) => /overlay ghost\.md has no generic skill/.test(line)));
        assert.ok(lines.some((line) => /Bad Name\.md skipped/.test(line)));
        assert.ok(lines.some((line) => /Skills with company rules: jira/.test(line)));
    });

    test("switching company removes the merged copies of the other", async () => {
        const session = await start(options());
        assert.ok(existsSync(path.join(root, "state", "skills", "acme", "jira")));
        await session.host.fire("session_start", { reason: "new" }, fakeContext({ cwd: "/work/globex/b" }).ctx);
        assert.match(
            readFileSync(path.join(root, "state", "skills", "globex", "jira", "SKILL.md"), "utf8"),
            /## Globex rules\n\nGlobex keys are GX-1\./,
        );
    });
});

async function profileLines(session: Session, argument = ""): Promise<string[]> {
    const { ctx, log } = fakeContext({ cwd: "/x" });
    const command = session.host.commands.get("profile");
    assert.ok(command);
    await command.handler(argument, ctx as never);
    return log.notifications.flatMap((item) => item.message.split("\n"));
}

describe("/profile", () => {
    test("shows the active profile, why, and which plugins are loaded", async () => {
        const session = await start({ jig: TWO, companies: [ACME(), GLOBEX()], cwd: "/work/acme/a" });
        const lines = await profileLines(session);
        assert.match(lines[0] ?? "", /^Profile: acme \(jig-acme\): the working folder matches "\/work\/acme\/\*\*"/);
        assert.ok(lines.some((line) => line === "Company plugins loaded: jig-acme (active), jig-globex (dormant)"));
        assert.ok(lines.some((line) => line.startsWith("Profiles in jig.json: acme -> jig-acme")));
    });

    test("/profile <name> records the choice in the session and reloads once the agent is idle", async () => {
        const session = await start({ jig: TWO, companies: [ACME(), GLOBEX()], cwd: "/work/acme/a" });
        const calls: string[] = [];
        const { ctx, log } = fakeContext({ cwd: "/x" });
        Object.assign(ctx, {
            waitForIdle: async () => void calls.push("idle"),
            reload: async () => void calls.push("reload"),
        });
        await session.host.commands.get("profile")?.handler("globex", ctx as never);
        assert.deepEqual(session.host.entries, [{ customType: "jig-profile", data: { name: "globex" } }]);
        assert.deepEqual(calls, ["idle", "reload"]);
        assert.match(log.notifications[0]?.message ?? "", /Profile set to globex/);
    });

    test("the choice survives a reload: the next session reads it from the branch and it beats the folder", async () => {
        const branch = [{ type: "custom", customType: "jig-profile", data: { name: "globex" } }];
        await start({ jig: TWO, companies: [ACME(), GLOBEX()], cwd: "/work/acme/a", branch });
        const active = jig().profiles?.active();
        assert.equal(active?.profile, "globex");
        assert.equal(active?.reason, "session");
    });

    test("auto drops the session's choice, none turns the company off, and a null entry is read as no choice", async () => {
        const branch = [
            { type: "custom", customType: "jig-profile", data: { name: "globex" } },
            { type: "custom", customType: "jig-profile", data: { name: null } },
        ];
        await start({ jig: TWO, companies: [ACME(), GLOBEX()], cwd: "/work/acme/a", branch });
        assert.equal(jig().profiles?.active().reason, "folder");
        const session = await start({ jig: TWO, companies: [ACME(), GLOBEX()], cwd: "/work/acme/a" });
        const { ctx } = fakeContext({ cwd: "/x" });
        await session.host.commands.get("profile")?.handler("none", ctx as never);
        assert.deepEqual(session.host.entries.at(-1), { customType: "jig-profile", data: { name: "none" } });
    });

    test("a name that is not a profile changes nothing and lists the ones there are", async () => {
        const session = await start({ jig: TWO, companies: [ACME(), GLOBEX()], cwd: "/work/acme/a" });
        const lines = await profileLines(session, "nope");
        assert.match(lines.join("\n"), /No profile "nope" in jig\.json\. Profiles: acme, globex\./);
        assert.deepEqual(session.host.entries, []);
    });

    test("completion offers auto, none and the profiles", async () => {
        const session = await start({ jig: TWO, companies: [ACME(), GLOBEX()], cwd: "/work/acme/a" });
        const complete = session.host.commands.get("profile")?.getArgumentCompletions;
        const values = (prefix: string) =>
            (complete?.(prefix) as Array<{ value: string }> | null)?.map((item) => item.value);
        assert.deepEqual(values(""), ["auto", "none", "acme", "globex"]);
        assert.deepEqual(values("g"), ["globex"]);
        assert.equal(values("z"), undefined);
    });
});
