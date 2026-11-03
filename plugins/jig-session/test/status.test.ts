// The status file each session writes for other programs to read. Pi is a stand-in that holds the handlers and fires
// them as Pi would; the files go to a temporary folder.
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { TestContext } from "node:test";
import { test } from "node:test";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { fileName, sessionsDir, sweep, writeAtomic } from "../src/files.ts";
import factory, { session } from "../src/index.ts";
import { terminalOf } from "../src/status.ts";
import type { SessionStatus, StatusFile } from "../src/status.ts";
import { titleFromNotes } from "../src/ticket.ts";

type Handler = (event: Record<string, unknown>, ctx: unknown) => unknown;

function temp(t: TestContext): string {
    const dir = mkdtempSync(path.join(tmpdir(), "jig-session-"));
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    return dir;
}

/** A stand-in for Pi: its handlers, its event bus, its session. */
function fakePi(cwd: string, id = "0193-abc") {
    const handlers = new Map<string, Handler[]>();
    const commands = new Map<string, { handler: (args: string, ctx: unknown) => Promise<void> }>();
    const notices: string[] = [];
    const bus = new Map<string, Array<(payload: unknown) => void>>();
    const entries: unknown[] = [];
    let active = ["read", "edit", "write"];
    const api = {
        on: (event: string, handler: Handler) => {
            handlers.set(event, [...(handlers.get(event) ?? []), handler]);
            return () => {};
        },
        events: {
            on: (name: string, listener: (payload: unknown) => void) => {
                bus.set(name, [...(bus.get(name) ?? []), listener]);
                return () => {};
            },
            emit: (name: string, payload: unknown) => {
                for (const listener of bus.get(name) ?? []) listener(payload);
            },
        },
        getActiveTools: () => active,
        getAllTools: () => [{}, {}, {}, {}],
        getThinkingLevel: () => "medium",
        registerCommand: (name: string, command: { handler: (args: string, ctx: unknown) => Promise<void> }) => {
            commands.set(name, command);
        },
    } as unknown as ExtensionAPI;
    const ctx = {
        cwd,
        model: { provider: "acme", id: "m-1", name: "Model One", contextWindow: 1000 },
        sessionManager: {
            getSessionId: () => id,
            getBranch: () => entries,
            getEntries: () => entries,
        },
        isIdle: () => true,
        ui: { notify: (text: string) => notices.push(text) },
        isProjectTrusted: () => false,
        getContextUsage: () => ({ tokens: 250, contextWindow: 1000, percent: 25 }),
    };
    const fire = async (event: string, payload: Record<string, unknown> = {}) => {
        for (const handler of handlers.get(event) ?? []) await handler({ type: event, ...payload }, ctx);
    };
    return {
        api,
        ctx,
        entries,
        handlers,
        commands,
        notices,
        fire,
        emit: api.events.emit,
        setTools: (names: string[]) => {
            active = names;
        },
    };
}

function rig(t: TestContext, extra: { env?: NodeJS.ProcessEnv; section?: (name: string) => unknown } = {}) {
    const root = temp(t);
    const state = path.join(root, "state");
    const agentDir = path.join(root, "agent");
    const cwd = path.join(root, "work");
    mkdirSync(cwd, { recursive: true });
    const pi = fakePi(cwd);
    let handle: StatusFile | undefined;
    session({
        env: extra.env ?? { HC_TERMINAL_ID: "t7" },
        stateDir: () => state,
        agentDir: () => agentDir,
        section: extra.section ?? (() => undefined),
        tickMs: 0,
        onStatus: (s) => {
            handle = s;
        },
    })(pi.api);
    const file = path.join(sessionsDir(state), fileName("0193-abc"));
    const read = () => JSON.parse(readFileSync(file, "utf8")) as SessionStatus;
    return { root, state, agentDir, cwd, pi, file, read, status: () => handle };
}

test("the default export is the factory Pi loads, and it only registers", () => {
    assert.equal(typeof factory, "function");
    const root = mkdtempSync(path.join(tmpdir(), "jig-session-"));
    try {
        const pi = fakePi(root);
        factory(pi.api);
        for (const event of ["session_start", "session_shutdown", "turn_end", "tool_execution_end", "model_select"]) {
            assert.ok(pi.handlers.has(event), event);
        }
        assert.deepEqual(readdirSync(root), []);
    } finally {
        rmSync(root, { recursive: true, force: true });
    }
});

test("a session writes its status file on start, with its terminal, and removes it on shutdown", async (t) => {
    const { pi, file, read, state } = rig(t);
    assert.equal(existsSync(file), false, "nothing before the session starts");
    await pi.fire("session_start", { reason: "startup" });
    const status = read();
    assert.equal(status.schema, 1);
    assert.equal(status.session, "0193-abc");
    assert.equal(status.pid, process.pid);
    assert.equal(status.terminal, "t7");
    assert.equal(status.terminalFrom, "HC_TERMINAL_ID");
    assert.deepEqual(status.model, { provider: "acme", id: "m-1", name: "Model One" });
    assert.equal(status.thinking, "medium");
    assert.equal(status.state, "idle");
    assert.deepEqual(status.context, { tokens: 250, window: 1000, percent: 25 });
    assert.deepEqual(status.tools, { active: 3, total: 4 });
    assert.equal(status.ticket, null);
    assert.deepEqual(readdirSync(sessionsDir(state)), ["0193-abc.json"], "no temporary file is left");

    await pi.fire("session_shutdown", { reason: "quit" });
    assert.equal(existsSync(file), false);
    await pi.fire("session_shutdown", { reason: "quit" }); // twice is fine
});

test("/session-file says where the status file is and which terminal it names", async (t) => {
    const { pi, file } = rig(t);
    await pi.commands.get("session-file")?.handler("", pi.ctx);
    assert.match(pi.notices.at(-1) ?? "", /no session has started; terminal t7 \(HC_TERMINAL_ID\)/);
    await pi.fire("session_start", { reason: "startup" });
    await pi.commands.get("session-file")?.handler("", pi.ctx);
    assert.equal(pi.notices.at(-1), `jig-session: status file ${file}; terminal t7 (HC_TERMINAL_ID)`);
});

test("the terminal comes from the first terminal host's variable that is set", () => {
    assert.deepEqual(terminalOf({ TMUX_PANE: "%3", HC_TERMINAL_ID: "t7" }), {
        terminal: "t7",
        terminalFrom: "HC_TERMINAL_ID",
    });
    assert.deepEqual(terminalOf({ TMUX_PANE: "%3", WEZTERM_PANE: "12" }), {
        terminal: "12",
        terminalFrom: "WEZTERM_PANE",
    });
    assert.deepEqual(terminalOf({ TMUX_PANE: "%3" }), { terminal: "%3", terminalFrom: "TMUX_PANE" });
    assert.deepEqual(terminalOf({ HC_TERMINAL_ID: " " }), { terminal: null, terminalFrom: null });
});

test("the file is updated after a turn, with the totals, and when the agent works", async (t) => {
    const { pi, read } = rig(t);
    await pi.fire("session_start", { reason: "startup" });
    await pi.fire("agent_start");
    assert.equal(read().state, "busy");
    pi.entries.push({
        type: "message",
        message: {
            role: "assistant",
            usage: { input: 10, output: 5, cacheRead: 2, cacheWrite: 1, cost: { total: 0.25 } },
        },
    });
    await pi.fire("turn_end");
    assert.deepEqual(read().usage, { input: 10, output: 5, cacheRead: 2, cacheWrite: 1, cost: 0.25 });
    await pi.fire("agent_settled");
    assert.equal(read().state, "idle");
});

test("edit and write calls become outputs: absolute, created or edited, newest first, once each", async (t) => {
    const { pi, read, cwd } = rig(t);
    await pi.fire("session_start", { reason: "startup" });
    writeFileSync(path.join(cwd, "old.md"), "x\n");
    const call = async (id: string, tool: string, file: string, isError = false) => {
        await pi.fire("tool_execution_start", { toolCallId: id, toolName: tool, args: {} });
        await pi.fire("tool_call", { toolCallId: id, toolName: tool, input: { path: file } });
        if (tool === "write" && !isError) writeFileSync(path.resolve(cwd, file), "y\n");
        await pi.fire("tool_execution_end", { toolCallId: id, toolName: tool, isError, result: {} });
    };
    await call("c1", "write", "new.md");
    await call("c2", "edit", "old.md");
    await call("c3", "edit", "missing.md", true);
    await call("c4", "write", "new.md"); // again: stays created, moves to the top
    await call("c5", "read", "old.md");
    const outputs = read().outputs;
    assert.deepEqual(
        outputs.map((o) => [path.relative(cwd, o.path), o.action]),
        [
            ["new.md", "created"],
            ["old.md", "edited"],
        ],
    );
    assert.ok(outputs.every((o) => path.isAbsolute(o.path) && !Number.isNaN(Date.parse(o.at))));
});

test("recent calls carry jig-core's decision and the outcome, never an argument", async (t) => {
    const { pi, read, file } = rig(t);
    await pi.fire("session_start", { reason: "startup" });
    const secret = ["very", "private", "value"].join("-");
    await pi.fire("tool_execution_start", { toolCallId: "a", toolName: "git", args: { message: secret } });
    pi.emit("jig:decision", { toolCallId: "a", tool: "git", action: "push", decision: "ask", answer: "allow" });
    await pi.fire("tool_execution_end", { toolCallId: "a", toolName: "git", isError: false, result: {} });
    await pi.fire("tool_execution_start", { toolCallId: "b", toolName: "bash", args: { command: secret } });
    pi.emit("jig:decision", { toolCallId: "b", tool: "bash", decision: "deny" });
    await pi.fire("tool_execution_end", { toolCallId: "b", toolName: "bash", isError: true, result: {} });
    await pi.fire("tool_execution_start", { toolCallId: "c", toolName: "read", args: {} });
    const recent = read().recent;
    assert.deepEqual(
        recent.map((r) => [r.tool, r.action ?? null, r.decision ?? null, r.answer ?? null, r.outcome]),
        [
            ["read", null, null, null, "running"],
            ["bash", null, "deny", null, "blocked"],
            ["git", "push", "ask", "allow", "ok"],
        ],
    );
    assert.equal(readFileSync(file, "utf8").includes(secret), false);
    for (let i = 0; i < 20; i++) await pi.fire("tool_execution_start", { toolCallId: `x${i}`, toolName: "ls" });
    assert.equal(read().recent.length, 15);
});

test("the ticket, its title and page, and its workflow's stages and pull requests are in the file", async (t) => {
    const root = temp(t);
    const tickets = path.join(root, "tickets");
    const sections: Record<string, unknown> = {
        memory: { folder: tickets },
        jira: { site: "https://example.atlassian.net/" },
    };
    const r = rig(t, { section: (name) => sections[name] });
    mkdirSync(path.join(r.agentDir, "workflows"), { recursive: true });
    writeFileSync(
        path.join(r.agentDir, "workflows", "feature.json"),
        JSON.stringify({
            name: "feature",
            stages: [{ id: "understand", goal: "Read" }, { id: "plan" }, { id: "build" }],
        }),
    );
    const dir = path.join(tickets, "PROJ-123");
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, "notes.md"), "# PROJ-123: Fix the login\n\n## Now\n");
    writeFileSync(
        path.join(dir, "workflow.json"),
        JSON.stringify({
            version: 1,
            workflow: "feature",
            ticket: "PROJ-123",
            stage: "plan",
            stageSince: "2026-01-01T00:00:00.000Z",
            observed: {
                "/w/orders-api": {
                    at: "2026-01-02T00:00:00.000Z",
                    branch: "feature/PROJ-123",
                    head: "abc",
                    pr: {
                        number: 7,
                        state: "OPEN",
                        isDraft: false,
                        headRefOid: "abc",
                        url: "https://github.com/acme/orders-api/pull/7",
                    },
                    checks: { pass: 3, fail: 1, pending: 0, total: 4 },
                },
            },
        }),
    );
    await r.pi.fire("session_start", { reason: "startup" });
    assert.equal(r.read().ticket, null);

    // /ticket PROJ-123: jig-memory appends its entry; the next check sees it.
    r.pi.entries.push({ type: "custom", customType: "jig-memory-ticket", data: { key: "PROJ-123" } });
    r.status()?.tick();
    const status = r.read();
    assert.deepEqual(status.ticket, {
        key: "PROJ-123",
        title: "Fix the login",
        url: "https://example.atlassian.net/browse/PROJ-123",
    });
    assert.deepEqual(
        status.workflow?.stages.map((s) => s.id),
        ["understand", "plan", "build"],
    );
    assert.equal(status.workflow?.current, "plan");
    assert.deepEqual(status.workflow?.prs, [
        {
            repo: "/w/orders-api",
            branch: "feature/PROJ-123",
            number: 7,
            state: "OPEN",
            draft: false,
            url: "https://github.com/acme/orders-api/pull/7",
            checks: { pass: 3, fail: 1, pending: 0, total: 4 },
            at: "2026-01-02T00:00:00.000Z",
        },
    ]);

    // /ticket off
    r.pi.entries.push({ type: "custom", customType: "jig-memory-ticket", data: { key: null } });
    r.status()?.tick();
    assert.equal(r.read().ticket, null);
    assert.equal(r.read().workflow, null);
});

test("a changed tool set is written by the next check", async (t) => {
    const { pi, read, status } = rig(t);
    await pi.fire("session_start", { reason: "startup" });
    pi.setTools(["read"]);
    status()?.tick();
    assert.deepEqual(read().tools, { active: 1, total: 4 });
});

test("a child Pi that a parent started writes nothing", async (t) => {
    const { pi, state } = rig(t, { env: { HC_TERMINAL_ID: "t7", PI_SUBAGENT_ID: "child-1" } });
    await pi.fire("session_start", { reason: "startup" });
    assert.equal(existsSync(state), false);
});

test("a write replaces the file in one step, and a sweep removes the files of Pis that ended", (t) => {
    const dir = temp(t);
    const file = path.join(dir, "deep", "s.json");
    writeAtomic(file, "one");
    writeAtomic(file, "two");
    assert.equal(readFileSync(file, "utf8"), "two");
    assert.deepEqual(readdirSync(path.dirname(file)), ["s.json"]);

    writeFileSync(path.join(dir, "gone.json"), JSON.stringify({ pid: 999_999_991 }));
    writeFileSync(path.join(dir, "here.json"), JSON.stringify({ pid: process.pid }));
    writeFileSync(path.join(dir, "x.json.999999991.ab12.tmp"), "");
    writeFileSync(path.join(dir, "other.json"), "not json");
    const removed = sweep(dir, (pid) => pid === process.pid);
    assert.deepEqual(removed.sort(), ["gone.json", "x.json.999999991.ab12.tmp"]);
    assert.ok(existsSync(path.join(dir, "here.json")));
    assert.equal(fileName("a/b:c"), "a_b_c.json");
});

test("a title is read from the notes' first line only when one follows the key", () => {
    assert.equal(titleFromNotes("# PROJ-123\n\n## Now\n", "PROJ-123"), undefined);
    assert.equal(titleFromNotes("# PROJ-123 — Fix it\n", "PROJ-123"), "Fix it");
    assert.equal(titleFromNotes("# PROJ-123 Fix it\n", "PROJ-123"), "Fix it");
    assert.equal(titleFromNotes("# Other\n", "PROJ-123"), undefined);
    assert.equal(titleFromNotes("# PROJ-1234 x\n", "PROJ-123"), undefined);
    assert.equal(titleFromNotes(undefined, "PROJ-123"), undefined);
});

test("the extension is listed in the package, after jig-core", () => {
    const manifest = JSON.parse(readFileSync(path.resolve(import.meta.dirname, "../../../package.json"), "utf8")) as {
        pi: { extensions: string[] };
    };
    const listed = manifest.pi.extensions;
    assert.ok(listed.includes("./plugins/jig-session/index.ts"));
    assert.ok(listed.indexOf("./plugins/jig-core/index.ts") < listed.indexOf("./plugins/jig-session/index.ts"));
});

test("outputs are rebuilt from the transcript after a restart; failed calls and other tools are left out", async (t) => {
    const { pi, read, cwd } = rig(t);
    const at = (n: number) => new Date(Date.UTC(2026, 0, 1, 0, n)).toISOString();
    const use = (id: string, name: string, file: string, n: number) => ({
        type: "message",
        timestamp: at(n),
        message: {
            role: "assistant",
            content: [{ type: "toolCall", id, name, arguments: { path: file, content: "secret" } }],
        },
    });
    const result = (id: string, isError: boolean, n: number) => ({
        type: "message",
        timestamp: at(n),
        message: { role: "toolResult", toolCallId: id, toolName: "x", isError },
    });
    pi.entries.push(
        use("a", "write", "plan.md", 1),
        result("a", false, 2),
        use("b", "edit", "plan.md", 3),
        result("b", false, 4),
        use("c", "edit", "missing.md", 5),
        result("c", true, 6),
        use("d", "read", "other.md", 7),
        result("d", false, 8),
        use("e", "edit", "old.md", 9),
        result("e", false, 10),
    );
    await pi.fire("session_start", { reason: "resume" });
    assert.deepEqual(
        read().outputs.map((o) => [path.relative(cwd, o.path), o.action, o.at]),
        [
            ["old.md", "edited", at(9)],
            ["plan.md", "created", at(3)],
        ],
    );
    assert.ok(!JSON.stringify(read().outputs).includes("secret"));
});

test("the active ticket's notes, plans and evidence are outputs; bookkeeping and saved tool outputs are not; merged by path", async (t) => {
    const root = temp(t);
    const tickets = path.join(root, "tickets");
    const dir = path.join(tickets, "PROJ-1");
    mkdirSync(path.join(dir, "evidence", "run1", "deep", "deeper"), { recursive: true });
    mkdirSync(path.join(dir, "history"), { recursive: true });
    for (const f of [
        "notes.md",
        "plan.md",
        "report.txt",
        "evidence/log.out",
        "evidence/run1/a.png",
        "ticket.json",
        "workflow.json",
        "history/h1.md",
        "image.png",
        "evidence/run1/deep/deeper/z.txt",
        "evidence/2026-01-02T10-20-30.123Z-bash-9713e1.txt",
    ]) {
        writeFileSync(path.join(dir, f), "x\n");
    }
    const { pi, read } = rig(t, {
        section: (name) => (name === "memory" ? { folder: tickets } : undefined),
    });
    // The transcript also wrote plan.md, later than the file's age on disk.
    const future = new Date(Date.now() + 60_000);
    pi.entries.push(
        { type: "custom", customType: "jig-memory-ticket", data: { key: "PROJ-1" } },
        {
            type: "message",
            timestamp: future.toISOString(),
            message: {
                role: "assistant",
                content: [{ type: "toolCall", id: "p", name: "write", arguments: { path: path.join(dir, "plan.md") } }],
            },
        },
        {
            type: "message",
            timestamp: future.toISOString(),
            message: { role: "toolResult", toolCallId: "p", isError: false },
        },
    );
    await pi.fire("session_start", { reason: "resume" });
    const outputs = read().outputs;
    const names = outputs.map((o) => path.relative(dir, o.path)).sort();
    assert.deepEqual(names, ["evidence/log.out", "evidence/run1/a.png", "notes.md", "plan.md", "report.txt"]);
    assert.equal(outputs[0]?.path, path.join(dir, "plan.md"));
    assert.equal(outputs[0]?.at, future.toISOString());
    assert.equal(outputs[0]?.action, "created");
    assert.ok(outputs.every((o) => o.repo === null));
});
