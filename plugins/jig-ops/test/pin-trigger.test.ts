// The trigger preview of a CI job in an environment that has a pin: it says what the environment is pinned to, read from the
// control repository now, and the approval covers it. Against a fake Concourse and a fake `gh`.
import assert from "node:assert/strict";
import type { TestContext } from "node:test";
import { describe, test } from "node:test";
import { ciWorld } from "./support/ci-world.ts";
import { build, concourseResponder, concourseWorld, TOKEN } from "./support/fake-concourse.ts";
import { withPinnedLine } from "../src/ci/pin-line.ts";
import { ok } from "./support/harness.ts";
import { answerFile, pinSection, STAGING_FILE } from "./support/pin-world.ts";
import { concourseCi, withJobs } from "./support/section.ts";
import type { Raw } from "./support/section.ts";

const OLD = "0.0.0-pr-feature-PROJ-41-1a2b3c4";

async function start(t: TestContext, section: Raw = pinSection()) {
    const concourse = concourseWorld({
        job: "checkout-staging",
        builds: [build(120, "succeeded", { created_by: "jdoe", job_name: "checkout-staging" })],
    });
    const g = await ciWorld(t, {
        section,
        responder: concourseResponder(concourse),
        secrets: { "env:CONCOURSE_TOKEN": TOKEN },
    });
    return Object.assign(g, { concourse });
}

const trigger = { action: "trigger", service: "checkout", environment: "staging" };

describe("the trigger preview of an environment with a pin", () => {
    test("names what the environment is pinned to, after the job and its last build", async (t) => {
        const g = await start(t);
        answerFile(g.h.gh, STAGING_FILE, `${OLD}\n`);
        const result = await g.call(trigger);
        assert.equal(
            result.preview?.body,
            [
                "Service:       checkout",
                "Environment:   staging (test)",
                "Job:           checkout-staging (Concourse, team main, pipeline deploy)",
                "Last build:    #20 succeeded, started 2026-11-01 12:32 UTC by jdoe",
                `Deploys:       what main pins: ${OLD} (PROJ-41)`,
                "Sent once. If the reply is lost, the job's builds are read once and nothing is sent again.",
            ].join("\n"),
        );
        assert.equal(result.preview?.summary, "start the job checkout-staging (Concourse, pipeline deploy) in staging");
        assert.match(ok(result), /^Started .*checkout-staging/);
        assert.equal(g.concourse.started, 1, "sent once");
    });

    test("reads only the first pin file and nothing is written to GitHub", async (t) => {
        const g = await start(t);
        answerFile(g.h.gh, STAGING_FILE, `${OLD}\n`);
        ok(await g.call(trigger));
        const calls = g.h.gh.calls();
        assert.ok(calls.length >= 1);
        for (const call of calls) {
            assert.deepEqual(call.args.slice(0, 2), ["api", "-i"]);
            assert.match(
                call.args[2] ?? "",
                /^repos\/acme\/deploy-control\/contents\/clusters\/staging\/checkout\/chart\.version\?ref=main$/,
            );
            assert.equal(call.args.length, 3);
        }
    });

    test("the pinned version is part of what was approved: if it moves before the send, nothing is sent", async (t) => {
        const g = await start(t);
        answerFile(g.h.gh, STAGING_FILE, `${OLD}\n`);
        const result = await g.call(trigger, {
            between: () => answerFile(g.h.gh, STAGING_FILE, "0.0.0-pr-feature-PROJ-60-abcdef0\n"),
        });
        assert.match(
            result.error?.message ?? "",
            /^ci trigger of checkout changed since the preview; run it again to see the new preview\. Nothing was sent$/,
        );
        assert.equal(g.concourse.started, 0);
    });

    test("the same pin gives the same fingerprint, and another pin another", async (t) => {
        const g = await start(t);
        g.h.jig.publish();
        const fingerprint = async () =>
            (await g.h.ci.declaration.preview?.(trigger, new AbortController().signal))?.fingerprint;
        answerFile(g.h.gh, STAGING_FILE, `${OLD}\n`);
        const first = await fingerprint();
        assert.match(first ?? "", /^[0-9a-f]{32}$/);
        assert.equal(await fingerprint(), first);
        answerFile(g.h.gh, STAGING_FILE, "1.4.9\n");
        assert.notEqual(await fingerprint(), first);
    });

    test("a pin that cannot be read is said in the preview, and does not stop the trigger from being asked", async (t) => {
        const g = await start(t);
        g.h.gh.on("api", { status: 404, json: { message: "Not Found" } }, ["contents/"]);
        const result = await g.call(trigger);
        assert.match(
            result.preview?.body ?? "",
            /\nDeploys:       what main pins could not be read \(clusters\/staging\/checkout\/chart\.version in acme\/deploy-control on main was not found/,
        );
        assert.equal(result.error, undefined);
        assert.equal(g.concourse.started, 1);
    });

    test("a file with two matching lines is said too, with line numbers", async (t) => {
        const g = await start(t);
        answerFile(g.h.gh, STAGING_FILE, "a\nb\n");
        const result = await g.call(trigger, { allowed: false });
        assert.match(
            result.preview?.body ?? "",
            /\nDeploys:       what main pins could not be read \(.* has 2 lines that match, not 1 \(lines 1, 2\)/,
        );
    });
});

describe("the trigger preview of an environment with no pin", () => {
    test("has no Deploys line and reads no GitHub", async (t) => {
        const concourse = concourseWorld({ builds: [build(120, "succeeded", { created_by: "jdoe" })] });
        const g = await ciWorld(t, {
            section: withJobs({ staging: concourseCi() }),
            responder: concourseResponder(concourse),
            secrets: { "env:CONCOURSE_TOKEN": TOKEN },
        });
        const result = await g.call({ action: "trigger", environment: "staging" });
        assert.doesNotMatch(result.preview?.body ?? "", /Deploys/);
        assert.deepEqual(g.h.gh.calls(), []);
    });
});

describe("where the line goes in the preview of another CI system", () => {
    const plan = (body: string) => ({
        preview: { summary: "s", body, format: "text" as const, fingerprint: "f" },
        send: async () => ({ text: "", facts: {}, details: {} }),
    });
    const pinned = { text: "what main pins: 1.4.2", mark: "1.4.2|" };

    test("it follows the short labelled rows at the head, in their column", () => {
        const jenkins = withPinnedLine(
            plan(
                "Service:    orders (Jenkins job build)\nEnvironment: qa (test)\nParameters: none\nNext build number: 5\nSent once.",
            ),
            pinned,
        );
        assert.equal(
            jenkins.preview.body,
            "Service:    orders (Jenkins job build)\nEnvironment: qa (test)\nParameters: none\nDeploys:    what main pins: 1.4.2\nNext build number: 5\nSent once.",
        );
    });

    test("a body with no rows gets it first, and a preview with no fingerprint keeps none", () => {
        const bare = withPinnedLine(
            { ...plan("Sent once."), preview: { summary: "s", body: "Sent once.", format: "text" } },
            pinned,
        );
        assert.equal(bare.preview.body, "Deploys:       what main pins: 1.4.2\nSent once.");
        assert.equal(bare.preview.fingerprint, undefined);
    });
});
