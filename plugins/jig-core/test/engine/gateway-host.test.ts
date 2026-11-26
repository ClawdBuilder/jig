// The gateway's host, member by member (design 5.5): who the agent is, where the call is made, and that nobody can be asked. A host built for a call
// says it is the gateway's (`enforcedBy`), so that the call's record does too.
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { AskRequest } from "../../src/ask.ts";
import {
    callIdOf,
    clientOf,
    newSessionId,
    processHost,
    requestHost,
    TOOL_USE_ID_KEY,
    UNKNOWN_AGENT,
} from "../../src/gateway/host.ts";
import type { HostShared } from "../../src/gateway/host.ts";
import { SIGNAL } from "./harness.ts";

const CLIENT_INFO = "io.modelcontextprotocol/clientInfo";

/** What the host shares, with the lines it wrote to standard error collected. */
function shared(env: NodeJS.ProcessEnv = {}): { shared: HostShared; lines: string[] } {
    const lines: string[] = [];
    return { shared: { sessionId: "session-9", env, stderr: (line) => lines.push(line) }, lines };
}

const QUESTION: AskRequest = {
    header: "pr comment",
    preview: { summary: "comment on pull request 1" },
    kind: "dialog",
};

describe("the host of a request", () => {
    test("says who the agent is, which session and folder the call belongs to, and that the gateway enforces", () => {
        const host = requestHost(shared().shared, { name: "claude-code", version: "2.1.332" }, "/work/alpha");
        assert.deepEqual(host.agent, { name: "claude-code", version: "2.1.332" });
        assert.deepEqual(host.session, { id: "session-9", role: "main" });
        assert.equal(host.cwd, "/work/alpha");
        assert.equal(host.enforcedBy, "gateway");
    });

    test("takes the parent session and the role from the environment, as the records do", () => {
        const env = { JIG_PARENT_SESSION: "parent-1", JIG_AGENT_ROLE: "reviewer" };
        const host = requestHost(shared(env).shared, UNKNOWN_AGENT, "/work");
        assert.deepEqual(host.session, { id: "session-9", parent: "parent-1", role: "reviewer" });
        const empty = requestHost(
            shared({ JIG_PARENT_SESSION: "", JIG_AGENT_ROLE: "" }).shared,
            UNKNOWN_AGENT,
            "/work",
        );
        assert.deepEqual(empty.session, { id: "session-9", role: "main" }, "an empty value is not set");
    });

    test("nobody can be asked: canAsk and canAskProtected are false, and ask closes the question, so a mistake fails closed", async () => {
        const host = requestHost(shared().shared, UNKNOWN_AGENT, "/work");
        assert.equal(host.canAsk, false);
        assert.equal(host.canAskProtected, false);
        assert.deepEqual(await host.ask(QUESTION, SIGNAL), { answer: "decline", dismissed: true, waitedMs: 0 });
    });

    test("the agent's own tools are not seen: toolInfo knows nothing", () => {
        assert.equal(requestHost(shared().shared, UNKNOWN_AGENT, "/work").toolInfo("pr"), undefined);
    });

    test("notify writes one line to standard error and says nobody saw it, so the notice is still owed", () => {
        const { shared: parts, lines } = shared();
        const host = requestHost(parts, UNKNOWN_AGENT, "/work");
        assert.equal(host.notify("a watch ended\nwith two lines", "info"), false);
        assert.equal(host.notify("the store is locked", "warn"), false);
        assert.deepEqual(lines, ["a watch ended with two lines", "warning: the store is locked"]);
    });

    test("wake says the agent could not be woken, and an event goes nowhere", async () => {
        const host = requestHost(shared().shared, UNKNOWN_AGENT, "/work");
        assert.equal(await host.wake({ customType: "watch", content: "done", display: true } as never), false);
        assert.equal(host.emit("jig:decision", { tool: "pr" }), undefined);
    });
});

describe("the host of the process", () => {
    test("is for what happens between calls: the folder the gateway started in, and an agent nobody has named", () => {
        const host = processHost(shared().shared, "/started/here");
        assert.equal(host.cwd, "/started/here");
        assert.deepEqual(host.agent, { name: "unknown", version: "unknown" });
        assert.equal(host.canAsk, false);
    });

    test("one session id for a process, and a new one for each process", () => {
        const first = newSessionId();
        assert.match(first, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
        assert.notEqual(first, newSessionId());
    });
});

describe("clientOf", () => {
    test("reads the name and version from the request's envelope", () => {
        const envelope = { [CLIENT_INFO]: { name: "claude-code", version: "2.1.332" } };
        assert.deepEqual(clientOf(envelope), { name: "claude-code", version: "2.1.332" });
        assert.deepEqual(clientOf(envelope, { name: "other", version: "1" }), {
            name: "claude-code",
            version: "2.1.332",
        });
    });

    test("on an older revision the name comes from the initialize request, which the SDK keeps", () => {
        assert.deepEqual(clientOf(undefined, { name: "old-agent", version: "0.9" }), {
            name: "old-agent",
            version: "0.9",
        });
        assert.deepEqual(clientOf({}, { name: "old-agent", version: "0.9" }), { name: "old-agent", version: "0.9" });
    });

    test("a request that says nothing, or something that is not text, is an unknown agent", () => {
        assert.deepEqual(clientOf(undefined), UNKNOWN_AGENT);
        assert.deepEqual(clientOf({ [CLIENT_INFO]: { name: 7, version: "" } }), UNKNOWN_AGENT);
        assert.deepEqual(clientOf({ [CLIENT_INFO]: "claude-code" }, { name: "old-agent" }), {
            name: "old-agent",
            version: "unknown",
        });
    });
});

describe("callIdOf", () => {
    test("is the id the agent sent for the tool use", () => {
        assert.equal(callIdOf({ [TOOL_USE_ID_KEY]: "toolu_01abc" }), "toolu_01abc");
        assert.equal(TOOL_USE_ID_KEY, "claudecode/toolUseId");
    });

    test("keeps an id of letters, digits and _ . : - only, as Claude Code's look, and makes a new one for any other text", () => {
        for (const id of ["toolu_01LtEu69y4YUCKhnssbH52Nm", "a:b.c-d_E9", "1"]) {
            assert.equal(callIdOf({ [TOOL_USE_ID_KEY]: id }), id);
        }
        // It goes into every record line and is the key of the call: a space, a line break, a quote, a slash or a letter beyond ASCII is not kept.
        for (const id of ["a b", "a\nb", 'x"y', "a/b", "a\\b", "caf\u00e9", "a\u0000b", "{}"]) {
            const made = callIdOf({ [TOOL_USE_ID_KEY]: id });
            assert.notEqual(made, id);
            assert.match(made, /^[0-9a-f]{8}-[0-9a-f]{4}-/);
        }
    });

    test("is a new id for each call when the agent sent none, or one that is empty, not text or too long", () => {
        const made = [
            undefined,
            {},
            { [TOOL_USE_ID_KEY]: "" },
            { [TOOL_USE_ID_KEY]: 5 },
            { [TOOL_USE_ID_KEY]: "x".repeat(201) },
        ].map(callIdOf);
        for (const id of made) assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-/);
        assert.equal(new Set(made).size, made.length);
        assert.equal(callIdOf({ [TOOL_USE_ID_KEY]: "x".repeat(200) }), "x".repeat(200));
    });
});
