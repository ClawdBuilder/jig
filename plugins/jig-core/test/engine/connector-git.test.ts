// jig-git's connector, with no Pi (phase 2 of the portable build). `pr` and `release` are `EngineTool` objects, and `connector.ts` hands them to a host that is
// not Pi, with the registration of the `git` section. This file loads that connector in the process that refuses every Pi package, registers it with an
// engine the way a gateway will, and runs calls through `judge` and `run` over real repositories and a fake `gh` (the fakes of `plugins/jig-git/test/support`, which
// import only `node:` modules). It shows what a gateway needs: the tools load and run with no Pi, each call answers for the folder it is made in, and a
// write is refused when nobody can be asked.
import assert from "node:assert/strict";
import { afterEach, describe, test } from "node:test";
import connector from "../../../jig-git/src/connector.ts";
import { forgetSshAnswers } from "../../../jig-git/src/origin-host.ts";
import { forgetDefaultBranches, setWorkingDirectory } from "../../../jig-git/src/repo.ts";
import { installFakeGh } from "../../../jig-git/test/support/fake-gh.ts";
import type { FakeGh } from "../../../jig-git/test/support/fake-gh.ts";
import { installFakeSshConfig } from "../../../jig-git/test/support/fake-ssh-config.ts";
import { makeRepo, sandbox } from "../../../jig-git/test/support/repos.ts";
import type { Sandbox } from "../../../jig-git/test/support/repos.ts";
import { publishJig, withdrawJig } from "../../src/client.ts";
import { describeProblem } from "../../src/config.ts";
import type { EngineHost } from "../../src/engine.ts";
import { apiOf } from "../../src/engine-run.ts";
import type { ToolResult } from "../../src/engine-tool.ts";
import { ALLOW, request, SIGNAL, useWorlds } from "./harness.ts";
import type { World, WorldOptions } from "./harness.ts";

const open = useWorlds();

/** What is put back after each test: the sandbox, the fake programs on PATH, the module variable of jig-git and the API published for it. */
const cleanups: Array<() => void> = [];
afterEach(() => {
    for (const clean of cleanups.splice(0).reverse()) clean();
});

interface Scene {
    world: World;
    sb: Sandbox;
    gh: FakeGh;
}

/**
 * An engine with jig-git's connector registered and its tools declared, as a gateway will do it, over a sandbox of real repositories and a fake `gh`.
 * `register` comes before `start`, because `start` reads jig.json with the sections that were registered. `register: false` leaves it out.
 */
function scene(options: WorldOptions = {}, register = true): Scene {
    const sb = sandbox();
    const gh = installFakeGh(sb);
    installFakeSshConfig(sb);
    cleanups.push(() => {
        setWorkingDirectory(process.cwd());
        forgetDefaultBranches();
        forgetSshAnswers();
        sb.cleanup();
    });
    const world = open(options);
    const api = apiOf(world.engine.state);
    if (register) connector.register?.(api);
    for (const tool of connector.tools) api.declareTool(tool);
    // The tools reach jig-core through `jig()`, as they do in Pi, so the engine's API is published as the gateway will publish it.
    publishJig(api);
    cleanups.push(() => withdrawJig(api));
    world.engine.start(world.host);
    return { world, sb, gh };
}

/** A call made in `folder`: the host reports that folder as the working folder of the call. */
function hostFor(scene: Scene, folder: string): EngineHost {
    return { ...scene.world.host, cwd: folder };
}

/** Judges a call and, when it may run, runs it: what a gateway does with a request. */
async function ran(
    scene: Scene,
    tool: string,
    input: Record<string, unknown>,
    callId: string,
    folder: string,
    host: EngineHost = hostFor(scene, folder),
): Promise<ToolResult> {
    const asked = request(tool, callId, input);
    const judged = await scene.world.engine.judge(asked, host, SIGNAL);
    assert.equal(judged.verdict, "run", JSON.stringify(judged));
    if (judged.verdict !== "run") throw new Error("not run");
    const found = connector.tools.find((one) => one.tool === tool);
    if (found === undefined) throw new Error(`the connector offers no ${tool}`);
    return scene.world.engine.run(asked, judged.call, found, host, SIGNAL);
}

const row = (number: number, title: string) => ({
    number,
    title,
    state: "OPEN",
    isDraft: false,
    headRefName: "feature/x",
    baseRefName: "main",
    url: "u",
    author: { login: "hp" },
});

const detail = (number: number, head: string) => ({
    number,
    title: "Add the thing",
    state: "OPEN",
    isDraft: false,
    author: { login: "hp" },
    baseRefName: "main",
    headRefName: "feature/x",
    headRefOid: head,
    mergeable: "MERGEABLE",
    reviewDecision: "APPROVED",
    statusCheckRollup: [{ __typename: "CheckRun", name: "build", status: "COMPLETED", conclusion: "SUCCESS" }],
    url: `https://github.com/acme/alpha/pull/${number}`,
    body: "What changed and why.",
    labels: [],
    reviewRequests: [],
    autoMergeRequest: null,
});

/** The head a pull request has in these tests: the preview names it, and a change to it is a change of the plan. */
const HEAD = "1111111111111111111111111111111111111111";
const MOVED = "2222222222222222222222222222222222222222";

describe("the connector of jig-git", () => {
    test("is a ConnectorModule that loads with no Pi: two tools that work on the folder of the call, and the actions it keeps back", () => {
        assert.equal(connector.name, "jig-git");
        assert.deepEqual(
            connector.tools.map((tool) => tool.tool),
            ["pr", "release"],
        );
        for (const tool of connector.tools) {
            assert.equal(tool.plugin, "jig-git");
            assert.equal(tool.usesFolder, true, `${tool.tool} works on the folder of the call`);
            assert.equal(tool.sequential, true, `${tool.tool} runs one call at a time`);
        }
        assert.deepEqual(connector.notOffered, { pr: ["watch"], release: ["tag_create"] });
    });

    test("keeps back exactly the actions that write on this machine, which the engine would run with no question", () => {
        const kept: Record<string, string[]> = {};
        for (const tool of connector.tools) {
            const properties = tool.input.properties as { action: { enum: string[] } };
            const actions = properties.action.enum;
            kept[tool.tool] = actions.filter((action) => {
                const said = tool.classify({ action });
                return said?.environment === "local" && said.effect === "write";
            });
            for (const action of connector.notOffered?.[tool.tool] ?? []) {
                assert.ok(actions.includes(action), `${tool.tool} has no action ${action}`);
            }
        }
        assert.deepEqual(kept, connector.notOffered);
    });

    test("register makes the git section known: its check runs on jig.json, and a valid section is read back", () => {
        const known = scene({ config: { git: { base: "develop" } } });
        const api = apiOf(known.world.engine.state);
        assert.deepEqual(known.world.engine.state.personal.problems, []);
        assert.deepEqual(api.config.section("git"), { base: "develop" });
        assert.equal(known.world.engine.state.offSections?.has("git"), false);
    });

    test("register makes the git section known: a mistake in it is a problem, as in Pi", () => {
        const wrong = scene({ config: { git: { nonesuch: 1 } } });
        assert.match(wrong.world.engine.state.personal.problems.map(describeProblem).join("\n"), /git\.nonesuch/);
    });

    test("without register the git section is off: kept in the file, not checked and not read back", () => {
        const off = scene({ config: { git: { nonesuch: 1 } } }, false);
        assert.deepEqual(off.world.engine.state.personal.problems, []);
        assert.equal(off.world.engine.state.offSections?.has("git"), true);
        assert.equal(apiOf(off.world.engine.state).config.section("git"), undefined);
    });
});

describe("pr list and pr view through judge and run, with no Pi", () => {
    test("a read runs with no question, answers from gh, and leaves one record with its facts", async () => {
        const s = scene();
        const alpha = makeRepo(s.sb, "alpha", "acme");
        s.gh.on("pr list", { json: [row(3, "Add alpha")] }, ["acme/alpha"]);
        s.gh.on("pr view", { json: detail(7, HEAD) }, ["acme/alpha"]);

        const list = await ran(s, "pr", { action: "list" }, "call-1", alpha.dir);
        assert.equal(list.text, "alpha: 1 pull request\n#3 open feature/x -> main  Add alpha  @hp");
        assert.deepEqual(list.data, { numbers: [3] });
        assert.equal(list.isError, undefined);

        const view = await ran(s, "pr", { action: "view", number: 7 }, "call-2", alpha.dir);
        assert.match(view.text, /^PR #7 Add the thing \[open\] by @hp in alpha\n/);
        assert.match(view.text, /feature\/x -> main at 1111111; mergeable: MERGEABLE; review: APPROVED/);

        assert.deepEqual(s.world.log.asked, [], "a read asks nobody");
        assert.deepEqual(
            s.gh.calls().map((call) => `${call.args.slice(0, 2).join(" ")} ${call.args.slice(-2).join(" ")}`),
            [`pr list -R acme/alpha`, `pr view -R acme/alpha`],
            "gh was told the repository the folder is in",
        );
        const [first, second, ...more] = s.world.records();
        assert.equal(more.length, 0);
        for (const [record, action] of [
            [first, "list"],
            [second, "view"],
        ] as const) {
            assert.equal(record?.tool, "pr");
            assert.equal(record?.action, action);
            assert.equal(record?.plugin, "jig-git");
            assert.equal(record?.decision, "allow");
            assert.equal(record?.outcome, "ok");
            assert.equal(record?.agentName, "test");
        }
        assert.deepEqual(second?.facts, { pr: 7 }, "the facts of the result reach the record");
    });

    test("two calls at once for two folders each answer for their own, whatever the module variable holds", async () => {
        const s = scene();
        const alpha = makeRepo(s.sb, "alpha", "acme");
        const beta = makeRepo(s.sb, "beta", "acme");
        const gamma = makeRepo(s.sb, "gamma", "acme");
        // The variable the Pi route reads is set to a third folder: a call that read it would answer for gamma.
        setWorkingDirectory(gamma.dir);
        // alpha's answer is slow, so that both calls are in flight at once.
        s.gh.on("pr list", { json: [row(1, "Alpha work")], sleepMs: 300 }, ["acme/alpha"]);
        s.gh.on("pr list", { json: [row(2, "Beta work")] }, ["acme/beta"]);
        s.gh.on("pr list", { json: [row(3, "Gamma work")] }, ["acme/gamma"]);

        const [first, second] = await Promise.all([
            ran(s, "pr", { action: "list" }, "call-a", alpha.dir),
            ran(s, "pr", { action: "list" }, "call-b", beta.dir),
        ]);
        assert.match(first.text, /^alpha: 1 pull request\n#1 .*Alpha work/);
        assert.match(second.text, /^beta: 1 pull request\n#2 .*Beta work/);
        assert.equal(
            s.gh.calls().some((call) => call.args.includes("acme/gamma")),
            false,
            "nothing was asked about the folder in the module variable",
        );
        assert.deepEqual(
            s.world
                .records()
                .map((record) => record.toolCallId)
                .sort(),
            ["call-a", "call-b"],
        );
    });

    test("a repo name is a folder beside the repository the call is made in", async () => {
        const s = scene();
        const alpha = makeRepo(s.sb, "alpha", "acme");
        makeRepo(s.sb, "beta", "acme");
        s.gh.on("pr list", { json: [row(2, "Beta work")] }, ["acme/beta"]);
        // From inside alpha, `repo: "beta"` is looked up in the folder that holds alpha: the workspace of the call.
        const beta = await ran(s, "pr", { action: "list", repo: "beta" }, "call-1", alpha.dir);
        assert.match(beta.text, /^beta: 1 pull request/);
    });
});

describe("a write through judge and run, with no Pi", () => {
    test("with nobody to ask, pr comment is refused with the no-screen line, and nothing is sent", async () => {
        const s = scene({ canAsk: false });
        const alpha = makeRepo(s.sb, "alpha", "acme");
        const judged = await s.world.engine.judge(
            request("pr", "call-1", { action: "comment", number: 7, body: "Looks good" }),
            hostFor(s, alpha.dir),
            SIGNAL,
        );
        assert.deepEqual(judged, {
            verdict: "refused",
            kind: "no-screen",
            reason: "Blocked by jig-core: this call needs approval and there is no screen to ask on.",
        });
        assert.deepEqual(s.world.log.asked, []);
        assert.deepEqual(s.gh.calls(), [], "gh was not started");
    });

    test("with a screen, the preview is built for the folder of the call, and the tool runs with the preview it was shown", async () => {
        const s = scene({ answers: [ALLOW] });
        const alpha = makeRepo(s.sb, "alpha", "acme");
        const gamma = makeRepo(s.sb, "gamma", "acme");
        setWorkingDirectory(gamma.dir);
        s.gh.on("pr view", { json: detail(7, HEAD) }, ["acme/alpha"]);
        s.gh.on("pr merge", { stdout: "" });

        const merged = await ran(s, "pr", { action: "merge", number: 7, method: "squash" }, "call-1", alpha.dir);
        assert.equal(merged.text, "Merged pull request #7 into main (squash) at 1111111 in alpha.");
        assert.equal(s.world.log.asked.length, 1);
        assert.match(s.world.log.asked[0]?.preview.summary ?? "", /^squash-merge pull request 7 into main in alpha: /);
        assert.deepEqual(
            s.gh.callsOf("pr merge").map((call) => call.args.slice(-4)),
            [["--match-head-commit", HEAD, "-R", "acme/alpha"]],
        );
    });

    test("a pull request that changed after the preview is refused by the tool, and nothing is merged", async () => {
        const s = scene();
        const alpha = makeRepo(s.sb, "alpha", "acme");
        s.gh.on("pr view", { json: detail(7, HEAD) }, ["acme/alpha"]);
        s.gh.on("pr merge", { stdout: "" });
        // The user reads the preview, and in the meantime the head of the pull request moves.
        const host: EngineHost = {
            ...hostFor(s, alpha.dir),
            ask: async () => {
                s.gh.on("pr view", { json: detail(7, MOVED) }, ["acme/alpha"]);
                return ALLOW;
            },
        };
        const merged = await ran(s, "pr", { action: "merge", number: 7, method: "squash" }, "call-1", alpha.dir, host);
        assert.equal(merged.isError, true);
        assert.match(merged.text, /^pr merge: changed since the preview\. Nothing was changed/);
        assert.deepEqual(s.gh.callsOf("pr merge"), []);
    });
});
