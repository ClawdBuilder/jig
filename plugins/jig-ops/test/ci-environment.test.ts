// The CI job of an environment: `environments.<e>.job` in the catalog, and `ci {environment}` in the tool. A call that names an
// environment acts on that environment's job and in that environment: a read is a read there, a trigger a write there, and
// production is denied before anyone is asked. The job is any adapter that can start a build, and a job never starts a watch
// on a push. Against the fake Concourse, Jenkins and GitLab, which answer one address by their paths.
import assert from "node:assert/strict";
import type { TestContext } from "node:test";
import { describe, test } from "node:test";
import { layered } from "../../jig-core/src/section-defaults.ts";
import { OPS_REPLACE, readOps, validateOps } from "../src/catalog.ts";
import type { Catalog } from "../src/catalog.ts";
import type { CiSpec } from "../src/ci/watch.ts";
import { ciWorld } from "./support/ci-world.ts";
import type { CiWorld } from "./support/ci-world.ts";
import {
    build as ccBuild,
    concourseResponder,
    concourseWorld,
    TOKEN as CONCOURSE_TOKEN,
} from "./support/fake-concourse.ts";
import {
    gitlabResponder,
    gitlabWorld,
    job as glJob,
    pipeline,
    SHA,
    TOKEN as GITLAB_TOKEN,
} from "./support/fake-gitlab.ts";
import { build as jkBuild, jenkinsResponder, jenkinsWorld, TOKEN as JENKINS_TOKEN } from "./support/fake-jenkins.ts";
import type { Responder } from "./support/fake-server.ts";
import { ok } from "./support/harness.ts";
import { concourseCi, gitlabCi, jenkinsCi, section, withJobs } from "./support/section.ts";
import type { Raw } from "./support/section.ts";

const errors = (job: unknown, environment = "staging"): string[] => {
    const raw = section();
    const entry = (raw.services as Record<string, Raw>)["orders-api"] as { environments: Record<string, Raw> };
    (entry.environments[environment] as Raw).job = job;
    return validateOps(raw);
};

const catalog = (raw: Raw): Catalog => {
    const read = readOps(raw);
    assert.deepEqual(read.errors, []);
    return read.catalog as Catalog;
};

describe("the job of an environment, in the catalog", () => {
    test("is a ci entry of a system that can start a build, and belongs to the environment it is under", () => {
        const environments = catalog(
            withJobs({ staging: concourseCi(), qa: jenkinsCi(), production: gitlabCi() }),
        ).services.get("orders-api")?.environments;
        assert.deepEqual(environments?.get("staging")?.job, {
            system: "concourse",
            environment: "staging",
            url: "https://ci.example.test",
            team: "main",
            pipeline: "deploy",
            job: "orders-api-staging",
            auth: { kind: "token", token: "env:CONCOURSE_TOKEN" },
            signInHint: "fly -t main login",
        });
        assert.deepEqual(
            [environments?.get("qa")?.job?.system, environments?.get("qa")?.job?.environment],
            ["jenkins", "qa"],
        );
        assert.deepEqual(
            [environments?.get("production")?.job?.system, environments?.get("production")?.job?.environment],
            ["gitlab", "production"],
        );
        assert.equal(environments?.get("staging")?.deploy?.method, "helm", "beside the rest of the environment");
    });

    test("an environment may have only a job", () => {
        assert.deepEqual(errors(concourseCi(), "staging"), []);
        const raw = section();
        const entry = (raw.services as Record<string, Raw>)["orders-api"] as { environments: Record<string, Raw> };
        entry.environments.qa = { job: jenkinsCi() };
        assert.deepEqual(validateOps(raw), []);
        entry.environments.qa = {};
        assert.deepEqual(validateOps(raw), [
            "ops.services.orders-api.environments.qa: must have at least one of deploy, pinned, runtime, health and job",
        ]);
    });

    test("GitHub Actions has no trigger, so it cannot be a job", () => {
        assert.deepEqual(errors({ system: "github-actions", workflow: "deploy.yml" }), [
            "ops.services.orders-api.environments.staging.job.system: github-actions has no trigger, so it cannot be a job; " +
                "the systems for a job are: gitlab, jenkins, concourse",
        ]);
    });

    test("the environment is the key it sits under, so a job names none", () => {
        assert.deepEqual(errors(concourseCi({ environment: "staging" })), [
            "ops.services.orders-api.environments.staging.job.environment: not allowed in a job, which belongs to the environment it is under",
        ]);
        assert.equal(errors(jenkinsCi({ environment: "elsewhere" })).length, 1);
    });

    test("is checked like a service's ci, and every error names its key", () => {
        const at = "ops.services.orders-api.environments.staging.job";
        assert.deepEqual(errors({}), [
            `${at}.system: required, the CI system: github-actions, gitlab, jenkins, concourse`,
        ]);
        assert.deepEqual(errors({ system: "circleci" }), [
            `${at}.system: unknown CI system; the systems there are: github-actions, gitlab, jenkins, concourse`,
        ]);
        assert.match(
            errors("concourse")[0] ?? "",
            /^ops\.services\.orders-api\.environments\.staging\.job: must be an object/,
        );
        assert.deepEqual(errors(concourseCi({ team: undefined })), [`${at}.team: required, the team name`]);
        assert.match(
            errors(jenkinsCi({ url: "http://ci.example.test" }))[0] ?? "",
            /job\.url: must start with https:\/\//,
        );
        assert.deepEqual(errors(jenkinsCi({ url: "http://ci.example.test", auth: { transport: "corp" } })), []);
        assert.deepEqual(errors(gitlabCi({ project: undefined })), [
            `${at}.project: required, a project id or a path such as acme/orders-api`,
        ]);
    });

    test("needs no repo of the service, and the repo's CI stays as it is", () => {
        const raw = withJobs({ staging: concourseCi() });
        delete ((raw.services as Record<string, Raw>)["orders-api"] as Raw).repo;
        assert.match(validateOps(raw)[0] ?? "", /the service needs repo/, "the service's github ci still does");
        delete ((raw.services as Record<string, Raw>)["orders-api"] as Raw).ci;
        assert.deepEqual(validateOps(raw), []);
    });
});

describe("a company's job and your own token", () => {
    const company = {
        services: {
            "orders-api": {
                environments: {
                    staging: {
                        job: {
                            system: "concourse",
                            url: "https://ci.example.com",
                            team: "main",
                            pipeline: "deploy",
                            job: "orders-api-staging",
                            auth: { signIn: "corp-sso" },
                            signInHint: "fly -t main login",
                        },
                    },
                },
            },
        },
    };
    const mine = {
        services: { "orders-api": { environments: { staging: { job: { auth: { token: "cmd:fly-main" } } } } } },
    };

    test("your auth replaces the company's whole, so the two are never a mix", () => {
        assert.ok(OPS_REPLACE.includes("services.*.environments.*.job.auth"));
        assert.deepEqual(validateOps(layered(company, mine, OPS_REPLACE)), []);
        const merged = layered(company, mine, OPS_REPLACE) as typeof company;
        assert.deepEqual(merged.services["orders-api"].environments.staging.job.auth, { token: "cmd:fly-main" });
        const mixed = validateOps(layered(company, mine));
        assert.ok(
            mixed.some((error) => error.includes("services.orders-api.environments.staging.job.auth")),
            mixed.join("\n"),
        );
    });
});

// ---- the tool -----------------------------------------------------------------------------------------------------

/** One address, three systems: Concourse for staging, GitLab for production, Jenkins for qa and for the service's own ci. */
function dispatch(parts: { concourse: Responder; gitlab: Responder; jenkins: Responder }): Responder {
    return (request, n) =>
        request.path.startsWith("/api/v1/")
            ? parts.concourse(request, n)
            : request.path.startsWith("/api/v4/")
              ? parts.gitlab(request, n)
              : parts.jenkins(request, n);
}

async function start(t: TestContext, more: { ops?: Raw; section?: Raw } = {}) {
    const concourse = concourseWorld({ builds: [ccBuild(120, "succeeded", { created_by: "jdoe" })] });
    const jenkins = jenkinsWorld({ builds: [jkBuild(11, "SUCCESS"), jkBuild(12, "FAILURE")] });
    const gitlab = gitlabWorld({
        pipelines: [pipeline(8, "success")],
        jobs: { 8: [glJob(80, "deploy", "success")] },
    });
    const g = await ciWorld(t, {
        section:
            more.section ??
            withJobs({ staging: concourseCi(), production: gitlabCi(), qa: jenkinsCi() }, more.ops, jenkinsCi()),
        responder: dispatch({
            concourse: concourseResponder(concourse),
            gitlab: gitlabResponder(gitlab),
            jenkins: jenkinsResponder(jenkins),
        }),
        secrets: {
            "env:CONCOURSE_TOKEN": CONCOURSE_TOKEN,
            "env:GITLAB_TOKEN": GITLAB_TOKEN,
            "env:JENKINS_TOKEN": JENKINS_TOKEN,
        },
    });
    return Object.assign(g, { concourse, jenkins, gitlab });
}

/** The spec of the watch at `index`, as the plain JSON it is saved as. */
const specOf = (g: CiWorld, index: number): Record<string, unknown> => ({ ...(g.h.jig.watches[index]?.spec ?? {}) });

const posts = (g: CiWorld) => g.requests.filter((request) => request.method === "POST");

describe("a call that names an environment", () => {
    test("acts on that environment's job, and a call that names none acts on the service's own ci", async (t) => {
        const g = await start(t);
        assert.match(
            ok(await g.call({ action: "status", environment: "staging" })),
            /^build #20 of orders-api-staging: succeeded, took 5m02s .*, started by jdoe\n/,
        );
        assert.ok(g.requests.every((request) => request.path.startsWith("/api/v1/teams/main/pipelines/deploy")));
        const before = g.requests.length;
        assert.match(ok(await g.call({ action: "status" })), /^build #12 of orders\/build: FAILURE/);
        assert.equal(g.requests[before]?.path, "/job/orders/job/build/lastBuild/api/json");
        assert.match(ok(await g.call({ action: "runs", environment: "qa" })), /^orders\/build: 2 builds/);
        assert.match(ok(await g.call({ action: "runs", environment: "production" })), /^acme\/orders-api: 1 pipeline/);
    });

    test("is told which environments have a job when the name is wrong", async (t) => {
        const g = await start(t);
        const refused = async (input: Record<string, unknown>) =>
            (await g.call({ action: "status", ...input })).blocked ?? "";
        assert.match(
            await refused({ environment: "nope" }),
            /ci: orders-api has no environment "nope"\. Known environments: staging, production, qa/,
        );
        assert.match(await refused({ environment: 5 }), /ci: orders-api has no environment 5\./);
        assert.match(
            await refused({ service: "nope", environment: "staging" }),
            /ci: no service named "nope"\. Services with a CI job: orders-api \(staging, production, qa\)/,
        );
        const plain = await start(t, { section: section() });
        const blocked = (await plain.call({ action: "status", environment: "staging" })).blocked ?? "";
        assert.match(blocked, /ci: orders-api has no CI job in staging\. Environments with a CI job: none/);
        assert.deepEqual(plain.requests, []);
    });

    test("is a read in that environment, a write there for a trigger, and a local write for a watch", async (t) => {
        const g = await start(t);
        const said = (input: Record<string, unknown>) =>
            g.h.ci.declaration.classify({ service: "orders-api", ...input });
        assert.deepEqual(said({ action: "status", environment: "staging" }), {
            action: "status",
            environment: "staging",
            effect: "read",
        });
        assert.deepEqual(said({ action: "trigger", environment: "staging" }), {
            action: "trigger",
            environment: "staging",
            effect: "write",
        });
        assert.deepEqual(said({ action: "watch", environment: "staging" }), {
            action: "watch",
            environment: "local",
            effect: "write",
        });
        assert.deepEqual(said({ action: "status", environment: "production" }), {
            action: "status",
            environment: "production",
            effect: "read",
        });
        assert.deepEqual(said({ action: "status" }), { action: "status", environment: "external", effect: "read" });
    });

    test("a trigger in a test environment asks, with the environment and its kind in the preview", async (t) => {
        const g = await start(t);
        const result = await g.call({ action: "trigger", environment: "staging" });
        assert.equal(
            result.preview?.summary,
            "start the job orders-api-staging (Concourse, pipeline deploy) in staging",
        );
        assert.equal(
            result.preview?.body,
            [
                "Service:       orders-api",
                "Environment:   staging (test)",
                "Job:           orders-api-staging (Concourse, team main, pipeline deploy)",
                "Last build:    #20 succeeded, started 2026-11-01 12:32 UTC by jdoe",
                "Sent once. If the reply is lost, the job's builds are read once and nothing is sent again.",
            ].join("\n"),
        );
        assert.equal(ok(result), "Started build #21 of orders-api-staging (pending).");
        assert.equal(g.concourse.started, 1);
        assert.deepEqual([result.cls?.environment, result.cls?.effect], ["staging", "write"]);
    });

    test("a trigger of a Jenkins or a GitLab job says the environment too, and the environment is part of what was approved", async (t) => {
        const g = await start(t);
        const jenkins = await g.call({ action: "trigger", environment: "qa" });
        assert.match(jenkins.preview?.summary ?? "", /^start a build of orders\/build in qa$/);
        assert.match(jenkins.preview?.body ?? "", /\nEnvironment: qa \(test\)\n/);
        const own = await g.call({ action: "trigger" });
        assert.doesNotMatch(own.preview?.body ?? "", /Environment/);
        assert.notEqual(
            jenkins.preview?.fingerprint,
            own.preview?.fingerprint,
            "the same job in another environment is another approval",
        );
        const gitlab = await start(t, {
            section: withJobs({ qa: gitlabCi() }),
        });
        const created = await gitlab.call({ action: "trigger", environment: "qa", ref: "main" });
        assert.match(created.preview?.summary ?? "", /^create a pipeline on main in acme\/orders-api in qa$/);
        assert.match(created.preview?.body ?? "", /\nEnvironment: qa \(test\)\n/);
    });

    test("a trigger in production is denied by the floor before anyone is asked, and nothing is sent", async (t) => {
        const g = await start(t);
        const result = await g.call({ action: "trigger", environment: "production", ref: "main" });
        assert.equal(result.blocked, "Denied by the floor: a write to production");
        assert.equal(result.preview, undefined);
        assert.deepEqual(posts(g), []);
        assert.deepEqual(g.requests, []);
        const read = await g.call({ action: "status", environment: "production" });
        assert.deepEqual([read.cls?.environment, read.cls?.effect], ["production", "read"]);
        assert.equal(read.blocked, undefined, "a read in production runs, and jig-core masks what it returns");
    });

    test("an environment that jig-core does not know counts as production", async (t) => {
        const raw = withJobs({ canary: concourseCi() });
        const g = await start(t, { section: raw });
        const result = await g.call({ action: "trigger", environment: "canary" });
        assert.match(result.blocked ?? "", /^Denied by the floor/);
    });

    test("rerun is a write in the environment too, and a job that cannot rerun says so", async (t) => {
        const g = await start(t);
        const said = (input: Record<string, unknown>) =>
            g.h.ci.declaration.classify({ service: "orders-api", ...input });
        assert.deepEqual(said({ action: "rerun", environment: "production", run_id: 8 }), {
            action: "rerun",
            environment: "production",
            effect: "write",
        });
        assert.match(
            (() => {
                try {
                    said({ action: "rerun", environment: "staging", run_id: 1 });
                    return "";
                } catch (error) {
                    return (error as Error).message;
                }
            })(),
            /ci rerun: Concourse \(orders-api\) does not support rerun/,
        );
    });
});

// ---- the watch ----------------------------------------------------------------------------------------------------

async function poll(
    g: CiWorld,
    spec: CiSpec,
    state?: unknown,
): Promise<{ done?: { outcome: string }; state: unknown }> {
    g.h.jig.publish();
    const kind = g.h.jig.kinds.get("ops-ci") as unknown as {
        poll(s: unknown, st: unknown, signal: AbortSignal): Promise<unknown>;
    };
    return (await kind.poll(spec, state, new AbortController().signal)) as {
        done?: { outcome: string };
        state: unknown;
    };
}

describe("a watch of an environment's job", () => {
    test("names the environment in its spec and its title, and polls that job", async (t) => {
        const g = await start(t);
        const result = await g.call({ action: "watch", environment: "staging" });
        assert.deepEqual(g.h.jig.watches[0]?.spec, {
            system: "concourse",
            service: "orders-api",
            environment: "staging",
            finish: { kind: "build" },
            after: 120,
        });
        assert.equal(g.h.jig.watches[0]?.title, "the next build of orders-api in staging");
        assert.match(ok(result), /^Watching the next build of orders-api in staging as watch-1\./);
        ok(await g.call({ action: "watch", environment: "qa" }));
        assert.equal(g.h.jig.watches[1]?.title, "the next build of orders-api in qa");
        assert.equal(specOf(g, 1).environment, "qa");
        ok(await g.call({ action: "watch", environment: "production", branch: "main" }));
        assert.equal(g.h.jig.watches[2]?.title, "pipeline #8 in production");
        assert.equal(specOf(g, 2).environment, "production");
        ok(await g.call({ action: "watch" }));
        assert.equal("environment" in specOf(g, 3), false, "the service's own ci has none");
    });

    test("a poll reads the job the catalog names now, for the environment in the spec", async (t) => {
        const g = await start(t);
        g.concourse.builds = [ccBuild(121, "succeeded")];
        const spec: CiSpec = {
            system: "concourse",
            service: "orders-api",
            environment: "staging",
            build: "21",
            finish: { kind: "build" },
        };
        const done = await poll(g, spec);
        assert.equal(done.done?.outcome, "passed");
        assert.ok(g.requests.every((request) => request.path.startsWith("/api/v1/")));
        await assert.rejects(poll(g, { ...spec, environment: "nope" }), /orders-api has no environment "nope"/);
        await assert.rejects(
            poll(g, { ...spec, environment: "qa" }),
            /orders-api now uses jenkins for CI, so this concourse watch cannot go on/,
        );
    });

    test("says nothing about a commit: no ci-finished and no artifact-ready for an environment's job", async (t) => {
        const rule = { kind: "image", check: "deploy", log: "image: (\\S+)" };
        const g = await start(t, { ops: { artifacts: [rule] } });
        g.gitlab.traces[80] = "image: registry.example.test/orders-api:aaaaaaa\n";
        const watched = (environment?: string): CiSpec => ({
            system: "gitlab",
            service: "orders-api",
            ...(environment === undefined ? {} : { environment }),
            ref: "main",
            sha: SHA,
            pipelineId: 8,
            finish: { kind: "pipeline" },
            since: 0,
        });
        // The same pipeline, watched as the service's own CI, would announce both; here the service's ci is Jenkins, so
        // the control is an environment-less GitLab service.
        const control = await start(t, { section: withJobs({}, { artifacts: [rule] }, gitlabCi()) });
        control.gitlab.traces[80] = "image: registry.example.test/orders-api:aaaaaaa\n";
        assert.equal((await poll(control, watched())).done?.outcome, "passed");
        const events = (w: CiWorld) => w.h.bus.emitted.map((entry) => entry.event);
        assert.deepEqual(events(control), ["jig-ops:artifact-ready", "jig-ops:ci-finished"]);

        assert.equal((await poll(g, watched("production"))).done?.outcome, "passed");
        assert.deepEqual(events(g), []);
    });
});

describe("a push", () => {
    const pushed = { repo: "acme/orders-api", branch: "main", sha: SHA };

    test("never starts a watch of a job: only the service's own ci is watched", async (t) => {
        const withoutCi = withJobs({ staging: concourseCi(), qa: jenkinsCi() });
        delete ((withoutCi.services as Record<string, Raw>)["orders-api"] as Raw).ci;
        const g = await start(t, { section: withoutCi });
        g.h.jig.publish();
        g.h.bus.publish("jig-git:pushed", pushed);
        assert.deepEqual(g.h.jig.watches, [], "a service with jobs and no ci of its own is not watched");

        const both = await start(t, { section: withJobs({ staging: concourseCi() }, {}, jenkinsCi()) });
        both.h.jig.publish();
        both.h.bus.publish("jig-git:pushed", pushed);
        assert.equal(both.h.jig.watches.length, 1);
        assert.equal(specOf(both, 0).system, "jenkins");
        assert.equal("environment" in specOf(both, 0), false);
    });
});
