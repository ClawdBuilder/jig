// The gateway as a program: started as a child process and spoken to over its standard input and output, as Claude Code speaks to it (revision 2026-07-28, one
// JSON object on each line). The main case runs twice, with the same code: against `plugins/jig-core/src/gateway/main.ts` (node removes the types itself) and
// against the built file `plugins/jig-core/dist/jig-gateway.mjs` (plain node, which is what the command and the Claude Code plugin start). The child starts with the
// guard of test/support/refuse-pi.mjs, so a Pi package anywhere in the gateway or in jig-git's connector fails the call; it keeps its parent's state folder, so the
// records it writes can be read here. The calls run against real repositories and a fake `gh` (jig-git's test support), so nothing reaches GitHub. Standard
// output is the protocol's: every line the child writes there has to be a JSON-RPC message.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, test } from "node:test";
import { installFakeGh } from "../../jig-git/test/support/fake-gh.ts";
import type { FakeGh } from "../../jig-git/test/support/fake-gh.ts";
import { installFakeSshConfig } from "../../jig-git/test/support/fake-ssh-config.ts";
import { makeRepo, sandbox } from "../../jig-git/test/support/repos.ts";
import type { Fixture, Sandbox } from "../../jig-git/test/support/repos.ts";
import { assertQuietError, GatewayProcess, notJsonRpc, REFUSE_PI, resultOf, textOf } from "./support/gateway-child.ts";
import type { GatewayStart, Message } from "./support/gateway-child.ts";
import { readRecords, tempState } from "./support/state.ts";

const ROOT = path.resolve(import.meta.dirname, "../../..");
/** The two places the gateway runs from: the sources, and the file `npm run build:gateway` writes. */
const FROM_SOURCE = path.join(ROOT, "plugins/jig-core/src/gateway/main.ts");
const BUILT = path.join(ROOT, "plugins/jig-core/dist/jig-gateway.mjs");
const VERSION = (JSON.parse(readFileSync(path.join(ROOT, "package.json"), "utf8")) as { version: string }).version;

/** The engine's own line for a call that needs a question when nobody can be asked: written here in full, as the user reads it. */
const NO_SCREEN = "Blocked by jig-core: this call needs approval and there is no screen to ask on.";

/** What the test needs to put back after it: the state folder, the sandbox, the folders it made and the children it started. */
const cleanups: Array<() => void> = [];
afterEach(() => {
    for (const clean of cleanups.splice(0).reverse()) clean();
});

/** The gateway as a child process, which is killed when the test ends. It starts from source unless the test names another file. */
function start(options: Omit<GatewayStart, "file"> & { file?: string }): GatewayProcess {
    const gateway = new GatewayProcess({ file: FROM_SOURCE, ...options });
    cleanups.push(() => gateway.kill());
    return gateway;
}

interface World {
    sb: Sandbox;
    gh: FakeGh;
    alpha: Fixture;
    stateDir: string;
    /** A settings folder that holds an empty jig.json. */
    settings: string;
}

function world(): World {
    const temp = tempState();
    const stateDir = temp.start();
    const sb = sandbox();
    const gh = installFakeGh(sb);
    installFakeSshConfig(sb);
    const alpha = makeRepo(sb, "alpha", "acme");
    const settings = path.join(sb.root, "settings");
    mkdirSync(settings);
    writeFileSync(path.join(settings, "jig.json"), "{}");
    cleanups.push(() => {
        sb.cleanup();
        temp.stop();
    });
    return { sb, gh, alpha, stateDir, settings };
}

const row = (number: number, title: string) => ({
    number,
    title,
    state: "OPEN",
    isDraft: false,
    headRefName: "feature/x",
    baseRefName: "main",
    url: "u",
    author: { login: "octo" },
});

describe("the gateway as a process", () => {
    for (const [layout, file] of [
        ["from source", FROM_SOURCE],
        ["built", BUILT],
    ] as const) {
        test(`${layout}: lists its tools, answers a read from gh, refuses a write with the engine's line, writes three records for the gateway, and leaves when input ends`, async () => {
            const w = world();
            w.gh.on("pr list", { json: [row(3, "Add alpha")] }, ["acme/alpha"]);
            const gateway = start({ file, cwd: w.alpha.dir, env: { ...process.env, JIG_HOME: w.settings } });

            // Revision 2026-07-28: the client does not open with initialize; it asks what the server speaks.
            const discovered = resultOf(await gateway.request("server/discover"));
            assert.deepEqual(discovered.supportedVersions, ["2026-07-28"]);
            assert.doesNotMatch(String(discovered.instructions), /No settings folder/, "JIG_HOME named the folder");

            // The tools: jig, pr and release. The two that work on a folder have dir; the actions that run with no question are not in the form.
            const listed = (resultOf(await gateway.request("tools/list")).tools as Array<Message>).map((tool) => tool);
            assert.deepEqual(
                listed.map((tool) => tool.name),
                ["jig", "pr", "release"],
            );
            const form = (name: string): Record<string, Message> => {
                const schema = listed.find((tool) => tool.name === name)?.inputSchema as
                    | { properties: Record<string, Message> }
                    | undefined;
                return schema?.properties ?? {};
            };
            assert.deepEqual(Object.keys(form("jig")), ["action"]);
            assert.equal(form("pr").dir?.type, "string");
            assert.equal(form("release").dir?.type, "string");
            const actions = (name: string): string[] => (form(name).action?.enum as string[] | undefined) ?? [];
            assert.equal(actions("pr").includes("watch"), false);
            assert.equal(actions("pr").includes("list"), true);
            assert.equal(actions("release").includes("tag_create"), false);
            assert.equal(actions("release").includes("tag_push"), true);
            assert.deepEqual(w.gh.calls(), [], "listing the tools called nothing");
            assert.deepEqual(readRecords(w.stateDir), [], "and wrote nothing");

            // A read runs, and gh answers it.
            const listing = await gateway.call(
                "pr",
                { action: "list", dir: w.alpha.dir },
                { "claudecode/toolUseId": "toolu_test_1", progressToken: "progress-1" },
            );
            assert.equal(resultOf(listing).isError, undefined);
            assert.match(textOf(listing), /^alpha: 1 pull request\n#3 open feature\/x -> main {2}Add alpha {2}@octo$/);
            assert.equal(w.gh.callsOf("pr list").length, 1);

            // A write is refused with the line the engine says, and gh is not called.
            const comment = await gateway.call(
                "pr",
                { action: "comment", number: 1, body: "x", dir: w.alpha.dir },
                { "claudecode/toolUseId": "toolu_test_2" },
            );
            assert.equal(comment.error, undefined, "a refusal is a result and not a protocol error");
            assert.equal(resultOf(comment).isError, true);
            assert.equal(textOf(comment), NO_SCREEN);
            assert.deepEqual(w.gh.callsOf("pr comment"), []);

            // The jig tool shows both.
            const status = textOf(
                await gateway.call("jig", { action: "status" }, { "claudecode/toolUseId": "toolu_test_3" }),
            );
            assert.match(status, /\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ pr list: allow$/m);
            assert.match(status, new RegExp(`Z pr comment: refused\\. ${NO_SCREEN}$`, "m"));

            // Three records, all the gateway's, for the agent that said who it was, under the ids it sent.
            const records = readRecords(w.stateDir);
            assert.deepEqual(
                records.map((record) => [record.toolCallId, record.tool, record.action]),
                [
                    ["toolu_test_1", "pr", "list"],
                    ["toolu_test_2", "pr", "comment"],
                    ["toolu_test_3", "jig", "status"],
                ],
            );
            for (const record of records) {
                assert.equal(record.kind, "call");
                assert.equal(record.agentName, "claude-code");
                assert.equal(record.enforcedBy, "gateway");
            }
            assert.equal(new Set(records.map((record) => record.session)).size, 1, "one session for the process");
            assert.deepEqual([records[0]?.decision, records[0]?.outcome], ["allow", "ok"]);
            assert.deepEqual(
                [records[1]?.decision, records[1]?.outcome, records[1]?.errorKind],
                ["deny", "blocked", "no-screen"],
            );

            // When the agent closes its end, the gateway ends the session and leaves with code 0, having written only JSON-RPC to standard output.
            assert.deepEqual(await gateway.end(), { code: 0, signal: null });
            assert.deepEqual(notJsonRpc(gateway.lines), []);
            assert.equal(gateway.lines.length >= 5, true, "an answer for each request");
            assertQuietError(gateway);
        });
    }

    test("a call without dir is made in the folder the gateway started in, and a dir that is not a folder is refused with a record", async () => {
        const w = world();
        w.gh.on("pr list", { json: [row(4, "Started here")] }, ["acme/alpha"]);
        const gateway = start({ cwd: w.alpha.dir, env: { ...process.env, JIG_HOME: w.settings } });

        const here = await gateway.call("pr", { action: "list" });
        assert.match(textOf(here), /^alpha: 1 pull request\n#4 /);

        const bad = await gateway.call("pr", { action: "list", dir: "alpha" });
        assert.equal(resultOf(bad).isError, true);
        assert.equal(textOf(bad), "Blocked by jig-core: dir must be an absolute path to a folder.");
        assert.equal(w.gh.callsOf("pr list").length, 1, "gh was asked once");

        // A call the SDK's own check rejects (a kept-back action) is an error result with the SDK's words, and leaves no record.
        const watch = await gateway.call("pr", { action: "watch", number: 1 });
        assert.equal(resultOf(watch).isError, true);
        assert.match(textOf(watch), /allowed values/);

        assert.deepEqual(
            readRecords(w.stateDir).map((record) => [record.tool, record.outcome, record.errorKind]),
            [
                ["pr", "ok", undefined],
                ["pr", "error", "not-run"],
            ],
        );
        assert.deepEqual(await gateway.end(), { code: 0, signal: null });
        assert.deepEqual(notJsonRpc(gateway.lines), []);
        assertQuietError(gateway);
    });

    test("with no settings folder, and an empty JIG_HOME as Claude Code passes it, it starts, runs on the defaults, and says so", async () => {
        const w = world();
        const gateway = start({ cwd: w.alpha.dir, env: { ...process.env, JIG_HOME: "" } });
        const discovered = resultOf(await gateway.request("server/discover"));
        assert.match(String(discovered.instructions), /No settings folder was found/);
        const status = textOf(await gateway.call("jig", { action: "status" }));
        assert.match(status, /^No settings folder was found /);
        assert.deepEqual(await gateway.end(), { code: 0, signal: null });
        assertQuietError(gateway);
    });

    test("--home names the folder in the agent's entry, and wins over JIG_HOME", async () => {
        const w = world();
        const other = mkdtempSync(path.join(tmpdir(), "jig-other-"));
        cleanups.push(() => rmSync(other, { recursive: true, force: true }));
        // The folder of the argument has a jig.json with a mistake, which `status` names; the one in JIG_HOME is fine.
        writeFileSync(path.join(other, "jig.json"), JSON.stringify({ nonesuch: 1 }));
        const gateway = start({
            cwd: w.alpha.dir,
            env: { ...process.env, JIG_HOME: w.settings },
            args: ["--home", other],
        });
        const status = textOf(await gateway.call("jig", { action: "status" }));
        assert.match(status, /^jig\.json: .*nonesuch/m);
        assert.deepEqual(await gateway.end(), { code: 0, signal: null });
        assertQuietError(gateway);
    });
});

describe("the gateway's own words", () => {
    for (const [layout, file, program] of [
        ["from source", FROM_SOURCE, "main.ts"],
        ["built", BUILT, "jig-gateway"],
    ] as const) {
        test(`${layout}: --version prints the version of the package and --help says how it is started, with the name the program has in this layout, and neither starts a server`, () => {
            const run = (flag: string) =>
                spawnSync(process.execPath, ["--import", REFUSE_PI, file, flag], { encoding: "utf8", timeout: 20_000 });
            const version = run("--version");
            assert.equal(version.status, 0, version.stderr);
            assert.equal(version.stdout, `${VERSION}\n`);
            const help = run("--help");
            assert.equal(help.status, 0, help.stderr);
            assert.match(help.stdout, new RegExp(`^Usage: ${program} \\[--home <folder>\\]`, "m"));
            assert.match(help.stdout, /JIG_HOME/);
        });
    }

    test("the guard that the child starts with refuses a Pi package, so the calls above ran with none loaded", () => {
        const refused = spawnSync(
            process.execPath,
            ["--import", REFUSE_PI, "--input-type=module", "-e", 'await import("@earendil-works/pi-coding-agent")'],
            { encoding: "utf8", timeout: 20_000 },
        );
        assert.notEqual(refused.status, 0);
        assert.match(refused.stderr, /was imported in a process that has no Pi/);
    });

    test("the check for standard output finds a line that is not a JSON-RPC message", () => {
        assert.deepEqual(
            notJsonRpc(['{"jsonrpc":"2.0","id":1,"result":{}}', '{"jsonrpc":"2.0","method":"notifications/progress"}']),
            [],
        );
        assert.deepEqual(notJsonRpc(["hello", "[1]", "{}", '{"jsonrpc":"1.0"}', "42", "null"]), [
            "hello",
            "[1]",
            "{}",
            '{"jsonrpc":"1.0"}',
            "42",
            "null",
        ]);
    });
});
