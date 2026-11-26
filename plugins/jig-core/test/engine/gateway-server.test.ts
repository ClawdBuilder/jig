// The MCP side of the gateway, in this process: the server that `serveStdio` makes from the factory, spoken to over a linked pair of in-memory transports with the
// messages of revision 2026-07-28 (the child-process test, gateway-process.test.ts, speaks them over a real pipe). A call goes through the SDK's own check, then the call
// flow; what comes back is a normal result whose text is the engine's, an error result for a refusal, and a progress notice only when the request asked for one.
import assert from "node:assert/strict";
import { afterEach, describe, test } from "node:test";
import { InMemoryTransport } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { NO_SCREEN, NO_SETTINGS } from "../../src/gateway/runtime.ts";
import { createServerFactory } from "../../src/gateway/server.ts";
import { stampTool } from "../support/test-tool.ts";
import { echoTool, useGateways, withTools } from "./gateway-harness.ts";
import type { Gateway, Seen } from "./gateway-harness.ts";

const open = useGateways();

type Message = Record<string, unknown>;

const connections: Array<() => Promise<void>> = [];
afterEach(async () => {
    for (const close of connections.splice(0)) await close();
});

/** Speaks to a server as an agent on revision 2026-07-28 does: every request names its revision, client and capabilities in `_meta`. */
function connect(g: Gateway) {
    const [client, side] = InMemoryTransport.createLinkedPair();
    const handle = serveStdio(createServerFactory(g.runtime, "9.9.9"), { transport: side });
    connections.push(() => handle.close());
    const waiting = new Map<number, (message: Message) => void>();
    const notices: Message[] = [];
    client.onmessage = (message) => {
        const one = message as Message;
        const answer = typeof one.id === "number" ? waiting.get(one.id) : undefined;
        if (answer === undefined) notices.push(one);
        else answer(one);
    };
    let next = 0;
    const ready = client.start();
    const request = async (
        method: string,
        params: Record<string, unknown> = {},
        extra: Record<string, unknown> = {},
        envelope = true,
    ): Promise<Message> => {
        await ready;
        next += 1;
        const id = next;
        const answered = new Promise<Message>((resolve) => waiting.set(id, resolve));
        const meta = {
            "io.modelcontextprotocol/protocolVersion": "2026-07-28",
            "io.modelcontextprotocol/clientCapabilities": {},
            "io.modelcontextprotocol/clientInfo": { name: "Claude-Code", version: "2.1.332" },
            ...extra,
        };
        // An agent on an older revision sends no envelope: the first message names the client, and later ones say nothing of it.
        const sent = envelope
            ? { ...params, _meta: meta }
            : { ...params, ...(Object.keys(extra).length === 0 ? {} : { _meta: extra }) };
        await client.send({ jsonrpc: "2.0", id, method, params: sent } as never);
        return answered;
    };
    return {
        notices,
        request,
        /** A notification, which has no id and no answer. */
        notify: async (method: string) => {
            await ready;
            await client.send({ jsonrpc: "2.0", method } as never);
        },
        call: (name: string, args: Record<string, unknown>, extra: Record<string, unknown> = {}) =>
            request("tools/call", { name, arguments: args }, extra),
    };
}

/** The result of a message that answered with one. */
const resultOf = (message: Message) => message.result as Record<string, unknown>;
const textOf = (message: Message) =>
    ((resultOf(message).content as Array<{ text: string }>)[0] as { text: string }).text;

describe("the server answers on revision 2026-07-28", () => {
    test("discover names the revision and carries the instructions, which say so when no settings were found", async () => {
        const found = open({ connectors: [], config: {} });
        const answer = resultOf(await connect(found).request("server/discover"));
        assert.deepEqual(answer.supportedVersions, ["2026-07-28"]);
        assert.match(String(answer.instructions), /^Jig decides every call of this server\./);
        assert.doesNotMatch(String(answer.instructions), /No settings folder/);

        const none = open({ connectors: [], settings: false });
        const without = resultOf(await connect(none).request("server/discover"));
        assert.ok(String(without.instructions).endsWith(NO_SETTINGS));
        assert.deepEqual((without._meta as Record<string, unknown>)["io.modelcontextprotocol/serverInfo"], {
            name: "jig",
            version: "9.9.9",
        });
    });

    test("tools/list gives each tool with its title, text and listed schema: dir where it works on a folder, and no action that is kept back", async () => {
        const g = open({
            connectors: [withTools("jig-test", [echoTool([]), stampTool().tool], { notOffered: { echo: ["leak"] } })],
            config: {},
        });
        const listed = (resultOf(await connect(g).request("tools/list")).tools ?? []) as Array<Record<string, unknown>>;
        assert.deepEqual(
            listed.map((tool) => tool.name),
            ["echo", "jig", "stamp"],
        );
        const echo = listed[0] as { title: string; inputSchema: { properties: Record<string, { enum?: string[] }> } };
        assert.equal(echo.title, "Echo");
        assert.deepEqual(Object.keys(echo.inputSchema.properties), ["action", "text", "dir"]);
        assert.deepEqual(echo.inputSchema.properties.action?.enum, ["read"]);
        const stamp = listed[2] as { inputSchema: { properties: Record<string, unknown> } };
        assert.equal("dir" in stamp.inputSchema.properties, false);
        for (const tool of listed)
            assert.equal(tool.annotations, undefined, "no read-only mark: none of the tools is only reads");
    });
});

describe("a call over MCP", () => {
    test("runs a read: the text is the engine's, as one text block, with no structured content and no error mark; the record has the name and id the request sent", async () => {
        const g = open({ connectors: [withTools("jig-test", [stampTool().tool])], config: {} });
        const answer = await connect(g).call("stamp", { action: "read" }, { "claudecode/toolUseId": "toolu_77" });
        assert.deepEqual(resultOf(answer).content, [{ type: "text", text: "stamps: none" }]);
        assert.equal("structuredContent" in resultOf(answer), false);
        assert.equal("isError" in resultOf(answer), false);
        const [record] = g.records();
        assert.deepEqual(
            [record?.toolCallId, record?.agentName, record?.enforcedBy],
            ["toolu_77", "claude-code", "gateway"],
        );
    });

    test("a call that would need a question comes back as a normal result with isError and the engine's line", async () => {
        const g = open({ connectors: [withTools("jig-test", [stampTool().tool])], config: {} });
        const answer = await connect(g).call("stamp", { action: "write", text: "x" });
        assert.equal(answer.error, undefined, "not a protocol error");
        assert.equal(resultOf(answer).isError, true);
        assert.equal(textOf(answer), NO_SCREEN);
        assert.equal(g.records()[0]?.errorKind, "no-screen");
    });

    test("a call without an id from the agent gets one of its own, and a dir is the folder of the call", async () => {
        const seen: Seen[] = [];
        const g = open({ connectors: [withTools("jig-test", [echoTool(seen)])], config: {} });
        const folder = g.folder("named-");
        const answer = await connect(g).call("echo", { action: "read", dir: folder });
        assert.equal(textOf(answer), `echo ${folder}`);
        assert.match(String(g.records()[0]?.toolCallId), /^[0-9a-f]{8}-/);
        assert.deepEqual(seen[0]?.input, { action: "read" });
    });

    test("progress reaches the agent as a notice only when the request carried a progress token", async () => {
        const g = open({ connectors: [withTools("jig-test", [echoTool([])])], config: {} });
        const server = connect(g);
        await server.call("echo", { action: "read" });
        assert.equal(server.notices.length, 0, "no token, no notice");

        await server.call("echo", { action: "read" }, { progressToken: "pt-1" });
        assert.deepEqual(
            server.notices.map((notice) => [notice.method, notice.params]),
            [["notifications/progress", { progressToken: "pt-1", progress: 1, message: "working" }]],
        );
    });

    test("a call the SDK's own check rejects never reaches the engine, so it leaves no record", async () => {
        const g = open({
            connectors: [withTools("jig-test", [echoTool([])], { notOffered: { echo: ["leak"] } })],
            config: {},
        });
        const server = connect(g);
        const kept = await server.call("echo", { action: "leak" });
        assert.equal(resultOf(kept).isError, true);
        assert.match(textOf(kept), /Input validation error.*allowed values/);
        const extra = await server.call("echo", { action: "read", nonesuch: 1 });
        assert.match(textOf(extra), /must NOT have additional properties/);
        const unknown = await server.call("nonesuch", {});
        assert.equal((unknown.error as { code: number }).code, -32602);
        assert.deepEqual(g.records(), []);
    });

    test("an agent on an older revision opens with initialize, and the name it gave there is the one in the record", async () => {
        const g = open({ connectors: [withTools("jig-test", [stampTool().tool])], config: {} });
        const server = connect(g);
        const opened = resultOf(
            await server.request(
                "initialize",
                { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "Old-Agent", version: "0.9" } },
                {},
                false,
            ),
        );
        assert.equal(opened.protocolVersion, "2025-11-25");
        await server.notify("notifications/initialized");
        const answer = await server.request("tools/call", { name: "stamp", arguments: { action: "read" } }, {}, false);
        assert.equal(textOf(answer), "stamps: none");
        const [record] = g.records();
        assert.deepEqual([record?.agentName, record?.enforcedBy], ["old-agent", "gateway"]);
        assert.match(String(record?.toolCallId), /^[0-9a-f]{8}-/, "this agent sent no id for the tool use");
    });

    test("the jig tool answers over MCP with what the engine decided", async () => {
        const g = open({ connectors: [withTools("jig-test", [stampTool().tool])], config: {} });
        const server = connect(g);
        await server.call("stamp", { action: "read" });
        const status = await server.call("jig", { action: "status" });
        assert.match(textOf(status), /^The last call this gateway decided, the newest last:\n.* stamp read: allow$/);
    });
});
