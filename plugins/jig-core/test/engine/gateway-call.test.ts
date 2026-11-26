// The gateway's call flow with no Pi and no MCP: one call goes through the tool check, the folder check, `judge` and `run` of a real engine, over tools that
// are declared in the test. A read runs and is recorded; a call that would need a question is refused with the engine's own line, and every refusal has a record
// line made by the engine. The connector of jig-git is used where the order of the first use matters.
import assert from "node:assert/strict";
import { existsSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";
import connector from "../../../jig-git/src/connector.ts";
import { jig } from "../../src/client.ts";
import { STATUS_OUTCOMES } from "../../src/gateway/jig-tool.ts";
import { NO_SCREEN, NO_SETTINGS } from "../../src/gateway/runtime.ts";
import { stampTool } from "../support/test-tool.ts";
import { echoTool, slowTool, useGateways, withTools } from "./gateway-harness.ts";
import type { Seen } from "./gateway-harness.ts";

const open = useGateways();

describe("a read", () => {
    test("runs with no question, answers with the tool's text, and leaves one record line for the gateway", async () => {
        const { tool, handed } = stampTool();
        const g = open({ connectors: [withTools("jig-test", [tool])] });
        const result = await g.call("stamp", { action: "read" }, "toolu_1");
        assert.deepEqual(result, { text: "stamps: none", isError: false });
        assert.equal(handed.execute.length, 1);

        const [record, ...more] = g.records();
        assert.equal(more.length, 0);
        assert.equal(record?.tool, "stamp");
        assert.equal(record?.action, "read");
        assert.equal(record?.plugin, "jig-test");
        assert.equal(record?.decision, "allow");
        assert.equal(record?.outcome, "ok");
        assert.equal(record?.toolCallId, "toolu_1");
        assert.equal(record?.agentName, "claude-code", "the name the agent sent, lower-cased");
        assert.equal(record?.enforcedBy, "gateway");
    });

    test("every call of the process is one session, and another process is another", async () => {
        const { tool } = stampTool();
        const g = open({ connectors: [withTools("jig-test", [tool])] });
        await g.call("stamp", { action: "read" }, "call-1");
        await g.call("stamp", { action: "read" }, "call-2");
        const [first, second] = g.records();
        assert.equal(first?.session, second?.session);
        assert.match(String(first?.session), /^[0-9a-f]{8}-/);
        const other = open({ connectors: [withTools("jig-test", [stampTool().tool])] });
        await other.call("stamp", { action: "read" });
        assert.notEqual(other.records()[0]?.session, first?.session);
    });

    test("a tool's error is its result, with isError, and a refusal by the tool's own rules is one too", async () => {
        const { tool } = stampTool();
        const g = open({ connectors: [withTools("jig-test", [tool])] });
        assert.deepEqual(await g.call("stamp", { action: "fail" }, "call-1"), {
            text: "the stamp press jammed",
            isError: true,
        });
        assert.deepEqual(await g.call("stamp", { action: "refuse" }, "call-2"), {
            text: "stamp refused: the press is closed today",
            isError: true,
        });
        const [failed, refused] = g.records();
        assert.deepEqual([failed?.outcome, failed?.errorKind], ["error", "tool"]);
        assert.deepEqual([refused?.outcome, refused?.errorKind], ["blocked", "refused"]);
    });
});

describe("a call that would need a question", () => {
    test("is refused with the engine's own line, the tool does not run, and the record says blocked, with no screen", async () => {
        const { tool, handed } = stampTool();
        const g = open({ connectors: [withTools("jig-test", [tool])] });
        const result = await g.call("stamp", { action: "write", text: "x" }, "call-w");
        assert.deepEqual(result, {
            text: "Blocked by jig-core: this call needs approval and there is no screen to ask on.",
            isError: true,
        });
        assert.equal(result.text, NO_SCREEN);
        assert.deepEqual(handed.execute, [], "the tool did not run");
        const [record] = g.records();
        assert.deepEqual(
            [record?.outcome, record?.errorKind, record?.decision, record?.toolCallId, record?.enforcedBy],
            ["blocked", "no-screen", "deny", "call-w", "gateway"],
        );
    });

    test("a rule in jig.json that allows it needs no question, and a section of a plugin that registered is checked beside it", async () => {
        const { tool, handed } = stampTool();
        const g = open({
            connectors: [withTools("jig-test", [tool]), connector],
            config: { rules: [{ tool: "stamp", action: "write", decision: "allow" }], git: { nonesuch: 1 } },
        });
        const result = await g.call("stamp", { action: "write", text: "x" });
        assert.deepEqual(result, { text: "stamped x", isError: false });
        assert.equal(handed.execute.length, 1);
        // The git section was known when jig.json was read, so its mistake is a problem and not a section that counts as off.
        const status = await g.call("jig", { action: "status" }, "call-2");
        assert.match(status.text, /^jig\.json: git: git\.nonesuch: unknown field/m);
        assert.match(status.text, /Run `jig doctor`/);
    });
});

describe("a call that the gateway refuses before judge", () => {
    test("a tool that is not one of the gateway's: refused, the engine is not asked, and the call has a record", async () => {
        const g = open({ connectors: [withTools("jig-test", [stampTool().tool])] });
        const result = await g.call("nonesuch", { action: "read" }, "call-x");
        assert.deepEqual(result, {
            text: "Blocked by jig-core: nonesuch is not a tool of this gateway.",
            isError: true,
        });
        const [record] = g.records();
        assert.deepEqual(
            [record?.tool, record?.outcome, record?.errorKind, record?.decision],
            ["nonesuch", "error", "not-run", undefined],
        );
    });

    test("an action the connector keeps back is out of the form and refused if a call names it anyway, before judge, with a record", async () => {
        const seen: Seen[] = [];
        const g = open({ connectors: [withTools("jig-test", [echoTool(seen)], { notOffered: { echo: ["leak"] } })] });
        const entry = g.runtime.entries.find((one) => one.name === "echo");
        const form = entry?.inputSchema.properties as { action: { enum: string[] } } | undefined;
        assert.deepEqual(form?.action.enum, ["read"]);

        const result = await g.call("echo", { action: "leak" }, "call-l");
        assert.deepEqual(result, {
            text: "Blocked by jig-core: echo leak is not offered through this gateway.",
            isError: true,
        });
        assert.deepEqual(seen, [], "the tool did not run");
        const [record] = g.records();
        assert.deepEqual(
            [
                record?.tool,
                record?.outcome,
                record?.errorKind,
                record?.decision,
                record?.toolCallId,
                record?.enforcedBy,
            ],
            ["echo", "error", "not-run", undefined, "call-l", "gateway"],
            "no decision: the engine was not asked",
        );
        assert.equal(
            (await g.call("echo", { action: "read" }, "call-r")).isError,
            false,
            "the actions that are offered still run",
        );
    });

    test("the gateway's real connector keeps back pr watch and release tag_create, in the form and in the call", async () => {
        const g = open({ connectors: [connector] });
        const forms = Object.fromEntries(g.runtime.entries.map((entry) => [entry.name, entry]));
        const actions = (name: string): string[] => {
            const form = forms[name]?.inputSchema.properties as { action: { enum: string[] } } | undefined;
            return form?.action.enum ?? [];
        };
        assert.equal(actions("pr").includes("watch"), false);
        assert.equal(actions("pr").includes("view"), true);
        assert.equal(actions("release").includes("tag_create"), false);
        assert.equal(actions("release").includes("tag_push"), true);
        const dir = g.cwd;
        assert.match(
            (await g.call("pr", { action: "watch", number: 1, dir }, "c1")).text,
            /^Blocked by jig-core: pr watch is not offered/,
        );
        assert.match(
            (await g.call("release", { action: "tag_create", tag: "v1", dir }, "c2")).text,
            /^Blocked by jig-core: release tag_create is not offered/,
        );
        assert.deepEqual(
            g.records().map((record) => [record.tool, record.outcome, record.errorKind]),
            [
                ["pr", "error", "not-run"],
                ["release", "error", "not-run"],
            ],
        );
    });
});

describe("the folder of a call", () => {
    test("is the folder the gateway started in, unless a tool that works on a folder is given dir", async () => {
        const seen: Seen[] = [];
        const g = open({ connectors: [withTools("jig-test", [echoTool(seen)])] });
        const elsewhere = g.folder("elsewhere-");

        assert.equal((await g.call("echo", { action: "read" }, "c1")).text, `echo ${g.cwd}`);
        assert.equal((await g.call("echo", { action: "read", dir: elsewhere }, "c2")).text, `echo ${elsewhere}`);
        assert.deepEqual(
            seen.map((one) => one.cwd),
            [g.cwd, elsewhere],
        );
    });

    test("dir is taken out of the input: the engine and the tool never see it", async () => {
        const seen: Seen[] = [];
        const g = open({ connectors: [withTools("jig-test", [echoTool(seen)])] });
        await g.call("echo", { action: "read", text: "t", dir: g.cwd });
        assert.deepEqual(seen[0]?.input, { action: "read", text: "t" });
    });

    test("a tool that does not work on a folder is given its input as it is", async () => {
        const stamp = stampTool();
        const g = open({ connectors: [withTools("jig-test", [stamp.tool])] });
        // The SDK's check rejects dir for such a tool before the call gets here; called directly, the input is left alone.
        await g.call("stamp", { action: "folder", dir: g.cwd });
        assert.deepEqual(
            stamp.handed.execute.map((one) => one.cwd),
            [g.cwd],
        );
    });

    test("must be an absolute path to a folder that exists, or the call is refused before judge, with a record", async () => {
        const seen: Seen[] = [];
        const g = open({ connectors: [withTools("jig-test", [echoTool(seen)])] });
        const file = path.join(g.settings, "a-file");
        writeFileSync(file, "x");
        const refusals = [
            [{ dir: "relative/folder" }, "dir must be an absolute path to a folder"],
            [{ dir: 5 }, "dir must be an absolute path to a folder"],
            [{ dir: path.join(g.cwd, "missing") }, "dir is not a folder that exists"],
            [{ dir: file }, "dir is not a folder that exists"],
        ] as const;
        for (const [index, [extra, why]] of refusals.entries()) {
            const result = await g.call("echo", { action: "read", ...extra }, `call-${index}`);
            assert.deepEqual(result, { text: `Blocked by jig-core: ${why}.`, isError: true });
        }
        assert.deepEqual(seen, [], "the tool never ran");
        assert.deepEqual(
            g.records().map((record) => [record.toolCallId, record.outcome, record.errorKind, record.decision]),
            refusals.map((_, index) => [`call-${index}`, "error", "not-run", undefined]),
        );
    });

    test("a tool with no dir answers for the folder of the call, so two calls for two folders each get their own", async () => {
        const seen: Seen[] = [];
        const g = open({ connectors: [withTools("jig-test", [echoTool(seen)])] });
        const one = g.folder("one-");
        const two = g.folder("two-");
        const [first, second] = await Promise.all([
            g.call("echo", { action: "read", dir: one }, "c1"),
            g.call("echo", { action: "read", dir: two }, "c2"),
        ]);
        assert.deepEqual([first.text, second.text], [`echo ${one}`, `echo ${two}`]);
    });
});

describe("calls to a tool that runs one at a time", () => {
    test("go one after the other, in the order they came", async () => {
        const order: string[] = [];
        const g = open({ connectors: [withTools("jig-test", [slowTool(order, true)])] });
        await Promise.all([g.call("slow", { text: "a" }, "c1"), g.call("slow", { text: "b" }, "c2")]);
        assert.deepEqual(order, ["start a", "end a", "start b", "end b"]);
    });

    test("a tool that does not ask for it runs its calls together", async () => {
        const order: string[] = [];
        const g = open({ connectors: [withTools("jig-test", [slowTool(order, false)])] });
        await Promise.all([g.call("slow", { text: "a" }, "c1"), g.call("slow", { text: "b" }, "c2")]);
        assert.deepEqual(order, ["start a", "start b", "end b", "end a"]);
    });
});

describe("two calls under one id", () => {
    test("both run and both have their record line: the second gets an id of its own while the first is open", async () => {
        const order: string[] = [];
        const g = open({ connectors: [withTools("jig-test", [slowTool(order, false)])] });
        // The first call takes longer, so it is still open when the second arrives with the same id.
        const [first, second] = await Promise.all([
            g.call("slow", { text: "a" }, "same"),
            g.call("slow", { text: "b" }, "same"),
        ]);
        assert.deepEqual(
            [first, second],
            [
                { text: "a", isError: false },
                { text: "b", isError: false },
            ],
        );
        const ids = g.records().map((record) => record.toolCallId);
        assert.equal(ids.length, 2, "a record line for each call");
        assert.equal(new Set(ids).size, 2, "under two ids");
        assert.ok(ids.includes("same"), "the call that came first keeps the id the agent sent");
    });

    test("an id is free again when its call is done", async () => {
        const g = open({ connectors: [withTools("jig-test", [slowTool([], false)])] });
        await g.call("slow", { text: "b" }, "same");
        await g.call("slow", { text: "b" }, "same");
        assert.deepEqual(
            g.records().map((record) => record.toolCallId),
            ["same", "same"],
        );
    });
});

describe("progress", () => {
    test("reaches the tool only when the request asked for it", async () => {
        const seen: Seen[] = [];
        const g = open({ connectors: [withTools("jig-test", [echoTool(seen)])] });
        const said: string[] = [];
        await g.call("echo", { action: "read" }, "c1");
        await g.call("echo", { action: "read" }, "c2", { progress: (text) => said.push(text) });
        assert.deepEqual(
            seen.map((one) => one.hasProgress),
            [false, true],
        );
        assert.deepEqual(said, ["working"]);
    });
});

describe("the first use", () => {
    test("nothing happens until the first call: listing the tools registers nothing and writes nothing", async () => {
        let registered = 0;
        const { tool } = stampTool();
        const g = open({ connectors: [withTools("jig-test", [tool], { register: () => void (registered += 1) })] });
        assert.deepEqual(
            g.runtime.entries.map((entry) => entry.name),
            ["jig", "stamp"],
        );
        assert.equal(registered, 0);
        assert.equal(existsSync(path.join(g.stateDir, "records")), false);
        assert.throws(() => jig(), /jig-core is not loaded/);

        await g.call("stamp", { action: "read" }, "c1");
        await g.call("stamp", { action: "read" }, "c2");
        assert.equal(registered, 1, "registered once, at the first call");
        assert.equal(jig().version, 1, "the API is published for the tools");
        await g.runtime.stop();
        assert.throws(() => jig(), /jig-core is not loaded/, "and withdrawn when the gateway stops");
    });

    test("the update check is left out: the registry is not asked", async () => {
        const original = globalThis.fetch;
        let asked = 0;
        globalThis.fetch = (async () => {
            asked += 1;
            throw new Error("offline");
        }) as typeof fetch;
        try {
            // A session that is not a child agent, with the notice on and the registry reachable by name: only the switch can stop the check.
            const g = open({
                connectors: [withTools("jig-test", [stampTool().tool])],
                env: { ...process.env, PI_OFFLINE: "", PI_SUBAGENT_ID: "", PI_SUBAGENT_CHILD: "" },
            });
            await g.call("stamp", { action: "read" });
            assert.equal(asked, 0);
        } finally {
            globalThis.fetch = original;
        }
    });

    test("an engine that cannot start refuses every call, says why on standard error once, and runs no tool", async () => {
        const { tool, handed } = stampTool();
        const g = open({
            connectors: [
                withTools("jig-test", [tool], {
                    register() {
                        throw new Error("section clash");
                    },
                }),
            ],
        });
        for (const id of ["c1", "c2"]) {
            assert.deepEqual(await g.call("stamp", { action: "read" }, id), {
                text: "Blocked by jig-core: the gateway could not start: section clash",
                isError: true,
            });
        }
        assert.deepEqual(handed.execute, []);
        assert.deepEqual(g.lines, ["the gateway could not start its engine: section clash"]);
        assert.throws(() => jig(), /jig-core is not loaded/, "the API of the failed start is withdrawn");
    });

    test("two tools with one name are a mistake that the gateway says at once", () => {
        const { tool } = stampTool();
        assert.throws(
            () => open({ connectors: [withTools("one", [tool]), withTools("two", [tool])] }),
            /two tools are named stamp/,
        );
    });
});

describe("the jig tool", () => {
    test("is offered with every connector's tools, by name, and is a local read that is recorded like any call", async () => {
        const g = open({ connectors: [withTools("jig-test", [stampTool().tool])] });
        assert.deepEqual(
            g.runtime.entries.map((entry) => [entry.name, entry.connector]),
            [
                ["jig", "jig-core"],
                ["stamp", "jig-test"],
            ],
        );
        const result = await g.call("jig", { action: "status" }, "call-s");
        assert.equal(result.isError, false);
        const [record] = g.records();
        assert.deepEqual(
            [
                record?.tool,
                record?.action,
                record?.plugin,
                record?.environment,
                record?.effect,
                record?.decision,
                record?.outcome,
            ],
            ["jig", "status", "jig-core", "local", "read", "allow", "ok"],
        );
        assert.deepEqual(
            [record?.agentName, record?.enforcedBy, record?.toolCallId],
            ["claude-code", "gateway", "call-s"],
        );
    });

    test("status lists what was decided, in order, with the decision or the line that refused the call", async () => {
        const g = open({ connectors: [withTools("jig-test", [stampTool().tool])], config: {} });
        await g.call("stamp", { action: "read" }, "c1");
        await g.call("stamp", { action: "write", text: "x" }, "c2");
        await g.call("nonesuch", {}, "c3");
        const status = await g.call("jig", { action: "status" }, "c4");
        assert.equal(
            status.text,
            [
                "The last 3 calls this gateway decided, the newest last:",
                "2026-10-30T10:00:00Z stamp read: allow",
                "2026-10-30T10:00:00Z stamp write: refused. Blocked by jig-core: this call needs approval and there is no screen to ask on.",
                "2026-10-30T10:00:00Z nonesuch: refused. Blocked by jig-core: nonesuch is not a tool of this gateway.",
            ].join("\n"),
        );
        // The call to status is in the list for the next one.
        assert.match(
            (await g.call("jig", { action: "status" }, "c5")).text,
            /\n2026-10-30T10:00:00Z jig status: allow$/,
        );
    });

    test("status says so when nothing was decided, and lists only the last twenty", async () => {
        const g = open({ connectors: [withTools("jig-test", [stampTool().tool])], config: {} });
        assert.equal(
            (await g.call("jig", { action: "status" }, "c0")).text,
            "This gateway has not decided a call yet.",
        );
        for (let index = 1; index <= STATUS_OUTCOMES + 5; index++)
            await g.call("stamp", { action: "read" }, `c${index}`);
        const lines = (await g.call("jig", { action: "status" }, "last")).text.split("\n");
        assert.equal(lines[0], `The last ${STATUS_OUTCOMES} calls this gateway decided, the newest last:`);
        assert.equal(lines.length, STATUS_OUTCOMES + 1);
        assert.doesNotMatch(
            lines.join("\n"),
            /jig status/,
            "the first status call is among the earliest, which are gone",
        );
        assert.match(lines.at(-1) ?? "", /stamp read: allow$/);
    });

    test("status says when no settings folder was found, or the folder has no jig.json, and when a connector did not load", async () => {
        const none = open({
            connectors: [],
            settings: false,
            startup: ["The jig-git connector could not be loaded, so its tools are missing."],
        });
        const first = (await none.call("jig", { action: "status" }, "c1")).text;
        assert.equal(first.split("\n")[0], NO_SETTINGS);
        assert.match(first, /\nThe jig-git connector could not be loaded/);
        assert.equal(none.runtime.settingsNote, NO_SETTINGS);

        const empty = open({ connectors: [] });
        assert.equal(
            (await empty.call("jig", { action: "status" }, "c1")).text.split("\n")[0],
            "The settings folder has no jig.json, so Jig runs with its built-in defaults.",
        );
        assert.equal(empty.runtime.settingsNote, undefined);

        const fine = open({ connectors: [], config: {} });
        assert.doesNotMatch((await fine.call("jig", { action: "status" }, "c1")).text, /settings|jig\.json/i);
    });

    test("status has one line for each problem in jig.json, naming the key and not the file, with a pointer to jig doctor", async () => {
        const g = open({ connectors: [], config: { records: { retentionDays: "many" }, nonesuch: 1 } });
        const lines = (await g.call("jig", { action: "status" }, "c1")).text.split("\n");
        const problems = lines.filter((line) => line.startsWith("jig.json: "));
        assert.equal(problems.length >= 2, true);
        assert.match(problems.join("\n"), /records\.retentionDays/);
        assert.match(problems.join("\n"), /nonesuch/);
        assert.equal(
            lines.some((line) => line.includes(g.settings)),
            false,
            "no path of this machine is told to the model",
        );
        assert.equal(lines[problems.length], "Run `jig doctor` to see these problems in full.");
    });

    test("any other action is refused by the SDK's check; called directly it says the only action is status", async () => {
        const g = open({ connectors: [] });
        const result = await g.call("jig", { action: "answer" }, "c1");
        assert.deepEqual(result, { text: "jig: the only action is status.", isError: true });
    });
});
