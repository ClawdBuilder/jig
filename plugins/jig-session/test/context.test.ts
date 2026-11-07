// The Context part of the status file: what fills the context, and the requests a reader sends to switch a tool or a skill
// or to reload. Pi is a stand-in that holds the handlers and the tool set; the files go to a temporary folder.
import assert from "node:assert/strict";
import {
    existsSync,
    mkdirSync,
    mkdtempSync,
    readdirSync,
    readFileSync,
    renameSync,
    rmSync,
    writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { TestContext } from "node:test";
import { test } from "node:test";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { formatSkillsForPrompt } from "@earendil-works/pi-coding-agent";
import {
    compose,
    hasReply,
    parsePrompt,
    reserveFrom,
    SKILLS_FRAME_CHARS,
    skillChars,
    tokensOf,
    toolChars,
} from "../src/breakdown.ts";
import { fileName, sessionsDir } from "../src/files.ts";
import { RELOAD_COMMAND, session } from "../src/index.ts";
import { buildReport, jigMessages, reportLines } from "../src/context-command.ts";
import { parseRequest, requestsDir, SWITCHES_ENTRY, sweepRequests, takeRequest } from "../src/requests.ts";
import type { SessionStatus } from "../src/status.ts";

type Handler = (event: Record<string, unknown>, ctx: unknown) => unknown;

function temp(t: TestContext): string {
    const dir = mkdtempSync(path.join(tmpdir(), "jig-context-"));
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    return dir;
}

const SKILLS = [
    {
        name: "pdf-tools",
        description: "Read PDFs. Use for <pdf> files & forms.",
        filePath: "/skills/pdf-tools/SKILL.md",
    },
    { name: "release", description: "Cut a release", filePath: "/skills/release/SKILL.md" },
];

/** A system prompt as Pi renders it: sections `<name>\n…\n</name>` joined by blank lines. */
function renderPrompt(
    skills: typeof SKILLS,
    files = [{ path: "/work/AGENTS.md", content: "Be brief.\nUse PROJ-123." }],
) {
    const sections = [
        "You are a coding assistant.",
        "<tools>\n- read: Read files\n</tools>",
        "<rules>\n- Be concise in your responses\n</rules>",
    ];
    if (files.length > 0)
        sections.push(
            `<project_context>\n${[
                "Project-specific instructions and guidelines:",
                ...files.map((f) => `<project_instructions path="${f.path}">\n${f.content}\n</project_instructions>`),
            ].join("\n\n")}\n</project_context>`,
        );
    const list = formatSkillsForPrompt(
        skills.map((s) => ({ ...s, baseDir: path.dirname(s.filePath), disableModelInvocation: false })) as never,
        "read",
    ).trim();
    if (list) sections.push(`<skills>\n${list}\n</skills>`);
    sections.push("<cwd>\n/work\n</cwd>");
    return sections.join("\n\n");
}

test("the prompt's parts are found: each context file, the skills section and the names it lists", () => {
    const files = [
        { path: "/work/AGENTS.md", content: "Be brief." },
        { path: "/work/sub/CLAUDE.md", content: "Two\nlines." },
    ];
    const text = renderPrompt(SKILLS, files);
    const parts = parsePrompt(text);
    assert.equal(parts.chars, text.length);
    assert.deepEqual(
        parts.files.map((f) => f.path),
        ["/work/AGENTS.md", "/work/sub/CLAUDE.md"],
    );
    const block = '<project_instructions path="/work/AGENTS.md">\nBe brief.\n</project_instructions>';
    assert.equal(parts.files[0]?.chars, block.length);
    const context = text.slice(text.indexOf("<project_context>"), text.indexOf("</project_context>") + 18);
    assert.equal(parts.contextChars, context.length);
    assert.deepEqual(parts.skillNames, ["pdf-tools", "release"]);
    // Each skill's entry and the frame add up to Pi's own skills section.
    const section = text.slice(text.indexOf("<skills>"), text.indexOf("</skills>") + 9);
    assert.equal(parts.skillsChars, section.length);
    const counted = SKILLS.reduce((n, s) => n + skillChars({ ...s, path: s.filePath }), SKILLS_FRAME_CHARS);
    assert.equal(counted, section.length);

    const bare = parsePrompt("A prompt another extension replaced whole.");
    assert.deepEqual([bare.contextChars, bare.skillsChars, bare.files, bare.skillNames], [0, 0, [], []]);
});

test("the breakdown: Messages is Pi's total less the other parts, and the free space leaves the reserve", () => {
    const prompt = parsePrompt(renderPrompt(SKILLS));
    const system = tokensOf(prompt.chars - prompt.contextChars - prompt.skillsChars);
    const files = tokensOf(prompt.contextChars);
    const fixed = system + files + 40 + 300;
    const base = { window: 10_000, prompt, toolsTokens: 300, skillsTokens: 40, reserve: 2000 };

    const measured = compose({ ...base, piTokens: 6000, hasReply: true });
    assert.deepEqual(measured.parts, { messages: 6000 - fixed, tools: 300, system, skills: 40, contextFiles: files });
    assert.deepEqual([measured.used, measured.usedFrom, measured.reserve, measured.free], [6000, "pi", 2000, 2000]);

    // Before the first reply Pi's figure is the messages alone: the parts are added to it.
    const fresh = compose({ ...base, piTokens: 25, hasReply: false });
    assert.deepEqual([fresh.used, fresh.usedFrom, fresh.parts.messages], [fixed + 25, "parts", 25]);

    // After a compaction, until the next reply, the total is unknown; it never goes below zero free.
    const compacted = compose({ ...base, piTokens: null, hasReply: true });
    assert.deepEqual([compacted.used, compacted.parts.messages, compacted.free], [null, null, null]);
    assert.equal(compose({ ...base, piTokens: 9900, hasReply: true }).free, 0);
    const declaration = '{"name":"read","description":"Read","parameters":{}}';
    assert.equal(toolChars({ name: "read", description: "Read", parameters: {} }), declaration.length);
});

test("the reserve comes from the compaction settings, the model's override first, and is 0 with compaction off", () => {
    const model = { provider: "acme", id: "m-1" };
    assert.equal(reserveFrom({}), 16384);
    assert.equal(reserveFrom({ compaction: { reserveTokens: 8000 } }, model), 8000);
    assert.equal(
        reserveFrom(
            { compaction: { reserveTokens: 8000, modelOverrides: { "acme/m-1": { reserveTokens: 3000 } } } },
            model,
        ),
        3000,
    );
    assert.equal(reserveFrom({ compaction: { enabled: false, reserveTokens: 8000 } }, model), 0);
    assert.equal(reserveFrom({ compaction: { reserveTokens: -1 } }), 16384);
});

test("a reply with usage, or a compaction, means Pi's total counts the prompt and the tools", () => {
    const reply = { type: "message", message: { role: "assistant", usage: { input: 5, output: 2 } } };
    const failed = { type: "message", message: { role: "assistant", stopReason: "error", usage: { input: 5 } } };
    assert.equal(hasReply([]), false);
    assert.equal(hasReply([{ type: "message", message: { role: "user" } }, failed]), false);
    assert.equal(hasReply([reply, { type: "message", message: { role: "user" } }]), true);
    assert.equal(hasReply([{ type: "compaction" }]), true);
});

test("a request is parsed strictly: schema 1, names to true or false, unknown fields ignored", () => {
    assert.deepEqual(parseRequest('{"schema":1,"id":"r1","tools":{"bash":false},"skills":{"pdf-tools":true},"x":1}'), {
        request: { schema: 1, id: "r1", tools: { bash: false }, skills: { "pdf-tools": true }, reload: false },
    });
    assert.equal(parseRequest('{"schema":1,"reload":true}').request?.reload, true);
    assert.match(parseRequest("{").error ?? "", /not JSON/);
    assert.match(parseRequest('{"schema":2}').error ?? "", /schema/);
    assert.match(parseRequest('{"schema":1,"tools":{"bash":"off"}}').error ?? "", /true or false/);
    assert.match(parseRequest('{"schema":1,"tools":{"a b":true}}').error ?? "", /true or false/);
    assert.match(parseRequest('{"schema":1,"reload":"yes"}').error ?? "", /reload/);
    assert.equal(parseRequest('{"schema":1,"id":"has space"}').request?.id, null);
});

test("a request file is taken whole, once; a reader's temporary file is never taken", (t) => {
    const dir = temp(t);
    const file = path.join(dir, "s.json");
    writeFileSync(`${file}.tmp`, '{"schema":1');
    assert.equal(takeRequest(file), undefined, "no request yet: the reader is still writing");
    renameSync(`${file}.tmp`, file);
    assert.equal(takeRequest(file), '{"schema":1');
    assert.equal(takeRequest(file), undefined, "taken once");
    assert.deepEqual(readdirSync(dir), []);
    writeFileSync(file, "x".repeat(70 * 1024));
    assert.equal(takeRequest(file), null, "too large: refused unread");
});

test("request files of sessions that ended are swept; this session's and fresh temporary files stay", (t) => {
    const dir = temp(t);
    for (const name of ["mine.json", "gone.json", "live.json", "x.json.tmp"]) writeFileSync(path.join(dir, name), "{}");
    const removed = sweepRequests(dir, (name) => name === "live.json", "mine.json");
    assert.deepEqual(removed, ["gone.json"]);
    assert.deepEqual(readdirSync(dir).sort(), ["live.json", "mine.json", "x.json.tmp"]);
    assert.deepEqual(
        sweepRequests(dir, () => true, "mine.json", Date.now() + 120_000),
        ["x.json.tmp"],
    );
});

/** A stand-in for Pi with a tool set, skills, settings and a session that keeps appended entries. */
function fakePi(cwd: string) {
    const handlers = new Map<string, Handler[]>();
    const commands = new Map<string, { handler: (args: string, ctx: unknown) => Promise<void> }>();
    const entries: unknown[] = [];
    const sent: Array<{ text: string; options: unknown }> = [];
    const tools = [
        { name: "read", description: "Read a file", parameters: { type: "object" }, exposure: "direct" },
        { name: "bash", description: "Run a command", parameters: { type: "object" }, exposure: "direct" },
        { name: "git", description: "Git", parameters: { type: "object" }, exposure: "direct" },
        { name: "secret_helper", description: "Hidden", parameters: {}, exposure: "hidden" },
    ];
    let active = ["read", "bash", "git"];
    let idle = true;
    const api = {
        on: (event: string, handler: Handler) => {
            handlers.set(event, [...(handlers.get(event) ?? []), handler]);
            return () => {};
        },
        events: { on: () => () => {}, emit: () => {} },
        getActiveTools: () => [...active],
        getAllTools: () => tools,
        // Pi ignores unknown and hidden names.
        setActiveTools: (names: string[]) => {
            active = names.filter((n) => tools.some((t) => t.name === n && t.exposure !== "hidden"));
        },
        getCommands: () => [
            { name: "session-file", source: "extension" },
            ...SKILLS.map((s) => ({
                name: `skill:${s.name}`,
                description: s.description,
                source: "skill",
                sourceInfo: { path: s.filePath },
            })),
        ],
        getSettings: () => ({ compaction: { reserveTokens: 100 } }),
        appendEntry: (customType: string, data: unknown) => entries.push({ type: "custom", customType, data }),
        sendUserMessage: (text: string, options: unknown) => sent.push({ text, options }),
        getThinkingLevel: () => "medium",
        registerCommand: (name: string, command: { handler: (args: string, ctx: unknown) => Promise<void> }) => {
            commands.set(name, command);
        },
    } as unknown as ExtensionAPI;
    let component: { render(width: number): string[]; handleInput?(data: string): void } | undefined;
    const theme = {
        fg: (_role: string, text: string) => text,
        bg: (_role: string, text: string) => text,
        bold: (text: string) => text,
        italic: (text: string) => text,
        underline: (text: string) => text,
    };
    const ctx = {
        cwd,
        model: { provider: "acme", id: "m-1", name: "Model One", contextWindow: 1000 },
        sessionManager: { getSessionId: () => "0193-abc", getBranch: () => entries, getEntries: () => entries },
        isIdle: () => idle,
        hasUI: true,
        ui: {
            notify: () => {},
            custom: async (factory: Function) => {
                component = factory({ terminal: { rows: 40 }, requestRender: () => {} }, theme, {}, () => {});
                return undefined;
            },
        },
        isProjectTrusted: () => false,
        getContextUsage: () => ({ tokens: 20, contextWindow: 1000, percent: 2 }),
        getSystemPrompt: () => renderPrompt(SKILLS),
    };
    const fire = async (event: string, payload: Record<string, unknown> = {}) => {
        for (const handler of handlers.get(event) ?? []) await handler({ type: event, ...payload }, ctx);
    };
    return {
        api,
        ctx,
        entries,
        sent,
        commands,
        fire,
        component: () => component,
        active: () => active,
        setIdle: (value: boolean) => {
            idle = value;
        },
    };
}

function rig(t: TestContext) {
    const root = temp(t);
    const state = path.join(root, "state");
    const cwd = path.join(root, "work");
    mkdirSync(cwd, { recursive: true });
    const pi = fakePi(cwd);
    let tick = () => {};
    const load = () =>
        session({
            env: { HC_TERMINAL_ID: "t7" },
            stateDir: () => state,
            agentDir: () => path.join(root, "agent"),
            section: () => undefined,
            tickMs: 0,
            onStatus: (s) => {
                tick = () => s.tick();
            },
        })(pi.api);
    load();
    const file = path.join(sessionsDir(state), fileName("0193-abc"));
    const requestFile = path.join(requestsDir(state), fileName("0193-abc"));
    const read = () => JSON.parse(readFileSync(file, "utf8")) as SessionStatus;
    // As the Context panel writes it: a temporary file, then a rename.
    const ask = (request: unknown) => {
        writeFileSync(`${requestFile}.tmp`, typeof request === "string" ? request : JSON.stringify(request));
        renameSync(`${requestFile}.tmp`, requestFile);
        tick();
    };
    return { pi, state, file, requestFile, read, ask, load, tick: () => tick() };
}

test("the status file carries the breakdown and the tools, skills and context files behind it", async (t) => {
    const { pi, read, requestFile } = rig(t);
    await pi.fire("session_start", { reason: "startup" });
    const detail = read().contextDetail;
    assert.ok(detail);
    assert.deepEqual(
        detail.tools.map((x) => [x.name, x.on]),
        [
            ["read", true],
            ["bash", true],
            ["git", true],
        ],
        "a hidden tool cannot be declared, so it is not listed",
    );
    assert.deepEqual(
        detail.skills.map((s) => [s.name, s.on, s.listed]),
        [
            ["pdf-tools", true, true],
            ["release", true, true],
        ],
    );
    assert.deepEqual(
        detail.files.map((f) => f.path),
        ["/work/AGENTS.md"],
    );
    assert.equal(detail.window, 1000);
    assert.equal(detail.reserve, 100);
    assert.equal(detail.usedFrom, "parts", "no reply yet: the parts are added to Pi's estimate of the messages");
    assert.equal(detail.parts.messages, 20);
    assert.equal(
        detail.parts.tools,
        detail.tools.reduce((n, x) => n + x.tokens, 0),
    );
    assert.equal(read().lastRequest, null);
    assert.ok(existsSync(path.dirname(requestFile)), "the requests folder is made for the reader");
});

test("/context shows the same breakdown the status file carries, and fits a narrow terminal", async (t) => {
    const { pi, read } = rig(t);
    await pi.fire("session_start", { reason: "startup" });
    const detail = read().contextDetail;
    assert.ok(detail);
    await pi.commands.get("context")?.handler("", pi.ctx);
    const component = pi.component();
    assert.ok(component);
    const lines = component.render(60);
    assert.ok(
        lines.every((line) => line.length <= 60),
        "no line is wider than the terminal",
    );
    const all = lines.join("\n");
    assert.match(all, new RegExp(String(detail.used)));
    assert.match(all, /Context · Model One/);
    assert.match(all, /estimate/);
    assert.match(all, /[█░]/);
    assert.deepEqual(
        ["System prompt", "Context files", "Skills", "Tools", "Messages"].filter((part) => all.includes(part)).sort(),
        ["Context files", "Messages", "Skills", "System prompt", "Tools"],
    );
});

test("a request turns a tool off and on again: applied, answered in the file, saved, nothing else changed", async (t) => {
    const { pi, read, ask, requestFile } = rig(t);
    await pi.fire("session_start", { reason: "startup" });
    ask({ schema: 1, id: "r1", tools: { bash: false } });
    assert.deepEqual(pi.active(), ["read", "git"]);
    const status = read();
    assert.deepEqual(status.lastRequest && { ...status.lastRequest, at: "" }, {
        id: "r1",
        ok: true,
        message: "bash off",
        at: "",
    });
    assert.equal(status.contextDetail?.tools.find((x) => x.name === "bash")?.on, false);
    assert.deepEqual(status.tools, { active: 2, total: 4 });
    assert.deepEqual(
        status.contextDetail?.skills.map((s) => s.on),
        [true, true],
        "the skills are untouched",
    );
    assert.equal(existsSync(requestFile), false, "the request is taken");
    assert.deepEqual(pi.entries.at(-1), {
        type: "custom",
        customType: SWITCHES_ENTRY,
        data: { tools: { bash: false }, skillsOff: [] },
    });

    ask({ schema: 1, id: "r2", tools: { bash: true } });
    assert.deepEqual([...pi.active()].sort(), ["bash", "git", "read"]);
    assert.equal(read().lastRequest?.id, "r2");
});

test("unknown and hidden names are ignored, a bad request is refused, and neither changes anything", async (t) => {
    const { pi, read, ask } = rig(t);
    await pi.fire("session_start", { reason: "startup" });
    ask({ schema: 1, id: "r1", tools: { nope: false, secret_helper: true }, skills: { ghost: false } });
    assert.deepEqual(pi.active(), ["read", "bash", "git"]);
    assert.equal(read().lastRequest?.ok, false);
    assert.match(read().lastRequest?.message ?? "", /ignored, not in this session: nope, secret_helper, ghost/);

    ask({ schema: 1, id: "r2", tools: { git: false, nope: true } });
    assert.deepEqual(pi.active(), ["read", "bash"]);
    assert.equal(read().lastRequest?.ok, true, "the known name is applied");
    assert.match(read().lastRequest?.message ?? "", /git off; ignored, not in this session: nope/);

    ask("{ not json");
    assert.deepEqual(pi.active(), ["read", "bash"]);
    assert.deepEqual([read().lastRequest?.ok, read().lastRequest?.id], [false, null]);
    assert.match(read().lastRequest?.message ?? "", /^Refused: the request is not JSON/);
    assert.equal(pi.sent.length, 0, "no reload, no message to the model");
});

test("a skill switched off leaves the next turn's prompt, for this session, and comes back after a reload", async (t) => {
    const { pi, read, ask, load } = rig(t);
    await pi.fire("session_start", { reason: "startup" });
    ask({ schema: 1, id: "s1", skills: { "pdf-tools": false } });
    assert.match(read().lastRequest?.message ?? "", /skill pdf-tools off from the next turn/);
    const detail = read().contextDetail;
    assert.deepEqual(
        detail?.skills.map((s) => [s.name, s.on]),
        [
            ["pdf-tools", false],
            ["release", true],
        ],
    );
    const one = skillChars({ name: "release", description: "Cut a release", path: "/skills/release/SKILL.md" });
    assert.equal(detail?.parts.skills, tokensOf(one + SKILLS_FRAME_CHARS), "only the skills that are on count");

    const turn = { systemPromptOptions: { skills: SKILLS.map((s) => ({ ...s })) } };
    await pi.fire("before_agent_start", turn);
    assert.deepEqual(
        turn.systemPromptOptions.skills.map((s) => s.name),
        ["release"],
    );

    // A reload makes a new extension; the switch comes back from the session's entry.
    await pi.fire("session_shutdown", { reason: "reload" });
    load();
    await pi.fire("session_start", { reason: "reload" });
    const again = { systemPromptOptions: { skills: SKILLS.map((s) => ({ ...s })) } };
    await pi.fire("before_agent_start", again);
    assert.deepEqual(
        again.systemPromptOptions.skills.map((s) => s.name),
        ["release"],
    );
});

test("a tool switched off stays off after a reload, and a skill Pi never lists is marked so", async (t) => {
    const { pi, read, ask, load } = rig(t);
    await pi.fire("session_start", { reason: "startup" });
    ask({ schema: 1, id: "t1", tools: { git: false } });
    await pi.fire("session_shutdown", { reason: "reload" });
    pi.api.setActiveTools(["read", "bash", "git"]); // Pi's reload registers every tool again
    load();
    await pi.fire("session_start", { reason: "reload" });
    assert.deepEqual(pi.active(), ["read", "bash"]);

    const turn = {
        systemPromptOptions: { skills: SKILLS.map((s, i) => ({ ...s, disableModelInvocation: i === 1 })) },
    };
    await pi.fire("before_agent_start", turn);
    pi.ctx.isIdle = () => true;
    await pi.fire("turn_end");
    assert.deepEqual(
        read().contextDetail?.skills.map((s) => [s.name, s.listed, s.tokens > 0]),
        [
            ["pdf-tools", true, true],
            ["release", false, false],
        ],
    );
});

test("Reload runs /session-reload when Pi is idle, waits for the agent when it works, and says when it is done", async (t) => {
    const { pi, read, ask, load, file } = rig(t);
    await pi.fire("session_start", { reason: "startup" });
    assert.ok(pi.commands.has(RELOAD_COMMAND));

    ask({ schema: 1, id: "re1", reload: true });
    assert.deepEqual(pi.sent, [{ text: `/${RELOAD_COMMAND}`, options: { expandPromptTemplates: true } }]);
    assert.deepEqual([read().lastRequest?.reload, read().lastRequest?.message], ["waiting", "reloading"]);

    // Pi reloads: the old extension keeps its file, the new one says the reload is done.
    await pi.fire("session_shutdown", { reason: "reload" });
    assert.ok(existsSync(file), "the file stays through a reload");
    load();
    await pi.fire("session_start", { reason: "reload" });
    assert.deepEqual([read().lastRequest?.id, read().lastRequest?.reload], ["re1", "done"]);
    assert.match(read().lastRequest?.message ?? "", /reloaded$/);

    // While the agent works the reload waits for it to settle.
    pi.setIdle(false);
    await pi.fire("agent_start");
    ask({ schema: 1, id: "re2", reload: true });
    assert.equal(pi.sent.length, 1);
    assert.match(read().lastRequest?.message ?? "", /when the agent is idle/);
    pi.setIdle(true);
    await pi.fire("agent_settled");
    assert.equal(pi.sent.length, 2);

    // The command waits for the agent, then reloads.
    const calls: string[] = [];
    await pi.commands.get(RELOAD_COMMAND)?.handler("", {
        waitForIdle: async () => calls.push("wait"),
        reload: async () => calls.push("reload"),
    });
    assert.deepEqual(calls, ["wait", "reload"]);

    await pi.fire("session_shutdown", { reason: "quit" });
    assert.equal(existsSync(file), false);
});

test("the report splits tools into Pi, each Jig plugin and deferred names", () => {
    const report = buildReport({
        detail: {
            window: 1000,
            used: 400,
            usedFrom: "pi",
            reserve: 100,
            free: 500,
            parts: { messages: 100, tools: 80, system: 120, skills: 40, contextFiles: 60 },
            tools: [
                { name: "read", on: true, tokens: 10 },
                { name: "git", on: true, tokens: 30 },
                { name: "jira", on: true, tokens: 40 },
                { name: "mongo", on: false, tokens: 50 },
            ],
            skills: [],
            files: [],
        },
        model: "test",
        declared: new Map([
            ["git", "jig-git"],
            ["jira", "jig-jira"],
            ["mongo", "jig-mongo"],
        ]),
        deferred: ["mongo"],
    });
    assert.deepEqual(
        report.groups.map((group) => [group.label, group.tools.map((tool) => tool.name)]),
        [
            ["Pi built-in / other", ["read"]],
            ["jig-git", ["git"]],
            ["jig-jira", ["jira"]],
        ],
    );
    assert.deepEqual(report.deferred, ["mongo"]);
    const lines = reportLines(report, 70, (_role, text) => text).join("\n");
    assert.match(lines, /Deferred \(found by tool_search\)/);
    assert.match(lines, /mongo\s+not in context/);
    assert.doesNotMatch(lines, /jig-mongo/);
});

test("Jig's messages are found by custom type, apart from review follow-ups", () => {
    const messages = jigMessages([
        { type: "custom", customType: "jig-memory-notes", content: "notes" },
        { type: "custom", customType: "jig-memory-recall", content: "12345678" },
        { type: "message", message: { role: "user", content: "Interactive code review r1 was submitted." } },
        { type: "message", message: { role: "user", content: "A conversation message." } },
    ]);
    assert.deepEqual(
        messages.map((m) => [m.label, m.count]),
        [
            ["Review follow-ups", 1],
            ["Ticket notes", 1],
            ["Recall results", 1],
        ],
    );
    assert.ok(messages.every((m) => m.tokens > 0));
});
