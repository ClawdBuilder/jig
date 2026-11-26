// Pi's host for the engine: each member answers from Pi's extension API and the context of one event, as the code did before the
// engine existed. The calls that go through it in a real session are tested in gate.test.ts, results.test.ts and index.test.ts.
import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, test } from "node:test";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { piHost, piToolInfo, sessionIdOf } from "../src/pi-host.ts";
import { createState } from "../src/state.ts";
import type { WatchMessage } from "../src/watch/message.ts";
import { fakeContext, fakePi } from "./support/fake-pi.ts";
import { tempState } from "./support/state.ts";

const temp = tempState();
const saved = { role: process.env.JIG_AGENT_ROLE, parent: process.env.JIG_PARENT_SESSION };
beforeEach(() => {
    temp.start();
    delete process.env.JIG_AGENT_ROLE;
    delete process.env.JIG_PARENT_SESSION;
});
afterEach(() => {
    temp.stop();
    for (const [name, value] of [
        ["JIG_AGENT_ROLE", saved.role],
        ["JIG_PARENT_SESSION", saved.parent],
    ] as const) {
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
    }
});

const TOOLS = [
    { name: "reader", annotations: { readOnlyHint: true }, sourceInfo: { source: "pkg-a" } },
    { name: "plain" },
];

describe("what the host says about the event", () => {
    test("the folder, the screen and the session come from the context, and the agent from Pi", () => {
        const fake = fakePi(TOOLS);
        const state = createState(fake.pi);
        state.piVersion = "1.5.2";
        const { ctx } = fakeContext({ session: "s-1", cwd: "/work/here" });
        const host = piHost(state, ctx);
        assert.deepEqual(host.agent, { name: "pi", version: "1.5.2" });
        assert.deepEqual(host.session, { id: "s-1", role: "main" });
        assert.equal(host.cwd, "/work/here");
        assert.equal(host.canAsk, true);
        assert.equal(piHost(state, fakeContext({ ui: false }).ctx).canAsk, false);
        assert.equal(host.canAskProtected, process.stdin.isTTY === true);
    });

    test("a child agent says who started it and what it is for, as its records do", () => {
        process.env.JIG_PARENT_SESSION = "parent-9";
        process.env.JIG_AGENT_ROLE = "reviewer";
        const state = createState(fakePi().pi);
        assert.deepEqual(piHost(state, fakeContext({ session: "s-2" }).ctx).session, {
            id: "s-2",
            parent: "parent-9",
            role: "reviewer",
        });
        process.env.JIG_AGENT_ROLE = "";
        assert.equal(piHost(state, fakeContext().ctx).session.role, "main");
    });

    test('a session id Pi cannot give is "unknown", and the host built with no context cannot ask', async () => {
        const state = createState(fakePi().pi);
        const broken = {
            sessionManager: {
                getSessionId: () => {
                    throw new Error("gone");
                },
            },
        } as unknown as ExtensionContext;
        assert.equal(sessionIdOf(broken), "unknown");
        const between = piHost(state);
        assert.equal(between.canAsk, false);
        assert.equal(between.cwd, process.cwd());
        const answer = await between.ask(
            { header: "h", preview: { summary: "s" }, kind: "dialog" },
            new AbortController().signal,
        );
        assert.deepEqual(answer, { answer: "decline", dismissed: true, waitedMs: 0 });
    });

    test("the tool list gives the source and the hints of a tool, and nothing for a tool Pi does not list", () => {
        const fake = fakePi(TOOLS);
        assert.deepEqual(piToolInfo(fake.pi, "reader"), { source: "pkg-a", annotations: { readOnlyHint: true } });
        assert.deepEqual(piToolInfo(fake.pi, "plain"), {});
        assert.equal(piToolInfo(fake.pi, "absent"), undefined);
        const state = createState(fake.pi);
        assert.deepEqual(piHost(state).toolInfo("reader"), { source: "pkg-a", annotations: { readOnlyHint: true } });
    });
});

describe("what the host does", () => {
    test("a question goes to Pi's screens with the context's own switch, and the answer comes back as Pi gave it", async () => {
        const state = createState(fakePi().pi);
        const { ctx, log } = fakeContext({ ui: { select: () => "Allow for this session" } });
        const answer = await piHost(state, ctx).ask(
            { header: "git push", preview: { summary: "pushes two commits" }, kind: "dialog" },
            new AbortController().signal,
        );
        assert.equal(answer === "later", false);
        assert.equal((answer as { answer: string }).answer, "allow-session");
        assert.match(log.selects[0]?.title ?? "", /git push\npushes two commits/);
    });

    test("a notice goes to the screen of the session, as a warning for warn, and it is not shown when there is no screen", () => {
        const state = createState(fakePi().pi);
        const host = piHost(state);
        assert.equal(host.notify("nobody sees this", "info"), false);
        const { ctx, log } = fakeContext();
        state.screen = ctx.ui;
        assert.equal(host.notify("first", "info"), true);
        assert.equal(host.notify("second", "warn"), true);
        assert.deepEqual(log.notifications, [
            { message: "first", type: "info" },
            { message: "second", type: "warning" },
        ]);
        state.screen = {
            notify() {
                throw new Error("a screen from an earlier runtime");
            },
        };
        assert.equal(host.notify("third", "info"), false);
    });

    test("waking the model sends the message as a follow-up that starts a turn, and an event goes to the bus", async () => {
        const fake = fakePi();
        const host = piHost(createState(fake.pi));
        const message: WatchMessage = {
            customType: "jig-watch",
            content: "done",
            display: true,
            details: { watches: [] },
        };
        assert.equal(await host.wake(message), true);
        assert.deepEqual(fake.sent, [{ message, options: { deliverAs: "followUp", triggerTurn: true } }]);
        host.emit("jig:test", { a: 1 });
        assert.deepEqual(fake.emitted, [{ channel: "jig:test", data: { a: 1 } }]);
    });

    test("the state made for Pi has the host for what happens between events, and the list of active tools", () => {
        const fake = fakePi(TOOLS);
        const state = createState(fake.pi);
        assert.notEqual(state.host, undefined);
        assert.equal(state.pi, fake.pi);
        assert.deepEqual(state.activeTools?.(), ["reader", "plain"]);
    });
});
