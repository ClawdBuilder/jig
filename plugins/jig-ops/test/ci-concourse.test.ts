// The Concourse adapter of the ci tool, against a fake Concourse on 127.0.0.1: status, runs, run and log, and trigger with
// its preview, its single send and what a lost reply does, the sign-in modes and the words for a login that is refused, and the
// check that a build belongs to the catalog's job. Concourse has no rerun, and the tests say so. The watch has its tests in
// ci-concourse-watch.test.ts.
import assert from "node:assert/strict";
import type { TestContext } from "node:test";
import { describe, test } from "node:test";
import { ok } from "./support/harness.ts";
import { ciWorld } from "./support/ci-world.ts";
import type { CiWorld } from "./support/ci-world.ts";
import type { Answer, Responder } from "./support/fake-server.ts";
import { build, concourseResponder, concourseWorld, TOKEN } from "./support/fake-concourse.ts";
import type { ConcourseWorld } from "./support/fake-concourse.ts";
import { concourseCi } from "./support/section.ts";
import type { Raw } from "./support/section.ts";

const JOB = "/api/v1/teams/main/pipelines/deploy/jobs/orders-api-staging";
const PAGE = "https://ci.example.test/teams/main/pipelines/deploy/jobs/orders-api-staging/builds";
const HASH = "4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e";

/** The world Concourse has by default: a green build #20 started by hand, a red #19 with its log, and an aborted #18. */
function usual(): ConcourseWorld {
    return concourseWorld({
        builds: [build(118, "aborted"), build(119, "failed"), build(120, "succeeded", { created_by: "jdoe" })],
        inputs: { 120: [{ name: "deploy-control", version: { ref: HASH } }], 119: [] },
        events: {
            119: [
                { kind: "start-task" },
                { kind: "log", payload: "\u001b[31mstep one\u001b[0m\n" },
                { kind: "log", payload: "deploy FAILED: timeout\r\n" },
                { kind: "error", message: "exit status 1" },
                { kind: "status", status: "failed" },
            ],
            120: [{ kind: "log", payload: "ok\n" }],
        },
    });
}

async function start(
    t: TestContext,
    world = usual(),
    more: { ci?: Raw; responder?: Responder; timeoutMs?: number } = {},
): Promise<CiWorld & { world: ConcourseWorld }> {
    const made = await ciWorld(t, {
        ci: more.ci ?? concourseCi(),
        responder: more.responder ?? concourseResponder(world),
        secrets: { "env:CONCOURSE_TOKEN": TOKEN },
        ...(more.timeoutMs === undefined ? {} : { timeoutMs: more.timeoutMs }),
    });
    return { ...made, world };
}

const posts = (g: CiWorld) => g.requests.filter((request) => request.method === "POST");
const paths = (g: CiWorld) => g.requests.map((request) => `${request.method} ${request.path}`);

describe("reads", () => {
    test("status: the newest build with its times and who started it, a link, and the bucket counted", async (t) => {
        const g = await start(t);
        const result = await g.call({ action: "status" });
        assert.equal(
            ok(result),
            [
                "build #20 of orders-api-staging: succeeded, took 5m02s (2026-11-01 12:32 UTC), started by jdoe",
                `${PAGE}/20`,
            ].join("\n"),
        );
        assert.deepEqual(g.h.jig.facts.get(result.id), [
            { pass: 1, fail: 0, pending: 0, skipped: 0, conclusion: "succeeded" },
        ]);
        assert.deepEqual(paths(g), [`GET ${JOB}`, "GET /api/v1/teams/main/pipelines/deploy", `GET ${JOB}/builds`]);
        assert.equal(g.requests[2]?.query.get("limit"), "1");
        assert.equal(g.requests[0]?.headers.authorization, `Bearer ${TOKEN}`, "the token goes as a bearer");
        assert.deepEqual([result.cls?.environment, result.cls?.effect], ["external", "read"]);
    });

    test("status of a build by number says paused when the job or the pipeline is", async (t) => {
        const world = usual();
        world.paused = true;
        world.pipelinePaused = true;
        const g = await start(t, world);
        assert.equal(
            ok(await g.call({ action: "status", run_id: 19 })),
            [
                "build #19 of orders-api-staging: failed, took 5m02s (2026-11-01 12:22 UTC)",
                `${PAGE}/19`,
                "The job orders-api-staging is paused: a build started now will not run.",
                "The pipeline deploy is paused: a build started now will not run.",
            ].join("\n"),
        );
        assert.equal(g.requests.at(-1)?.path, `${JOB}/builds/19`, "found by its number in the job");
    });

    test("status of a build that is not there, and of a job that was never built", async (t) => {
        const g = await start(t);
        assert.equal(
            (await g.call({ action: "status", run_id: 99 })).error?.message,
            "orders-api-staging has no build 99",
        );
        g.world.builds = [];
        assert.equal((await g.call({ action: "status" })).error?.message, "orders-api-staging has no build yet");
    });

    test("a build that has not started is pending, and one that is running is never a pass", async (t) => {
        const world = usual();
        world.builds.push(build(121, "pending"), build(122, "started"));
        const g = await start(t, world);
        const pending = g.h.jig.facts;
        assert.match(ok(await g.call({ action: "status", run_id: 21 })), /^build #21 of orders-api-staging: pending\n/);
        const result = await g.call({ action: "status" });
        assert.match(ok(result), /^build #22 of orders-api-staging: started \(2026-11-01 12:52 UTC\)\n/);
        assert.deepEqual(pending.get(result.id), [{ pass: 0, fail: 0, pending: 1, skipped: 0, conclusion: "started" }]);
    });

    test("runs: one line per build, newest first; a state filters; the limit goes to Concourse", async (t) => {
        const g = await start(t);
        assert.equal(
            ok(await g.call({ action: "runs", limit: 3 })),
            [
                "orders-api-staging: 3 builds",
                "#20 succeeded 2026-11-01 12:32 UTC",
                "#19 failed    2026-11-01 12:22 UTC",
                "#18 aborted   2026-11-01 12:12 UTC",
            ].join("\n"),
        );
        assert.equal(g.requests[0]?.query.get("limit"), "3");
        assert.equal(
            ok(await g.call({ action: "runs", state: "failed" })),
            "orders-api-staging: 1 build\n#19 failed    2026-11-01 12:22 UTC",
        );
        assert.equal(g.requests.at(-1)?.query.get("limit"), "100", "Concourse cannot filter, so a window is read");
        assert.match(
            ok(await g.call({ action: "runs", state: "errored" })),
            /^No builds match in orders-api-staging\.$/,
        );
        assert.match(
            (await g.call({ action: "runs", state: "success" })).error?.message ?? "",
            /state must be one of pending, started, succeeded, failed, errored, aborted/,
        );
    });

    test("runs lists at most 20 builds", async (t) => {
        const g = await start(t);
        assert.match(
            (await g.call({ action: "runs", limit: 21 })).error?.message ?? "",
            /^ci runs: limit must be a whole number from 1 to 20 for Concourse$/,
        );
        assert.deepEqual(g.requests, []);
    });

    test("run: the build and the versions of its inputs, or why there are none", async (t) => {
        const g = await start(t);
        assert.equal(
            ok(await g.call({ action: "run", run_id: 20 })),
            [
                "build #20 of orders-api-staging: succeeded, took 5m02s (2026-11-01 12:32 UTC), started by jdoe",
                `${PAGE}/20`,
                "inputs:",
                `- deploy-control: ref=${HASH}`,
            ].join("\n"),
        );
        assert.match(ok(await g.call({ action: "run", run_id: 19 })), /\ninputs: none$/);
        assert.match(
            ok(await g.call({ action: "run", run_id: 18 })),
            /\n\(Concourse shows no inputs for this build\)$/,
        );
        assert.equal(g.requests.at(-1)?.path, "/api/v1/builds/118/resources", "found by Concourse's own number");
    });

    test("a build of another job, pipeline or team is refused, however it was asked for", async (t) => {
        for (const other of [
            { job_name: "other-job" },
            { pipeline_name: "other" },
            { team_name: "other" },
            { job_name: undefined },
        ]) {
            const world = usual();
            world.builds.push(build(121, "succeeded", other));
            const g = await start(t, world);
            const refusal =
                /^Concourse GET .* returned a build that is not a build of orders-api-staging, so it was refused$/;
            assert.match((await g.call({ action: "status", run_id: 21 })).error?.message ?? "", refusal);
            assert.match((await g.call({ action: "status" })).error?.message ?? "", refusal);
            assert.match((await g.call({ action: "runs" })).error?.message ?? "", refusal);
            assert.match((await g.call({ action: "log", run_id: 21 })).error?.message ?? "", refusal);
        }
    });

    test("a build in a shape nobody knows is refused, and so is a list that is not one", async (t) => {
        const g = await start(t, usual(), {
            responder: (request) =>
                request.path.endsWith("/builds")
                    ? { json: { builds: [] } }
                    : { json: { id: "x", name: "1", status: 5 } },
        });
        assert.match((await g.call({ action: "runs" })).error?.message ?? "", /not a list$/);
        assert.match(
            (await g.call({ action: "status", run_id: 1 })).error?.message ?? "",
            /in a shape this plugin does not know$/,
        );
    });

    test("rerun is not offered, and a job has no ref or parameters to start with", async (t) => {
        const g = await start(t);
        assert.match(
            (await g.call({ action: "rerun", run_id: 19 })).blocked ?? "",
            /ci rerun: Concourse \(orders-api\) does not support rerun\. It supports: status, runs, run, log, trigger, watch/,
        );
        assert.match(
            (await g.call({ action: "trigger", ref: "main" })).blocked ?? "",
            /ci trigger: Concourse \(orders-api\) does not take ref\. Usage: ci trigger \{service\}/,
        );
        assert.match(
            (await g.call({ action: "trigger", parameters: { A: "1" } })).blocked ?? "",
            /does not take parameters/,
        );
        assert.deepEqual(g.requests, []);
    });
});

describe("log", () => {
    test("the last failed build, rendered from its events: output, errors and statuses, cleaned", async (t) => {
        // Concourse keeps the stream open after its end event; the request lets go at that event and does not wait.
        const g = await start(t, usual(), { timeoutMs: 5_000 });
        assert.equal(
            ok(await g.call({ action: "log" })),
            [
                "Build #19 of orders-api-staging (failed): the whole log",
                "step one",
                "deploy FAILED: timeout",
                "[error] exit status 1",
                "[status] failed",
            ].join("\n"),
        );
        const events = g.requests.at(-1);
        assert.equal(events?.path, "/api/v1/builds/119/events", "by Concourse's own number");
        assert.equal(events?.headers.accept, "text/event-stream");
    });

    test("a search, the tail, and a build by number", async (t) => {
        const g = await start(t);
        assert.equal(
            ok(await g.call({ action: "log", run_id: 19, grep: "timeout" })),
            "Build #19 of orders-api-staging (failed): 1 matching lines\n2: deploy FAILED: timeout",
        );
        assert.match(
            ok(await g.call({ action: "log", run_id: 19, tail: 2 })),
            /: the last 2 lines; 2 earlier lines left out\n\[error\] exit status 1\n\[status\] failed$/,
        );
        assert.match(
            ok(await g.call({ action: "log", run_id: 20 })),
            /^Build #20 of orders-api-staging \(succeeded\): the whole log\nok$/,
        );
    });

    test("the events are read in the bare form too, and a stream that ends without an end event is read to its close", async (t) => {
        const world = usual();
        world.form = "bare";
        const g = await start(t, world);
        assert.match(
            ok(await g.call({ action: "log", run_id: 19 })),
            /\nstep one\ndeploy FAILED: timeout\n\[error\] exit status 1\n/,
        );
        world.form = "wrapped";
        world.end = false;
        world.hold = false;
        assert.match(ok(await g.call({ action: "log", run_id: 19 })), /\[status\] failed$/);
    });

    test("a build that is running has a log that comes with ci watch, and the stream is not opened", async (t) => {
        const world = usual();
        world.builds.push(build(121, "started"), build(122, "pending"));
        world.events[121] = [{ kind: "log", payload: "going\n" }];
        const g = await start(t, world);
        assert.equal(
            ok(await g.call({ action: "log", run_id: 21 })),
            "Build #21 of orders-api-staging is still running; its log comes with `ci watch`.",
        );
        assert.equal(
            ok(await g.call({ action: "log", run_id: 22 })),
            "Build #22 of orders-api-staging is waiting to start; its log comes with `ci watch`.",
        );
        assert.ok(!g.requests.some((request) => request.path.endsWith("/events")));
    });

    test("no failed build among the latest is said, and a build with no events has no log", async (t) => {
        const world = usual();
        world.builds = [build(120, "succeeded")];
        const g = await start(t, world);
        assert.equal(
            (await g.call({ action: "log" })).error?.message,
            "orders-api-staging has no failed build among its last 20; pass run_id",
        );
        delete world.events[120];
        assert.equal((await g.call({ action: "log", run_id: 20 })).error?.message, "build 20 has no log");
    });

    test("more than 8 MiB is refused, and a secret in the log is replaced", async (t) => {
        const world = usual();
        world.events[119] = [{ kind: "log", payload: "export DEPLOY_PASSWORD=hunter2hunter2 done\n" }];
        const g = await start(t, world);
        const text = ok(await g.call({ action: "log" }));
        assert.match(text, /DEPLOY_PASSWORD=\[redacted\]/);
        assert.doesNotMatch(text, /hunter2/);
        world.events[119] = [{ kind: "log", payload: "x".repeat(9 * 1024 * 1024) }];
        assert.match((await g.call({ action: "log" })).error?.message ?? "", /the reply is larger than 8 MiB/);
    });
});

describe("what a server says when it will not", () => {
    test("401 and 403 say the login was refused and how to renew it, never a value", async (t) => {
        for (const status of [401, 403]) {
            const g = await start(t, usual(), { responder: () => ({ status, json: { error: "nope" } }) });
            const error = (await g.call({ action: "status" })).error?.message ?? "";
            assert.equal(
                error,
                `Concourse refused the login (HTTP ${status}): renew it with \`fly -t main login\` in your terminal, then run the call again.`,
            );
            assert.ok(!error.includes(TOKEN));
            assert.equal(g.requests.length, 1, "nothing more is asked once the login is refused");
        }
    });

    test("without signInHint the message still says the login is the user's to renew", async (t) => {
        const g = await start(t, usual(), {
            ci: concourseCi({ signInHint: undefined }),
            responder: () => ({ status: 401, text: "" }),
        });
        assert.equal(
            (await g.call({ action: "runs" })).error?.message,
            "Concourse refused the login (HTTP 401): renew it yourself in your terminal, then run the call again.",
        );
    });

    test("a token that cannot be read gets the same help, with the reason the command gave", async (t) => {
        const g = await start(t);
        g.h.jig.secrets.clear();
        assert.equal(
            (await g.call({ action: "status" })).error?.message,
            "Concourse login could not be read (the secret could not be resolved): renew it with `fly -t main login` in your terminal, then run the call again.",
        );
        assert.deepEqual(g.requests, [], "nothing was sent");
    });

    test("a job that is not there is named by its team, pipeline and job, and a page of HTML is not quoted", async (t) => {
        const g = await start(t, usual(), { ci: concourseCi({ job: "missing" }) });
        assert.equal(
            (await g.call({ action: "runs" })).error?.message,
            "Concourse GET builds failed: HTTP 404 (not found: check the team, pipeline and job in the catalog, and that the account can see them)",
        );
    });

    test("a redirect is never followed", async (t) => {
        const g = await start(t, usual(), {
            responder: () => ({ status: 302, headers: { location: "https://login.example.test/" }, text: "" }),
        });
        assert.match(
            (await g.call({ action: "status" })).error?.message ?? "",
            /HTTP 302 \(the server redirected the request, which is never followed/,
        );
        assert.equal(g.requests.length, 1);
    });
});

describe("trigger", () => {
    test("is an external write that asks; the job is started with a POST that has no body, once", async (t) => {
        const g = await start(t);
        const result = await g.call({ action: "trigger" });
        assert.deepEqual([result.cls?.environment, result.cls?.effect], ["external", "write"]);
        assert.equal(result.preview?.summary, "start the job orders-api-staging (Concourse, pipeline deploy)");
        assert.equal(
            result.preview?.body,
            [
                "Service:       orders-api",
                "Job:           orders-api-staging (Concourse, team main, pipeline deploy)",
                "Last build:    #20 succeeded, started 2026-11-01 12:32 UTC by jdoe",
                "Sent once. If the reply is lost, the job's builds are read once and nothing is sent again.",
            ].join("\n"),
        );
        assert.match(result.preview?.fingerprint ?? "", /^[0-9a-f]{32}$/);
        assert.equal(ok(result), "Started build #21 of orders-api-staging (pending).");
        const order = paths(g);
        assert.equal(order.at(-1), `POST ${JOB}/builds`);
        assert.equal(posts(g).length, 1);
        assert.equal(posts(g)[0]?.body, "");
        assert.equal(posts(g)[0]?.headers.authorization, `Bearer ${TOKEN}`);
        assert.equal(g.world.started, 1);
        assert.equal(g.h.jig.facts.get(result.id)?.[0]?.outcome, "started");
    });

    test("a build that is running is said in the preview, and the first build of a job is none yet", async (t) => {
        const world = usual();
        world.builds.push(build(121, "started", { created_by: "jdoe" }));
        const g = await start(t, world);
        const running = await g.call({ action: "trigger" });
        assert.match(
            running.preview?.body ?? "",
            /Last build: {4}#21 started, started 2026-11-01 12:42 UTC by jdoe\nA build is running: if the job runs one at a time, this one queues\.\nSent once/,
        );
        world.builds = [];
        const empty = await g.call({ action: "trigger" });
        assert.match(empty.preview?.body ?? "", /Last build: {4}none yet\n/);
        assert.equal(ok(empty), "Started build #1 of orders-api-staging (pending).");
    });

    test("a paused job or pipeline, and a job that cannot be started by hand, are refused before anyone is asked", async (t) => {
        const world = usual();
        const g = await start(t, world);
        world.paused = true;
        const job = await g.call({ action: "trigger" });
        assert.match(
            job.blocked ?? "",
            /ci trigger: orders-api-staging is paused in Concourse, so a build would not run$/,
        );
        assert.equal(job.preview, undefined);
        world.paused = false;
        world.pipelinePaused = true;
        assert.match(
            (await g.call({ action: "trigger" })).blocked ?? "",
            /ci trigger: the pipeline deploy is paused in Concourse, so a build would not run$/,
        );
        world.pipelinePaused = false;
        world.disableManualTrigger = true;
        assert.match(
            (await g.call({ action: "trigger" })).blocked ?? "",
            /ci trigger: orders-api-staging cannot be started by hand/,
        );
        assert.deepEqual(posts(g), []);
        assert.equal(world.started, 0);
    });

    test("refuses to send when a build appeared after the user saw the preview", async (t) => {
        const g = await start(t);
        const result = await g.call(
            { action: "trigger" },
            { between: () => void g.world.builds.push(build(121, "started")) },
        );
        assert.match(
            result.error?.message ?? "",
            /^ci trigger of orders-api changed since the preview; run it again to see the new preview\. Nothing was sent$/,
        );
        assert.deepEqual(posts(g), []);
    });

    test("a refusal is a plain failure and is not checked or repeated", async (t) => {
        const world = usual();
        const inner = concourseResponder(world);
        const g = await start(t, world, {
            responder: (request, n): Answer =>
                request.method === "POST" ? { status: 400, text: "<html>Bad</html>" } : (inner(request, n) as Answer),
        });
        assert.equal(
            (await g.call({ action: "trigger" })).error?.message,
            "Concourse POST build of orders-api-staging failed: HTTP 400",
        );
        assert.equal(posts(g).length, 1);
    });

    test("a login that is refused at the send is said, and nothing was started", async (t) => {
        const world = usual();
        const inner = concourseResponder(world);
        const g = await start(t, world, {
            responder: (request, n): Answer =>
                request.method === "POST" ? { status: 401, text: "" } : (inner(request, n) as Answer),
        });
        assert.equal(
            (await g.call({ action: "trigger" })).error?.message,
            "Concourse refused the login (HTTP 401): renew it with `fly -t main login` in your terminal, then run the call again.",
        );
        assert.equal(posts(g).length, 1, "sent once, and not asked again");
    });

    test("a transport that breaks after a trigger sent is lost, read once and never resent", async (t) => {
        const world = usual();
        world.authorized = () => true;
        const inner = concourseResponder(world);
        const g = await ciWorld(t, {
            ci: concourseCi({ url: "http://concourse.internal.example.test", auth: { transport: "corp" } }),
            transport: "corp",
            responder: (request, n) => (request.method === "POST" ? { reset: true } : inner(request, n)),
        });
        const error = (await g.call({ action: "trigger" })).error?.message ?? "";
        assert.match(error, /the reply was lost \(transport "corp" failed/);
        assert.match(error, /Nothing was sent twice/);
        assert.equal(g.transport?.requests.filter((request) => request.method === "POST").length, 1);
    });

    test("a reply that is lost is read once: a newer build means it started, and nothing is sent twice", async (t) => {
        const world = usual();
        const inner = concourseResponder(world);
        const g = await start(t, world, {
            responder: (request, n) => {
                const answer = inner(request, n);
                return request.method === "POST" ? { ...answer, reset: true } : answer;
            },
        });
        const text = ok(await g.call({ action: "trigger" }));
        assert.match(
            text,
            /^Started build #21 of orders-api-staging \(pending\)\.\n\(The reply was lost \(.*\); one check shows it went through\. Nothing was sent twice\.\)$/,
        );
        assert.equal(posts(g).length, 1);
        assert.equal(world.started, 1);
        assert.equal(g.requests.at(-1)?.query.get("limit"), "5", "one read of the latest builds");
    });

    test("a timeout that started nothing says it may still appear, and the job is not started again", async (t) => {
        const world = usual();
        const inner = concourseResponder(world);
        const g = await start(t, world, {
            timeoutMs: 200,
            responder: (request, n) => (request.method === "POST" ? { hang: true } : inner(request, n)),
        });
        const error = (await g.call({ action: "trigger" })).error?.message ?? "";
        assert.match(
            error,
            /^Concourse build: the reply was lost \(no answer within \d+ s\)\. Not started as far as Concourse shows now; it may still appear: run `ci runs` in a minute before triggering again\. Nothing was sent twice\.$/,
        );
        assert.equal(posts(g).length, 1, "one POST, however long it took");
    });

    test("a gateway error after the send is a lost reply too, and a call cancelled after it is", async (t) => {
        const world = usual();
        const inner = concourseResponder(world);
        const g = await start(t, world, {
            responder: (request, n): Answer =>
                request.method === "POST" ? { status: 502, text: "Bad gateway" } : (inner(request, n) as Answer),
        });
        assert.match(
            (await g.call({ action: "trigger" })).error?.message ?? "",
            /the reply was lost \(HTTP 502\)\. Not started as far as Concourse shows now/,
        );
        assert.equal(posts(g).length, 1);
    });

    test("an answer that is not a build still says it started, without a number", async (t) => {
        const world = usual();
        const inner = concourseResponder(world);
        const g = await start(t, world, {
            responder: (request, n): Answer =>
                request.method === "POST" ? { status: 200, text: "ok" } : (inner(request, n) as Answer),
        });
        assert.equal(ok(await g.call({ action: "trigger" })), "Started a build of orders-api-staging.");
    });
});

describe("signing in", () => {
    test("a token is a secret reference, resolved once for a call of several requests", async (t) => {
        const g = await start(t);
        const result = await g.call({ action: "status" });
        assert.ok(ok(result));
        assert.ok(g.requests.length >= 2);
        assert.deepEqual(g.h.jig.resolved, ["env:CONCOURSE_TOKEN"], "asked once, kept for the call");
        assert.ok(!result.text.includes(TOKEN));
    });

    test("a sign-in service supplies the headers, for the read and the send", async (t) => {
        const world = usual();
        world.authorized = (headers) => headers.authorization === "Bearer sso-1";
        const g = await start(t, world, { ci: concourseCi({ auth: { signIn: "corp" } }) });
        g.h.jig.signInServices.set("corp", { headers: async () => ({ authorization: "Bearer sso-1" }) });
        ok(await g.call({ action: "trigger" }));
        assert.equal(world.started, 1);
        assert.ok(g.h.jig.signedIn.every((request) => request.system === "ci:concourse"));
        assert.deepEqual(g.h.jig.resolved, []);
    });

    test("a transport carries the requests and signs in itself, so the address may be plain http", async (t) => {
        const world = usual();
        world.authorized = () => true;
        const g = await ciWorld(t, {
            ci: concourseCi({ url: "http://concourse.internal.example.test", auth: { transport: "corp" } }),
            responder: concourseResponder(world),
            transport: "corp",
        });
        ok(await g.call({ action: "trigger" }));
        assert.equal(g.server.requests.length, 0, "nothing went over the network");
        const post = g.transport?.requests.find((request) => request.method === "POST");
        assert.equal(post?.headers.authorization, undefined, "no credential of ours is added");
        assert.equal(g.h.jig.sent.at(-1)?.url, `http://concourse.internal.example.test${JOB}/builds`);
        assert.deepEqual(g.h.jig.resolved, []);
    });

    test("no credential reaches a result or an error", async (t) => {
        const g = await start(t);
        const texts = [
            ok(await g.call({ action: "status" })),
            ok(await g.call({ action: "trigger" })),
            (await g.call({ action: "run", run_id: 99 })).error?.message ?? "",
        ];
        for (const value of g.h.jig.issued) for (const text of texts) assert.ok(!text.includes(value));
    });
});

describe("the plan of a watch", () => {
    test("a build that is running is the one followed; otherwise the next one that is created", async (t) => {
        const world = usual();
        const g = await start(t, world);
        const result = await g.call({ action: "watch" });
        assert.deepEqual(g.h.jig.watches[0]?.spec, {
            system: "concourse",
            service: "orders-api",
            finish: { kind: "build" },
            after: 120,
        });
        assert.equal(g.h.jig.watches[0]?.title, "the next build of orders-api");
        assert.equal(
            ok(result),
            "Watching the next build of orders-api as watch-1. One message arrives when the build ends. The watch tool lists and stops watches.",
        );
        assert.deepEqual([result.cls?.environment, result.cls?.effect], ["local", "write"]);
        world.builds.push(build(121, "started"));
        ok(await g.call({ action: "watch" }));
        assert.deepEqual(g.h.jig.watches[1]?.spec, {
            system: "concourse",
            service: "orders-api",
            finish: { kind: "build" },
            build: "21",
        });
        assert.equal(g.h.jig.watches[1]?.title, "build #21 of orders-api");
        world.builds = [];
        ok(await g.call({ action: "watch" }));
        assert.equal((g.h.jig.watches[2]!.spec as { after: number }).after, 0, "a job with no build yet");
    });

    test("a build by number must exist, and run is the only finish line there is", async (t) => {
        const g = await start(t);
        assert.match(
            (await g.call({ action: "watch", run_id: 99 })).error?.message ?? "",
            /orders-api-staging has no build 99/,
        );
        ok(await g.call({ action: "watch", run_id: 19, finish: "run" }));
        assert.equal((g.h.jig.watches[0]!.spec as { build: string }).build, "19");
        for (const finish of ["required", "check", "merged"]) {
            assert.match(
                (await g.call({ action: "watch", finish })).error?.message ?? "",
                new RegExp(`Concourse does not support finish ${finish}\\. It supports: run`),
            );
        }
        assert.match((await g.call({ action: "watch", check: "x" })).blocked ?? "", /does not take check/);
        assert.equal(g.h.jig.watches.length, 1);
    });
});
