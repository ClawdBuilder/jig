// The Concourse probe of the ops-ci watch kind, polled the way jig-core's engine polls it, against the fake Concourse: one
// build followed to its end (succeeded, failed, errored, aborted), found by its number, as the first one after a baseline, or
// as the first one after the first poll of a watch a push started. The tool's plan of a watch has its tests in
// ci-concourse.test.ts.
import assert from "node:assert/strict";
import type { TestContext } from "node:test";
import { describe, test } from "node:test";
import type { PollOutcome } from "../../jig-core/src/contract.ts";
import type { ConcourseSpec, ConcourseState } from "../src/ci/concourse-watch.ts";
import { describeSpec } from "../src/ci/watch.ts";
import type { CiSpec } from "../src/ci/watch.ts";
import { ciWorld } from "./support/ci-world.ts";
import type { CiWorld } from "./support/ci-world.ts";
import { build, concourseResponder, concourseWorld, TOKEN } from "./support/fake-concourse.ts";
import type { CcEvent, ConcourseWorld } from "./support/fake-concourse.ts";
import { concourseCi } from "./support/section.ts";

const PAGE = "https://ci.example.test/teams/main/pipelines/deploy/jobs/orders-api-staging/builds";
const SHA = "a".repeat(40);

type Outcome = PollOutcome<ConcourseState>;

async function start(t: TestContext, world: ConcourseWorld, ops?: Record<string, unknown>): Promise<CiWorld> {
    return ciWorld(t, {
        ci: concourseCi(),
        ...(ops === undefined ? {} : { ops }),
        responder: concourseResponder(world),
        secrets: { "env:CONCOURSE_TOKEN": TOKEN },
    });
}

async function poll(g: CiWorld, spec: CiSpec, state?: ConcourseState): Promise<Outcome> {
    g.h.jig.publish();
    const kind = g.h.jig.kinds.get("ops-ci") as unknown as {
        poll(s: unknown, st: unknown, signal: AbortSignal): Promise<unknown>;
    };
    return (await kind.poll(spec, state, new AbortController().signal)) as Outcome;
}

const watching = (more: Partial<ConcourseSpec> = {}): ConcourseSpec => ({
    system: "concourse",
    service: "orders-api",
    finish: { kind: "build" },
    ...more,
});

const lines = (count: number): CcEvent[] =>
    Array.from({ length: count }, (_, index) => ({ kind: "log", payload: `line ${index + 1}\n` }));

describe("a build followed by its number", () => {
    test("is pending while it runs, and waits as long as the settings say", async (t) => {
        const world = concourseWorld({ builds: [build(121, "started")] });
        const g = await start(t, world, { watch: { pollSeconds: 45 } });
        const first = await poll(g, watching({ build: "21" }));
        assert.equal(first.done, undefined);
        assert.equal(first.nextPollMs, 45_000);
        assert.deepEqual(first.state, { polls: 1, found: 121 });
        assert.equal(g.requests[0]?.path.endsWith("/builds/21"), true, "found by its number in the job");
    });

    test("passes when it succeeds, with the time it took, the counts and the link; later polls ask by Concourse's number", async (t) => {
        const world = concourseWorld({ builds: [build(121, "started")] });
        const g = await start(t, world);
        const first = await poll(g, watching({ build: "21" }));
        world.builds = [build(121, "succeeded")];
        const before = g.requests.length;
        const second = await poll(g, watching({ build: "21" }), first.state);
        assert.equal(second.done?.outcome, "passed");
        assert.equal(second.done?.summary, "build #21 of orders-api-staging succeeded in 5m02s");
        assert.deepEqual(second.done?.facts, { pass: 1, fail: 0, pending: 0, skipped: 0, conclusion: "succeeded" });
        assert.deepEqual(second.done?.links, [`${PAGE}/21`]);
        assert.equal(g.requests[before]?.path, "/api/v1/builds/121");
        assert.deepEqual(JSON.parse(JSON.stringify(second.state)), second.state, "the state is plain JSON");
        assert.equal(
            g.requests.some((request) => request.path.endsWith("/events")),
            false,
            "a passing build's log is not read",
        );
    });

    test("fails when it fails, with the last 40 lines of its log", async (t) => {
        const world = concourseWorld({ builds: [build(121, "failed")], events: { 121: lines(60) } });
        const g = await start(t, world);
        const { done } = await poll(g, watching({ build: "21" }));
        assert.equal(done?.outcome, "failed");
        assert.equal(done?.summary, "build #21 of orders-api-staging failed");
        assert.deepEqual(done?.details?.split("\n").slice(0, 2), ["line 21", "line 22"]);
        assert.equal(done?.details?.split("\n").length, 40);
        assert.equal(done?.details?.split("\n").at(-1), "line 60");
        assert.deepEqual(done?.links, [`${PAGE}/21`]);
        assert.equal(done?.facts?.fail, 1);
    });

    test("errored and aborted builds are failures with their own words", async (t) => {
        const world = concourseWorld({
            builds: [build(121, "errored"), build(122, "aborted")],
            events: { 121: [{ kind: "error", message: "no worker" }], 122: [] },
        });
        const g = await start(t, world);
        const errored = (await poll(g, watching({ build: "21" }))).done;
        assert.equal(errored?.outcome, "failed");
        assert.equal(errored?.summary, "build #21 of orders-api-staging errored");
        assert.equal(errored?.details, "[error] no worker");
        const aborted = (await poll(g, watching({ build: "22" }))).done;
        assert.equal(aborted?.outcome, "failed");
        assert.equal(aborted?.summary, "build #22 of orders-api-staging was aborted");
        assert.equal(aborted?.details, undefined, "an empty log adds nothing");
    });

    test("a log that cannot be read does not lose the result, and a secret in it is replaced", async (t) => {
        const world = concourseWorld({ builds: [build(121, "failed"), build(122, "failed")] });
        world.events[122] = [{ kind: "log", payload: "export DEPLOY_PASSWORD=hunter2hunter2\n" }];
        const g = await start(t, world);
        const none = (await poll(g, watching({ build: "21" }))).done;
        assert.equal(none?.outcome, "failed");
        assert.equal(none?.details, undefined);
        const secret = (await poll(g, watching({ build: "22" }))).done;
        assert.equal(secret?.details, "export DEPLOY_PASSWORD=[redacted]");
    });

    test("a build that does not exist yet is waited for", async (t) => {
        const world = concourseWorld({ builds: [build(120, "succeeded")] });
        const g = await start(t, world);
        const waiting = await poll(g, watching({ build: "21" }));
        assert.equal(waiting.done, undefined);
        assert.deepEqual(waiting.state, { polls: 1 });
    });
});

describe("the next build", () => {
    test("is the first one created after the baseline, whatever came before it or comes after", async (t) => {
        const world = concourseWorld({ builds: [build(119, "failed"), build(120, "succeeded")] });
        const g = await start(t, world);
        const spec = watching({ after: 120 });
        const waiting = await poll(g, spec);
        assert.equal(waiting.done, undefined);
        assert.deepEqual(waiting.state, { polls: 1 }, "builds from before the watch are not the one");
        world.builds.push(build(122, "started"), build(121, "started"));
        const followed = await poll(g, spec, waiting.state);
        assert.deepEqual(followed.state, { polls: 2, found: 121 }, "the first one after, not the newest");
        world.builds = world.builds.map((b) => (b.id === 121 ? build(121, "succeeded") : b));
        const done = await poll(g, spec, followed.state);
        assert.equal(done.done?.summary, "build #21 of orders-api-staging succeeded in 5m02s");
    });

    test("with no baseline (a watch a push started) the first poll notes the newest build and follows the next", async (t) => {
        const world = concourseWorld({ builds: [build(120, "started")] });
        const g = await start(t, world);
        const spec = watching({ sha: SHA });
        const first = await poll(g, spec);
        assert.deepEqual(first.state, { polls: 1, after: 120 });
        assert.equal(first.done, undefined);
        assert.equal(first.nextPollMs, 30_000);
        const second = await poll(g, spec, first.state);
        assert.deepEqual(second.state, { polls: 2, after: 120 }, "nothing new yet");
        world.builds.push(build(121, "succeeded"));
        const third = await poll(g, spec, second.state);
        assert.equal(third.done?.outcome, "passed");
        assert.deepEqual(third.state, { polls: 3, after: 120, found: 121 });
    });

    test("a job with no build yet has a baseline of 0", async (t) => {
        const world = concourseWorld();
        const g = await start(t, world);
        const first = await poll(g, watching());
        assert.deepEqual(first.state, { polls: 1, after: 0 });
        world.builds.push(build(101, "succeeded"));
        assert.equal((await poll(g, watching(), first.state)).done?.outcome, "passed");
    });
});

describe("what goes wrong in a poll", () => {
    test("a build of another job is a failed poll, which the engine counts", async (t) => {
        const world = concourseWorld({ builds: [build(121, "succeeded", { job_name: "other-job" })] });
        const g = await start(t, world);
        await assert.rejects(
            poll(g, watching({ build: "21" })),
            /returned a build that is not a build of orders-api-staging, so it was refused/,
        );
    });

    test("a login that is refused is a failed poll that says how to renew it", async (t) => {
        const world = concourseWorld({ builds: [build(121, "started")] });
        const g = await start(t, world);
        g.h.jig.secrets.set("env:CONCOURSE_TOKEN", "an-expired-token");
        await assert.rejects(
            poll(g, watching({ build: "21" })),
            /^Error: Concourse refused the login \(HTTP 401\): renew it with `fly -t main login` in your terminal/,
        );
    });

    test("a service that now uses another CI system cannot go on", async (t) => {
        const g = await start(t, concourseWorld());
        await assert.rejects(
            poll(g, { system: "jenkins", service: "orders-api", finish: { kind: "build" }, since: 0 }),
            /orders-api now uses concourse for CI, so this jenkins watch cannot go on/,
        );
    });
});

describe("the end of a watch", () => {
    test("with a commit publishes jig-ops:ci-finished, and without one publishes nothing", async (t) => {
        const world = concourseWorld({ builds: [build(121, "succeeded")] });
        const g = await start(t, world);
        const finished = () => g.h.bus.emitted.filter((entry) => entry.event === "jig-ops:ci-finished");
        await poll(g, watching({ build: "21" }));
        assert.deepEqual(finished(), []);
        await poll(g, watching({ build: "21", sha: SHA }));
        assert.deepEqual(
            finished().map((entry) => entry.payload),
            [
                {
                    repo: "acme/orders-api",
                    service: "orders-api",
                    system: "concourse",
                    sha: SHA,
                    finish: "build",
                    outcome: "passed",
                    summary: "build #21 of orders-api-staging succeeded in 5m02s",
                },
            ],
        );
    });

    test("is described in a line for the watch list", async () => {
        assert.equal(describeSpec(watching({ build: "21" })), "orders-api: build #21 of orders-api");
        assert.equal(describeSpec(watching({ after: 3 })), "orders-api: the next build of orders-api");
    });
});
