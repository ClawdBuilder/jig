// Who a fetch may reach. A fetch is a read, so it does not ask, but it offers the user's ssh key to the remote's host, and
// the host comes from a configuration the agent can write. Only a host the user's own configuration names as a forge runs
// without a question; every other one asks, and a "this session" answer is remembered for that host alone.
import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import { JIG_EVENTS } from "../../jig-core/src/contract.ts";
import type { GateCall } from "../../jig-core/src/contract.ts";
import { createFetchGuard, hostOfRemoteUrl, inspectFetch, isTrustedFetch } from "../src/fetch-guard.ts";
import { gitSettings } from "../src/config.ts";
import { git, makeRepo } from "./support/repos.ts";
import { setupHarness } from "./support/harness.ts";
import type { Harness } from "./support/harness.ts";

let h: Harness;
let counter = 0;

before(() => {
    h = setupHarness();
});
beforeEach(() => {
    h.reset();
    h.jig.setSection("git", {});
});
after(() => h.cleanup());

/** A fake Pi whose event bus a test can fire on, as jig-core does when it publishes a decision. */
function fakePi() {
    const listeners = new Map<string, Array<(event: unknown) => void>>();
    const pi = {
        events: {
            on: (channel: string, listener: (event: unknown) => void): (() => void) => {
                const list = listeners.get(channel) ?? [];
                list.push(listener);
                listeners.set(channel, list);
                return () => {
                    const now = listeners.get(channel) ?? [];
                    listeners.set(
                        channel,
                        now.filter((entry) => entry !== listener),
                    );
                };
            },
        },
    } as never;
    return {
        pi,
        fire: (channel: string, event: unknown): void => {
            for (const listener of listeners.get(channel) ?? []) listener(event);
        },
    };
}

const call = (input: Record<string, unknown>, toolCallId = "call-1"): GateCall => ({
    toolCallId,
    tool: "git",
    action: "fetch",
    environment: "local",
    environmentKind: "local",
    effect: "read",
    decision: "allow",
    input,
    cwd: h.sb.workspace,
    paths: [],
});

const verdict = (guard: ReturnType<typeof createFetchGuard>, gateCall: GateCall) =>
    guard.gate.check(gateCall, undefined as never);

test("a host in a remote address: scp-like, ssh, https; a local path has none", () => {
    assert.equal(hostOfRemoteUrl("git@github.com:acme/orders-api.git"), "github.com");
    assert.equal(hostOfRemoteUrl("ssh://git@gitlab.example.com:2222/g/p.git"), "gitlab.example.com");
    assert.equal(hostOfRemoteUrl("https://user@GitHub.com/acme/orders-api.git"), "github.com");
    assert.equal(hostOfRemoteUrl("/srv/git/orders-api.git"), undefined);
    assert.equal(hostOfRemoteUrl("../elsewhere/orders-api"), undefined);
    assert.equal(hostOfRemoteUrl("file:///srv/git/orders-api.git"), undefined);
});

test("github.com runs without a question", async () => {
    const r = makeRepo(h.sb, `fetch-github-${++counter}`, "acme", "github.com");
    const found = await inspectFetch(call({ repo: r.name }));
    assert.equal(found.fetch, true);
    assert.equal(found.host, "github.com");
    assert.equal(isTrustedFetch(found, gitSettings()), true);
    const guard = createFetchGuard(fakePi().pi);
    try {
        assert.equal(await verdict(guard, call({ repo: r.name })), undefined);
    } finally {
        guard.stop();
    }
});

test("a remote added on a host the configuration does not name asks, and the question names the host", async () => {
    const r = makeRepo(h.sb, `fetch-unknown-${++counter}`, "acme", "github.com");
    git(r.dir, "remote", "add", "other", "git@elsewhere.example:acme/orders-api.git");
    const guard = createFetchGuard(fakePi().pi);
    try {
        const answer = await verdict(guard, call({ repo: r.name, remote: "other" }));
        assert.equal(answer?.decision, "ask");
        assert.equal(answer?.reason, "fetch from elsewhere.example? Your SSH key will be offered there.");
    } finally {
        guard.stop();
    }
});

test("origin rewritten to another host asks: comparing against origin proves nothing", async () => {
    const r = makeRepo(h.sb, `fetch-rewritten-${++counter}`, "acme", "github.com");
    git(r.dir, "remote", "set-url", "origin", "git@elsewhere.example:acme/orders-api.git");
    const guard = createFetchGuard(fakePi().pi);
    try {
        const answer = await verdict(guard, call({ repo: r.name }));
        assert.equal(answer?.decision, "ask");
        assert.match(answer?.reason ?? "", /elsewhere\.example/);
    } finally {
        guard.stop();
    }
});

test("a host `git.forges` names, and its object form's real host, do not ask", async () => {
    h.jig.setSection("git", {
        forges: { "gitlab.example.com": "gitlab", "gh-work": { forge: "github", host: "github.com" } },
    });
    const selfHosted = makeRepo(h.sb, `fetch-forge-${++counter}`, "acme", "gitlab.example.com");
    const alias = makeRepo(h.sb, `fetch-alias-${++counter}`, "acme", "github.com");
    git(alias.dir, "remote", "set-url", "origin", "git@gh-work:acme/orders-api.git");
    const guard = createFetchGuard(fakePi().pi);
    try {
        assert.equal(await verdict(guard, call({ repo: selfHosted.name })), undefined);
        assert.equal(await verdict(guard, call({ repo: alias.name })), undefined);
    } finally {
        guard.stop();
    }
});

test("a local-path remote offers no key, so it does not ask", async () => {
    const r = makeRepo(h.sb, `fetch-local-${++counter}`, "acme", "github.com");
    git(r.dir, "remote", "set-url", "origin", r.origin);
    const guard = createFetchGuard(fakePi().pi);
    try {
        assert.equal(await verdict(guard, call({ repo: r.name })), undefined);
    } finally {
        guard.stop();
    }
});

test("a `this session` answer is remembered for that host only", async () => {
    const r = makeRepo(h.sb, `fetch-session-${++counter}`, "acme", "github.com");
    git(r.dir, "remote", "add", "one", "git@elsewhere.example:acme/one.git");
    git(r.dir, "remote", "add", "two", "git@second.example:acme/two.git");
    const pi = fakePi();
    const guard = createFetchGuard(pi.pi);
    try {
        assert.equal((await verdict(guard, call({ repo: r.name, remote: "one" }, "c1")))?.decision, "ask");
        pi.fire(JIG_EVENTS.decision, {
            toolCallId: "c1",
            tool: "git",
            action: "fetch",
            gate: "git-fetch-host",
            decision: "ask",
            answer: "allow-session",
        });
        assert.equal(
            await verdict(guard, call({ repo: r.name, remote: "one" }, "c2")),
            undefined,
            "the same host is allowed now",
        );
        assert.equal(
            (await verdict(guard, call({ repo: r.name, remote: "two" }, "c3")))?.decision,
            "ask",
            "another host still asks",
        );
    } finally {
        guard.stop();
    }
});

test("an answer of `allow` once is not remembered for the session", async () => {
    const r = makeRepo(h.sb, `fetch-once-${++counter}`, "acme", "github.com");
    git(r.dir, "remote", "add", "one", "git@elsewhere.example:acme/one.git");
    const pi = fakePi();
    const guard = createFetchGuard(pi.pi);
    try {
        await verdict(guard, call({ repo: r.name, remote: "one" }, "c1"));
        pi.fire(JIG_EVENTS.decision, {
            toolCallId: "c1",
            tool: "git",
            action: "fetch",
            gate: "git-fetch-host",
            decision: "ask",
            answer: "allow",
        });
        assert.equal((await verdict(guard, call({ repo: r.name, remote: "one" }, "c2")))?.decision, "ask");
    } finally {
        guard.stop();
    }
});

test("a call that is not a fetch, or that the tool would refuse, gets no answer", async () => {
    const guard = createFetchGuard(fakePi().pi);
    try {
        assert.equal(await verdict(guard, { ...call({ action: "status" }), action: "status" }), undefined);
        assert.equal(await verdict(guard, call({ repo: "not a repo name", remote: "-x" })), undefined);
        assert.equal(await verdict(guard, call({ repo: "no-such-folder" })), undefined);
    } finally {
        guard.stop();
    }
});
