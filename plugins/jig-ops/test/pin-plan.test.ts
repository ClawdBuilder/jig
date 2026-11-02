// `deploy plan` for a pin: what a run would change, worked out from reads only (contents, commits, refs and the pull request
// list). The refusals, the values, the fingerprint, and that `deploy run` and `deploy rollback` of a pin are refused until the
// pin writes. A fake `gh` answers; the tests check that no call it got could change anything.
import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, test } from "node:test";
import { ok, setupHarness } from "./support/harness.ts";
import type { Harness } from "./support/harness.ts";
import {
    answerFile,
    answerRepository,
    BRANCH_SHA,
    pinDeploy,
    pinSection,
    QA_CHART,
    QA_IMAGE,
    STAGING_FILE,
    PRODUCTION_FILE,
} from "./support/pin-world.ts";

let h: Harness;
beforeEach(() => {
    h = setupHarness();
    h.configure(pinSection());
});
afterEach(() => h.close());

const OLD = "0.0.0-pr-feature-PROJ-41-1a2b3c4";
const NEW = "0.0.0-pr-feature-PROJ-57-9f8e7d6";
const BRANCH = "deploy/PROJ-57-staging-checkout";
const plan = (more: Record<string, unknown> = {}) =>
    h.deploy.call({
        action: "plan",
        service: "checkout",
        environment: "staging",
        version: NEW,
        ticket: "PROJ-57",
        ...more,
    });

/** The state of GitHub for a staging plan: the file, main's tip, no pin branch and no open pull request. */
function github(
    options: { text?: string; branch?: string | null; pulls?: Parameters<typeof answerRepository>[1] } = {},
): void {
    answerFile(h.gh, STAGING_FILE, options.text ?? `${OLD}\n`);
    answerRepository(h.gh, {
        branches: { [BRANCH]: options.branch === undefined ? null : options.branch },
        ...options.pulls,
    });
}

function onlyReads(): void {
    for (const call of h.gh.calls()) {
        assert.equal(call.args[0], "api");
        assert.deepEqual(call.args.slice(0, 2), ["api", "-i"]);
        assert.equal(call.args.length, 3, `a read has a path and nothing else: ${call.args.join(" ")}`);
    }
}

describe("the plan of a pin", () => {
    test("says what a run would change: the holder, the file and line, the branch, the pull request and what comes next", async () => {
        github();
        const result = await plan();
        assert.equal(
            ok(result),
            [
                "Deploy plan for checkout in staging (test):",
                "Service:       checkout",
                "Environment:   staging (test)",
                "Method:        pin, in acme/deploy-control on main",
                `Holder:        staging is pinned for PROJ-41 (${OLD}, changed by A. Person 2026-11-01 10:10 UTC, PR #88); this replaces it with PROJ-57.`,
                `File:          ${STAGING_FILE} (line 1)`,
                `Line:          ${OLD} -> ${NEW}`,
                `Branch:        ${BRANCH} (new, from main at 4d5e6f7)`,
                `Pull request:  PROJ-57: deploy checkout ${NEW} to staging (new)`,
                "Next:          a person merges it; then the staging job applies it.",
                "",
                "This is a plan: nothing was written. deploy run for a pin is not available yet.",
            ].join("\n"),
        );
        assert.deepEqual(result.cls, { action: "plan", environment: "staging", effect: "read" });
        assert.equal(result.preview, undefined, "a plan asks nobody");
        assert.deepEqual(h.jig.facts.get(result.id), [{ method: "pin", same: false }]);
        onlyReads();
    });

    test("reads the file, the commits, main, the pin branch and the pull requests, and nothing else", async () => {
        github();
        ok(await plan());
        const paths = h.gh.calls().map((call) => decodeURIComponent(call.args[2] ?? ""));
        const base = "repos/acme/deploy-control";
        assert.deepEqual(
            paths.map((path) => path.replace(base, "").split("?")[0]),
            [`/contents/${STAGING_FILE}`, "/commits", "/git/ref/heads/main", `/git/ref/heads/${BRANCH}`, "/pulls"],
        );
    });

    test("a branch that exists is moved to main's head, and an open pull request from it is edited", async () => {
        github({
            branch: BRANCH_SHA,
            pulls: {
                pulls: [
                    { number: 91, branch: BRANCH, title: "old title" },
                    { number: 92, branch: BRANCH, fork: true },
                ],
            },
        });
        const text = ok(await plan());
        assert.match(
            text,
            new RegExp(`\\nBranch:        ${BRANCH} \\(exists at 0a1b2c3; it would be moved to main at 4d5e6f7\\)\\n`),
        );
        assert.match(text, /\nPull request:  PROJ-57: deploy checkout .* to staging \(edits the open #91\)\n/);
    });

    test("the same ticket again says it changes that ticket's own pin", async () => {
        github({ text: "0.0.0-pr-feature-PROJ-57-0000000\n" });
        assert.match(ok(await plan()), /; this changes the pin of the same ticket, PROJ-57\.\n/);
    });

    test("with no holder pattern match it says what the file pins", async () => {
        github({ text: "1.4.2\n" });
        assert.match(
            ok(await plan()),
            /\nHolder:        staging is pinned to 1\.4\.2 \(changed by A\. Person 2026-11-01 10:10 UTC, PR #88\); this replaces it with PROJ-57\.\n/,
        );
    });

    test("a file that already holds the new line has nothing to change, and the branch and pull requests are not looked at", async () => {
        github({ text: `${NEW}\n` });
        const result = await plan();
        assert.match(
            ok(result),
            new RegExp(
                `^Deploy plan for checkout in staging \\(test\\):\\nstaging is already pinned to ${NEW} \\(${STAGING_FILE}\\): there is nothing to change\\.`,
            ),
        );
        assert.deepEqual(h.jig.facts.get(result.id), [{ method: "pin", same: true }]);
        const paths = h.gh.calls().map((call) => call.args[2] ?? "");
        assert.equal(
            paths.some((path) => path.includes("/pulls") || path.includes(BRANCH)),
            false,
        );
    });

    test("refuses a file whose pattern matches two lines, or none, naming the lines and not their text", async () => {
        github({ text: "alpha\nbeta\n" });
        const two = await plan();
        assert.match(
            two.error?.message ?? "",
            new RegExp(
                `^${STAGING_FILE} in acme/deploy-control on main has 2 lines that match, not 1 \\(lines 1, 2\\): change it by hand$`,
            ),
        );
        assert.doesNotMatch(two.error?.message ?? "", /alpha/);
        github({ text: "\n\n" });
        assert.match(
            (await plan()).error?.message ?? "",
            /has no line that matches the pin's pattern: change it by hand$/,
        );
    });

    test("refuses a branch that is not there", async () => {
        answerFile(h.gh, STAGING_FILE, `${OLD}\n`);
        h.gh.on("api", { status: 404, json: { message: "Not Found" } }, ["git/ref/heads/main"]);
        assert.equal((await plan()).error?.message, "the branch main was not found in acme/deploy-control");
    });

    test("refuses a new line the pin's own pattern would not read back", async () => {
        h.configure(
            pinSection({
                staging: {
                    deploy: pinDeploy({
                        pins: [{ file: STAGING_FILE, line: "^version=(?<version>\\S+)$", write: "ver={version}" }],
                    }),
                },
            }),
        );
        github({ text: "version=1.4.2\n" });
        assert.match(
            (await plan()).error?.message ?? "",
            /the new line for clusters\/staging\/checkout\/chart\.version would not be read back by the pin's own pattern/,
        );
    });

    test("GitHub refusing the sign-in is an error that says how to renew it", async () => {
        h.gh.on("api", { status: 401, json: { message: "Bad credentials" } }, ["contents/"]);
        assert.match(
            (await plan()).error?.message ?? "",
            /HTTP 401 Bad credentials \(gh is not signed in: run gh auth login yourself\)/,
        );
    });
});

describe("the inputs of a pin call", () => {
    const blocked = async (input: Record<string, unknown>) => (await plan(input)).blocked ?? "";

    test("a version must match the pin's pattern", async () => {
        assert.match(
            await blocked({ version: "latest" }),
            /^Blocked by jig-core: deploy cannot run with this input: deploy plan: version must match the pin's pattern \^\(\?:\\d\+/,
        );
        assert.match(await blocked({ version: "1.4.3\nmore" }), /version must match the pin's pattern/);
        assert.deepEqual(h.gh.calls(), [], "nothing is read for a call that is refused");
    });

    test("a ticket is needed where a template uses it, and must match its pattern", async () => {
        assert.match(
            await blocked({ ticket: undefined }),
            /deploy plan: checkout in staging needs ticket, which matches \^PROJ-\\d\+\$/,
        );
        assert.match(
            await blocked({ ticket: "PROJ-57; rm" }),
            /deploy plan: ticket must match \^PROJ-\\d\+\$ \(got "PROJ-57; rm"\)/,
        );
        assert.match(await blocked({ ticket: "../x" }), /ticket must match/);
    });

    test("a ticket or values given to an environment that has none are refused", async () => {
        const orders = await h.deploy.call({
            action: "plan",
            service: "orders-api",
            environment: "staging",
            version: "1.4.3",
            ticket: "PROJ-1",
        });
        assert.match(orders.blocked ?? "", /deploy plan does not use ticket here: orders-api in staging has no pin\./);
        const production = await h.deploy.call({
            action: "plan",
            service: "checkout",
            environment: "production",
            version: "1.4.3",
            ticket: "PROJ-1",
        });
        assert.match(production.blocked ?? "", /checkout in production has no deploy, so it takes no ticket or values/);
    });

    test("values default to the current line's and are set by the call, each checked", async () => {
        h.configure(pinSection({ staging: { deploy: pinDeploy() } }));
        answerFile(h.gh, QA_CHART, "chartVersion: 1.4.2  # build-7\n");
        answerFile(h.gh, QA_IMAGE, "image=registry.example.test/checkout:1.4.2\n", { commit: null });
        answerRepository(h.gh, { branches: { "deploy/PROJ-57-qa-checkout": null } });
        const qa = (more: Record<string, unknown> = {}) =>
            h.deploy.call({
                action: "plan",
                service: "checkout",
                environment: "qa",
                version: "1.4.3",
                ticket: "PROJ-57",
                ...more,
            });
        const kept = ok(await qa());
        assert.match(
            kept,
            /\nFile:          clusters\/qa\/checkout\/chart\.yaml \(line 1\)\nLine:          chartVersion: 1\.4\.2  # build-7 -> chartVersion: 1\.4\.3  # build-7\n/,
        );
        assert.match(
            kept,
            /\nFile:          clusters\/qa\/checkout\/image\.txt \(line 1\)\nLine:          image=registry\.example\.test\/checkout:1\.4\.2 -> image=registry\.example\.test\/checkout:1\.4\.3\n/,
        );
        const set = ok(await qa({ values: { build: "build-9" } }));
        assert.match(set, /chartVersion: 1\.4\.2  # build-7 -> chartVersion: 1\.4\.3  # build-9\n/);
        assert.match(
            (await qa({ values: { build: "nine" } })).blocked ?? "",
            /the value build must match \^build-\\d\+\$ \(got "nine"\)/,
        );
        assert.match(
            (await qa({ values: { colour: "red" } })).blocked ?? "",
            /"colour" is not a value the pin of checkout in qa lets a call set; it takes build/,
        );
    });
});

describe("the plan of an environment that is not deployed to", () => {
    test("production says a run would be refused, and what main pins there", async () => {
        answerFile(h.gh, PRODUCTION_FILE, "1.4.2\n");
        const result = await h.deploy.call({
            action: "plan",
            service: "checkout",
            environment: "production",
            version: "1.4.3",
        });
        assert.equal(
            ok(result),
            [
                "Deploy plan for checkout in production:",
                "A deploy run would be refused: checkout in production is production: the agent never changes production.",
                "Pinned now: main pins 1.4.2, changed by A. Person 2026-11-01 10:10 UTC, PR #88.",
            ].join("\n"),
        );
        assert.deepEqual(result.cls, { action: "plan", environment: "production", effect: "read" });
        assert.deepEqual(h.jig.facts.get(result.id), [{ refused: true, method: "pin" }]);
        onlyReads();
    });

    test("a production that has a pin deploy is refused as production, and still read", async () => {
        h.configure(
            pinSection({
                production: {
                    pinned: undefined,
                    deploy: pinDeploy({
                        apply: "itself",
                        pins: [{ file: PRODUCTION_FILE, line: "^(?<version>\\S+)$", write: "{version}" }],
                    }),
                },
            }),
        );
        answerFile(h.gh, PRODUCTION_FILE, "1.4.2\n");
        const text = ok(
            await h.deploy.call({
                action: "plan",
                service: "checkout",
                environment: "production",
                version: "1.4.3",
                ticket: "PROJ-5",
            }),
        );
        assert.match(
            text,
            /A deploy run would be refused: checkout in production is production: the agent never changes production/,
        );
        assert.match(text, /Pinned now: main pins 1\.4\.2/);
    });

    test("a pin that cannot be read is said in place of the pinned version", async () => {
        h.gh.on("api", { status: 404, json: { message: "Not Found" } }, ["contents/"]);
        const text = ok(
            await h.deploy.call({ action: "plan", service: "checkout", environment: "production", version: "1.4.3" }),
        );
        assert.match(text, /\nPinned now: the pin could not be read: .* was not found/);
    });
});

describe("run and rollback of a pin", () => {
    test("deploy run is refused until the pin writes, before anyone is asked and before GitHub is read", async () => {
        const result = await h.deploy.call({
            action: "run",
            service: "checkout",
            environment: "staging",
            version: NEW,
            ticket: "PROJ-57",
        });
        assert.match(
            result.blocked ?? "",
            /deploy run is refused: deploy run for the pin method is not available yet\. deploy plan shows what it would change/,
        );
        assert.equal(result.preview, undefined);
        assert.deepEqual(h.gh.calls(), []);
    });

    test("deploy rollback says a pin goes back by pinning the previous version", async () => {
        const result = await h.deploy.call({ action: "rollback", service: "checkout", environment: "staging" });
        assert.match(
            result.blocked ?? "",
            /deploy rollback is refused: a pin goes back by pinning the previous version/,
        );
    });

    test("production is refused as production, before the pin is mentioned", async () => {
        const result = await h.deploy.call({
            action: "run",
            service: "checkout",
            environment: "production",
            version: "1.4.3",
        });
        assert.match(
            result.blocked ?? "",
            /deploy run is refused: checkout in production is production: the agent never changes production/,
        );
    });
});

describe("the fingerprint of a plan", () => {
    const fingerprint = async () => (await plan()).details as { fingerprint?: string };

    test("is the same while nothing it shows changes, and changes when the file, main, the branch or a pull request does", async () => {
        github();
        const first = (await fingerprint()).fingerprint;
        assert.match(first ?? "", /^[0-9a-f]{32}$/);
        assert.equal((await fingerprint()).fingerprint, first, "the same reads, the same plan");

        answerFile(h.gh, STAGING_FILE, `${OLD}\n`, { sha: "blob0002" });
        const moved = (await fingerprint()).fingerprint;
        assert.notEqual(moved, first, "the file changed (its blob)");

        answerRepository(h.gh, { branches: { [BRANCH]: BRANCH_SHA } });
        const branch = (await fingerprint()).fingerprint;
        assert.notEqual(branch, moved, "the pin branch exists now");

        h.gh.on("api", { json: { object: { sha: "1".repeat(40) } } }, ["git/ref/heads/main"]);
        assert.notEqual((await fingerprint()).fingerprint, branch, "main moved");

        answerRepository(h.gh, { branches: { [BRANCH]: BRANCH_SHA }, pulls: [{ number: 91, branch: BRANCH }] });
        assert.notEqual((await fingerprint()).fingerprint, branch, "a pull request is open");
    });

    test("differs for another version or another ticket", async () => {
        github();
        h.gh.on("api", { status: 404, json: { message: "Not Found" } }, [
            "git/ref/heads/deploy/PROJ-58-staging-checkout",
        ]);
        const first = (await fingerprint()).fingerprint;
        const other = (await plan({ ticket: "PROJ-58" })).details as { fingerprint?: string };
        assert.notEqual(other.fingerprint, first);
    });
});
