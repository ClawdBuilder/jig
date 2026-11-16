// Compacting while idle: the session is left alone until the person has been away long enough, the context is big enough
// and nothing is waiting. One line says what happened. The clock is the test's, so no real time passes.
import assert from "node:assert/strict";
import { test } from "node:test";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { publishJig, withdrawJig } from "../../jig-core/src/client.ts";
import type { JigApi } from "../../jig-core/src/contract.ts";
import {
    DEFAULT_AFTER_SECONDS,
    DEFAULT_MIN_TOKENS,
    MAX_AFTER_SECONDS,
    MIN_AFTER_SECONDS,
    MIN_MIN_TOKENS,
    idleCompact,
    idleCompactionLine,
    idleCompactionOf,
    validateSessionSection,
} from "../src/idle-compact.ts";
import { session } from "../src/index.ts";

type Handler = (event: Record<string, unknown>, ctx: unknown) => unknown;

/** A clock the test moves itself: `advance` runs the timers that are due by then, as Node would. */
function fakeClock() {
    let now = 0;
    let next = 1;
    const timers = new Map<number, { at: number; callback: () => void }>();
    return {
        timers: {
            setTimeout: (callback: () => void, ms: number) => {
                const id = next++;
                timers.set(id, { at: now + ms, callback });
                return id;
            },
            clearTimeout: (handle: unknown) => {
                timers.delete(handle as number);
            },
        },
        advance(ms: number): void {
            now += ms;
            for (const [id, timer] of [...timers].sort((left, right) => left[1].at - right[1].at)) {
                if (timer.at > now) continue;
                timers.delete(id);
                timer.callback();
            }
        },
        pending: (): number => timers.size,
    };
}

interface Completion {
    tokensBefore: number;
    estimatedTokensAfter?: number;
}

/** A stand-in for Pi's events, and for the context a compaction is started from. */
function fakePi() {
    const handlers = new Map<string, Handler[]>();
    const notices: Array<{ text: string; type?: string }> = [];
    const compactions: number[] = [];
    const state = { idle: true, pending: false, tokens: 150_000, draft: "", fails: false, throws: false };
    const ctx = {
        cwd: "/work",
        mode: "tui",
        isIdle: () => state.idle,
        hasPendingMessages: () => state.pending,
        getContextUsage: () => {
            if (state.throws) throw new Error("no usage");
            return { tokens: state.tokens, contextWindow: 200_000, percent: 0 };
        },
        compact: (options: { onComplete?: (result: Completion) => void; onError?: (error: Error) => void }) => {
            compactions.push(state.tokens);
            if (state.fails) options.onError?.(new Error("the summary failed"));
            else options.onComplete?.({ tokensBefore: 152_300, estimatedTokensAfter: 23_800 });
        },
        ui: {
            notify: (text: string, type?: string) => notices.push({ text, ...(type === undefined ? {} : { type }) }),
            getEditorText: () => state.draft,
        },
    };
    const api = {
        on: (event: string, handler: Handler) => {
            handlers.set(event, [...(handlers.get(event) ?? []), handler]);
            return () => {};
        },
    } as unknown as ExtensionAPI;
    const fire = (event: string, payload: Record<string, unknown> = {}): void => {
        for (const handler of handlers.get(event) ?? []) handler({ type: event, ...payload }, ctx);
    };
    return { api, ctx, notices, compactions, state, fire };
}

const sectionOf = (session: unknown) => (name: string) => (name === "session" ? session : undefined);

function start(session: unknown, tokens = 150_000) {
    const world = fakePi();
    world.state.tokens = tokens;
    const clock = fakeClock();
    idleCompact(world.api, { section: sectionOf(session), timers: clock.timers });
    return { ...world, clock };
}

test("off by default: no section, no timer", () => {
    const w = start(undefined);
    w.fire("agent_settled");
    assert.equal(w.clock.pending(), 0);
    w.clock.advance(600_000);
    assert.deepEqual(w.compactions, []);
});

test("compactWhenIdle false is off, not an empty setting", () => {
    const w = start({ compactWhenIdle: false });
    w.fire("agent_settled");
    assert.equal(w.clock.pending(), 0);
    w.clock.advance(600_000);
    assert.deepEqual(w.compactions, []);
});

test("an aborted settle starts no timer: the person pressed Escape", () => {
    const w = start({ compactWhenIdle: {} });
    w.fire("agent_settled", { aborted: true });
    assert.equal(w.clock.pending(), 0);
});

test("after the idle time it compacts once, and says the tokens before and after", () => {
    const w = start({ compactWhenIdle: { afterSeconds: 270 } });
    w.fire("agent_settled");
    w.clock.advance(269_000);
    assert.deepEqual(w.compactions, [], "not a moment before the time");
    w.clock.advance(1_000);
    assert.deepEqual(w.compactions, [150_000], "compacted once");
    assert.deepEqual(
        w.notices.map((notice) => notice.text),
        ["jig-session: compacted while idle: 152,300 → 23,800 tokens"],
    );
    assert.equal(w.notices[0]?.type, "info");
});

test("once per idle stretch: it fires again only after the next settle", () => {
    const w = start({ compactWhenIdle: {} });
    w.fire("agent_settled");
    w.clock.advance(DEFAULT_AFTER_SECONDS * 1000);
    assert.equal(w.compactions.length, 1);
    w.clock.advance(600_000);
    assert.equal(w.compactions.length, 1, "the stretch was used");
    w.fire("agent_settled");
    w.clock.advance(DEFAULT_AFTER_SECONDS * 1000);
    assert.equal(w.compactions.length, 2);
});

test("a context below the threshold is not worth a summary", () => {
    const w = start({ compactWhenIdle: {} }, DEFAULT_MIN_TOKENS - 1);
    w.fire("agent_settled");
    w.clock.advance(600_000);
    assert.deepEqual(w.compactions, []);
    assert.deepEqual(w.notices, []);
});

test("a session that is not idle, or has a message waiting, is left alone", () => {
    for (const [name, change] of [
        ["busy", (state: { idle: boolean }) => (state.idle = false)],
        ["a message waits", (state: { pending: boolean }) => (state.pending = true)],
    ] as const) {
        const w = start({ compactWhenIdle: {} });
        change(w.state as never);
        w.fire("agent_settled");
        w.clock.advance(600_000);
        assert.deepEqual(w.compactions, [], name);
    }
});

test("the next thing anyone does cancels the wait", () => {
    for (const event of ["agent_start", "turn_start", "tool_call", "input", "ui_prompt_start", "session_shutdown"]) {
        const w = start({ compactWhenIdle: {} });
        w.fire("agent_settled");
        w.clock.advance(100_000);
        w.fire(event);
        assert.equal(w.clock.pending(), 0, `${event} cancelled the timer`);
        w.clock.advance(600_000);
        assert.deepEqual(w.compactions, [], `${event} left nothing to fire`);
    }
});

test("typing in the editor, or submitting it, keeps the session as it is", () => {
    // A draft at the moment the timer fires: the person is here, writing.
    const draft = start({ compactWhenIdle: {} });
    draft.state.draft = "half a question";
    draft.fire("agent_settled");
    draft.clock.advance(600_000);
    assert.deepEqual(draft.compactions, []);
    // A submitted prompt is the `input` event, which cancels the wait (covered above).
});

test("a print or json session is not compacted: no person is coming back", () => {
    for (const mode of ["print", "json"]) {
        const w = start({ compactWhenIdle: {} });
        (w.ctx as { mode: string }).mode = mode;
        w.fire("agent_settled");
        assert.equal(w.clock.pending(), 0, `${mode} starts no timer`);
        w.clock.advance(600_000);
        assert.deepEqual(w.compactions, [], mode);
    }
});

test("a setting turned off while the person is away starts nothing", () => {
    const w = fakePi();
    const clock = fakeClock();
    let session: unknown = { compactWhenIdle: {} };
    idleCompact(w.api, { section: () => session, timers: clock.timers });
    w.fire("agent_settled");
    session = { compactWhenIdle: false };
    clock.advance(600_000);
    assert.deepEqual(w.compactions, []);
});

test("a timer that cannot read the context says so instead of throwing", () => {
    const w = start({ compactWhenIdle: {} });
    w.state.throws = true;
    w.fire("agent_settled");
    w.clock.advance(600_000);
    assert.deepEqual(
        w.notices.map((notice) => [notice.text, notice.type]),
        [["jig-session: could not compact while idle: no usage", "warning"]],
    );
    assert.deepEqual(w.compactions, []);
});

test("a compaction that fails says so plainly and does not throw", () => {
    const w = start({ compactWhenIdle: {} });
    w.state.fails = true;
    w.fire("agent_settled");
    w.clock.advance(600_000);
    assert.deepEqual(
        w.notices.map((notice) => [notice.text, notice.type]),
        [["jig-session: could not compact while idle: the summary failed", "warning"]],
    );
});

test("a result without an estimate still names the tokens before", () => {
    const w = start({ compactWhenIdle: {} });
    const clock = fakeClock();
    const pi = fakePi();
    pi.state.tokens = 150_000;
    const ctx = {
        ...pi.ctx,
        compact: (options: { onComplete: (result: Completion) => void }) =>
            options.onComplete({ tokensBefore: 152_300 }),
    };
    const handlers = new Map<string, Handler[]>();
    const api = {
        on: (event: string, handler: Handler) => {
            handlers.set(event, [...(handlers.get(event) ?? []), handler]);
            return () => {};
        },
    } as unknown as ExtensionAPI;
    idleCompact(api, { section: sectionOf({ compactWhenIdle: {} }), timers: clock.timers });
    for (const handler of handlers.get("agent_settled") ?? []) handler({ type: "agent_settled" }, ctx);
    clock.advance(600_000);
    assert.deepEqual(
        pi.notices.map((notice) => notice.text),
        ["jig-session: compacted while idle: 152,300 tokens before"],
    );
    assert.deepEqual(w.compactions, [], "the earlier world was not used");
});

test("the section is checked with plain bounds, and a misspelt key is named", () => {
    assert.deepEqual(validateSessionSection({}), []);
    assert.deepEqual(validateSessionSection({ compactWhenIdle: false }), []);
    assert.deepEqual(validateSessionSection({ compactWhenIdle: true }), []);
    assert.deepEqual(validateSessionSection({ compactWhenIdle: {} }), []);
    assert.deepEqual(
        validateSessionSection({ compactWhenIdle: { afterSeconds: MIN_AFTER_SECONDS } }),
        [],
        "the minimum is allowed",
    );
    assert.deepEqual(
        validateSessionSection({ compactWhenIdle: { afterSeconds: MAX_AFTER_SECONDS } }),
        [],
        "the maximum is allowed",
    );
    assert.deepEqual(validateSessionSection({ compactWhenIdle: { afterSeconds: MIN_AFTER_SECONDS - 1 } }), [
        `session.compactWhenIdle.afterSeconds: must be a whole number of seconds from ${MIN_AFTER_SECONDS} to ${MAX_AFTER_SECONDS}; the prompt cache lives about five minutes`,
    ]);
    assert.deepEqual(validateSessionSection({ compactWhenIdle: { afterSeconds: MAX_AFTER_SECONDS + 1 } }), [
        `session.compactWhenIdle.afterSeconds: must be a whole number of seconds from ${MIN_AFTER_SECONDS} to ${MAX_AFTER_SECONDS}; the prompt cache lives about five minutes`,
    ]);
    assert.equal(validateSessionSection({ compactWhenIdle: { afterSeconds: 90.5 } }).length, 1);
    assert.deepEqual(validateSessionSection({ compactWhenIdle: { minTokens: MIN_MIN_TOKENS - 1 } }), [
        `session.compactWhenIdle.minTokens: must be a whole number of tokens, at least ${MIN_MIN_TOKENS}; a smaller context is not worth a summary`,
    ]);
    assert.match(
        validateSessionSection({ compactWhenIdle: { afterSecond: 90 } })[0] ?? "",
        /Did you mean "afterSeconds"\?/,
    );
    assert.deepEqual(validateSessionSection({ compactWhenIdle: "yes" }), [
        "session.compactWhenIdle: must be true, false, or an object such as { afterSeconds: 270 }",
    ]);
    assert.equal(validateSessionSection("session")[0], "session: must be an object");
    assert.match(validateSessionSection({ nope: 1 })[0] ?? "", /session\.nope: unknown field/);
});

test("the setting and its defaults, and what /jig says", () => {
    assert.equal(idleCompactionOf(undefined), undefined);
    assert.equal(idleCompactionOf({}), undefined);
    assert.equal(idleCompactionOf({ compactWhenIdle: false }), null);
    assert.deepEqual(idleCompactionOf({ compactWhenIdle: true }), {
        afterSeconds: DEFAULT_AFTER_SECONDS,
        minTokens: DEFAULT_MIN_TOKENS,
    });
    assert.deepEqual(idleCompactionOf({ compactWhenIdle: { afterSeconds: 90 } }), {
        afterSeconds: 90,
        minTokens: DEFAULT_MIN_TOKENS,
    });
    assert.equal(idleCompactionLine(sectionOf(undefined)), undefined);
    assert.equal(idleCompactionLine(sectionOf({ compactWhenIdle: false })), "Idle compaction: off");
    assert.equal(
        idleCompactionLine(sectionOf({ compactWhenIdle: { afterSeconds: 90, minTokens: 2_000 } })),
        "Idle compaction: after 90 s idle, from 2,000 tokens",
    );
});

test("a child session registers the section too, so the same jig.json stays valid there", () => {
    const sections: string[] = [];
    let line: (() => string[]) | undefined;
    const api = {
        config: { registerSection: (name: string) => sections.push(name), section: () => undefined },
        status: { register: (_plugin: string, given: () => string[]) => (line = given) },
    };
    publishJig(api as unknown as JigApi);
    try {
        // A child returns from the factory before any command or event: only the registration must happen there.
        session({ env: { PI_SUBAGENT_ID: "child-1" } })({} as ExtensionAPI);
        assert.deepEqual(sections, ["session"], "the section is known in a child session");
        assert.equal(line, undefined, "a child shows no /jig line");
    } finally {
        withdrawJig(api as unknown as JigApi);
    }
});

test("the extension registers the section and the /jig line when jig-core is there", () => {
    const sections: string[] = [];
    let lines: (() => string[]) | undefined;
    const api = {
        config: {
            registerSection: (name: string, check: (raw: unknown) => string[]) => {
                sections.push(name);
                assert.deepEqual(check({}), []);
            },
            section: () => undefined,
        },
        status: {
            register: (_plugin: string, given: () => string[]) => {
                lines = given;
            },
        },
    };
    publishJig(api as unknown as JigApi);
    try {
        const pi = {
            on: () => () => {},
            events: { on: () => () => {} },
            registerCommand: () => {},
            getActiveTools: () => [],
            getAllTools: () => [],
            getCommands: () => [],
            getSettings: () => ({}),
            getThinkingLevel: () => "medium",
            appendEntry: () => {},
            sendUserMessage: async () => {},
        } as unknown as ExtensionAPI;
        session({
            env: {},
            section: sectionOf({ compactWhenIdle: { afterSeconds: 90, minTokens: 2_000 } }),
            onStatus: () => {},
        })(pi);
        assert.deepEqual(sections, ["session"]);
        assert.deepEqual(lines?.(), ["Idle compaction: after 90 s idle, from 2,000 tokens"]);
    } finally {
        withdrawJig(api as unknown as JigApi);
    }
});
