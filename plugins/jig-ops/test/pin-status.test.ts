// `deploy status` for a pin: what the branch that deploys pins, for whom, who changed it last and when, the open pin pull
// requests, and what the cluster runs. For one environment and for all of a service's. Against a fake `gh` that answers the
// GitHub API reads (contents, commits and pull requests); nothing is written, and the tests check that.
import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, test } from "node:test";
import { list, pod, workload } from "./support/fixtures.ts";
import { ok, setupHarness } from "./support/harness.ts";
import type { Harness } from "./support/harness.ts";
import {
    answerFile,
    answerRepository,
    PRODUCTION_FILE,
    pinDeploy,
    pinSection,
    QA_CHART,
    QA_IMAGE,
    STAGING_FILE,
} from "./support/pin-world.ts";

let h: Harness;
beforeEach(() => {
    h = setupHarness();
});
afterEach(() => h.close());

const OLD = "0.0.0-pr-feature-PROJ-41-1a2b3c4";
const STAGING = { service: "checkout", environment: "staging" };
const status = (where: Record<string, unknown> = STAGING) => h.deploy.call({ action: "status", ...where });

function configure(options: Parameters<typeof pinSection>[0] = {}): void {
    h.configure(pinSection(options));
}

/** Every call the plugin made to gh is a read: `gh api -i <path>` with no method, field or body. */
function onlyReads(): void {
    for (const call of h.gh.calls()) {
        assert.equal(call.args[0], "api");
        assert.equal(call.args[1], "-i");
        assert.equal(call.args.length, 3, `no flag, method or field: ${call.args.join(" ")}`);
        assert.match(call.args[2] ?? "", /^repos\/acme\/deploy-control\/(contents|commits|git\/ref|pulls)/);
    }
}

describe("status of one environment", () => {
    test("says what main pins, the ticket that holds it, who changed it last and when, and the open pin pull requests", async () => {
        configure();
        answerFile(h.gh, STAGING_FILE, `${OLD}\n`);
        answerRepository(h.gh, {
            pulls: [
                {
                    number: 91,
                    branch: "deploy/PROJ-60-staging-checkout",
                    title: "PROJ-60: deploy checkout 1.4.4 to staging",
                    author: "bperson",
                },
                { number: 92, branch: "deploy/PROJ-61-qa-checkout" },
                { number: 93, branch: "deploy/PROJ-62-staging-checkout", fork: true },
                { number: 94, branch: "feature/unrelated" },
            ],
        });
        const result = await status();
        assert.equal(
            ok(result),
            [
                "checkout",
                `- staging: main pins ${OLD} (PROJ-41), changed by A. Person 2026-11-01 10:10 UTC, PR #88; ` +
                    'open pin PR #91 "PROJ-60: deploy checkout 1.4.4 to staging" by bperson.',
            ].join("\n"),
        );
        assert.deepEqual(result.cls, { action: "status", environment: "staging", effect: "read" });
        assert.equal(result.preview, undefined, "a read asks nobody");
        assert.deepEqual(h.jig.facts.get(result.id), [{ environments: 1, unreadable: 0 }]);
        assert.deepEqual((result.details as { environments: unknown[] }).environments, [
            { environment: "staging", version: OLD, ticket: "PROJ-41" },
        ]);
        onlyReads();
    });

    test("reads the file at the branch that deploys, and the last commit that touched it there", async () => {
        configure();
        answerFile(h.gh, STAGING_FILE, `${OLD}\n`);
        answerRepository(h.gh);
        ok(await status());
        const paths = h.gh.calls().map((call) => call.args[2]);
        assert.ok(paths.includes(`repos/acme/deploy-control/contents/${STAGING_FILE}?ref=main`), paths.join("\n"));
        assert.ok(
            paths.includes(
                `repos/acme/deploy-control/commits?path=${encodeURIComponent(STAGING_FILE)}&sha=main&per_page=1`,
            ),
        );
        assert.ok(paths.includes("repos/acme/deploy-control/pulls?state=open&base=main&per_page=100"));
    });

    test("without a holder pattern match or a PR number in the commit it says only what it knows", async () => {
        configure();
        answerFile(h.gh, STAGING_FILE, "1.4.2\n", { commit: { message: "bump by hand", author: "C. Person" } });
        answerRepository(h.gh);
        assert.equal(
            ok(await status()),
            "checkout\n- staging: main pins 1.4.2, changed by C. Person 2026-11-01 10:10 UTC.",
        );
    });

    test("a commit that cannot be read leaves the ticket and says so", async () => {
        configure();
        h.gh.on(
            "api",
            {
                status: 200,
                json: {
                    type: "file",
                    encoding: "base64",
                    content: Buffer.from(`${OLD}\n`).toString("base64"),
                    sha: "b1",
                },
            },
            ["contents/"],
        );
        h.gh.on("api", { status: 500, json: { message: "Server Error" } }, ["commits?path="]);
        answerRepository(h.gh);
        assert.match(
            ok(await status()),
            /- staging: main pins 0\.0\.0-pr-feature-PROJ-41-1a2b3c4 \(PROJ-41\), who changed it last could not be read \(reading the commits of .* failed: HTTP 500 Server Error\)/,
        );
    });

    test("a file with two matching lines, or none, or a file that is not there, is one line that says why", async () => {
        configure();
        answerRepository(h.gh);
        answerFile(h.gh, STAGING_FILE, "1.4.2\n1.4.3\n");
        assert.equal(
            ok(await status()),
            `checkout\n- staging: the pin could not be read: ${STAGING_FILE} in acme/deploy-control on main has 2 lines that match, not 1 (lines 1, 2): change it by hand`,
        );
        answerFile(h.gh, STAGING_FILE, "# only a comment\n\n");
        assert.match(ok(await status()), /on main has no line that matches the pin's pattern: change it by hand$/);
        h.gh.on("api", { status: 404, json: { message: "Not Found" } }, ["contents/"]);
        assert.match(ok(await status()), /on main was not found \(the file, the branch or the repository\)$/);
    });

    test("never prints the lines of a file it refused", async () => {
        configure();
        answerRepository(h.gh);
        answerFile(h.gh, STAGING_FILE, "secret-looking-1\nsecret-looking-2\n");
        assert.doesNotMatch(ok(await status()), /secret-looking/);
    });

    test("GitHub refusing the sign-in is one line that says how to renew it", async () => {
        configure();
        h.gh.on("api", { status: 401, json: { message: "Bad credentials" } }, ["contents/"]);
        assert.match(
            ok(await status()),
            /the pin could not be read: reading .* failed: HTTP 401 Bad credentials \(gh is not signed in: run gh auth login yourself\)$/,
        );
    });

    test("pin files that disagree are named", async () => {
        configure();
        answerRepository(h.gh);
        answerFile(h.gh, QA_CHART, "chartVersion: 1.4.2  # build-7\n");
        answerFile(h.gh, QA_IMAGE, "image=registry.example.test/checkout:1.4.1\n", { commit: null });
        const text = ok(await status({ service: "checkout", environment: "qa" }));
        assert.match(
            text,
            /^- qa: main pins 1\.4\.2, changed by A\. Person .*; the pin files disagree: clusters\/qa\/checkout\/image\.txt holds 1\.4\.1/m,
        );
    });

    test("a CRLF file is read as its lines", async () => {
        configure();
        answerRepository(h.gh);
        answerFile(h.gh, STAGING_FILE, "1.4.2\r\n");
        assert.match(ok(await status()), /main pins 1\.4\.2,/);
    });
});

describe("status with a runtime", () => {
    test("judges the cluster against the pinned version, as the runtime reports it", async () => {
        h.configure(
            pinSection({
                runtime: true,
                staging: {
                    deploy: pinDeploy({
                        version: "^\\d+\\.\\d+\\.\\d+-\\d+$",
                        runsAs: "^(?<version>\\d+\\.\\d+\\.\\d+)-\\d+$",
                    }),
                },
            }),
        );
        answerFile(h.gh, STAGING_FILE, "1.4.3-0\n", { commit: { message: "bump (#9)" } });
        answerRepository(h.gh);
        h.cluster.answer({
            pods: list(
                pod("checkout-0", { service: "checkout", tag: "1.4.3" }),
                pod("checkout-1", { service: "checkout", tag: "1.4.3" }),
            ),
            workloads: list(workload("checkout", { service: "checkout", tag: "1.4.3" })),
        });
        assert.match(
            ok(await status()),
            /main pins 1\.4\.3-0, changed by A\. Person 2026-11-01 10:10 UTC, PR #9; Running: 2 of 2 pods ready on 1\.4\.3\.$/,
        );
    });

    test("a cluster that is still on the old version is Still rolling, not an error", async () => {
        configure({ runtime: true });
        answerFile(h.gh, STAGING_FILE, "1.4.3\n");
        answerRepository(h.gh);
        h.cluster.answer({
            pods: list(
                pod("checkout-0", { service: "checkout", tag: "1.4.2" }),
                pod("checkout-1", { service: "checkout", tag: "1.4.2" }),
            ),
            workloads: list(workload("checkout", { service: "checkout", tag: "1.4.2" })),
        });
        assert.match(ok(await status()), /; Still rolling: 0 of 2 pods ready on 1\.4\.3; pods run 1\.4\.2\.$/);
    });
});

describe("status of production, which has only a pinned entry", () => {
    test("reads the pin and no pull requests, and is a read in production", async () => {
        configure();
        answerFile(h.gh, PRODUCTION_FILE, "1.4.2\n");
        const result = await status({ service: "checkout", environment: "production" });
        assert.equal(
            ok(result),
            "checkout\n- production: main pins 1.4.2, changed by A. Person 2026-11-01 10:10 UTC, PR #88.",
        );
        assert.deepEqual(result.cls, { action: "status", environment: "production", effect: "read" });
        assert.equal(
            h.gh.calls().some((call) => (call.args[2] ?? "").includes("pulls")),
            false,
            "no branch template, no search",
        );
        onlyReads();
    });

    test("the ticket is read from the whole pinned line, and a hand edit still has a last commit", async () => {
        configure();
        answerFile(h.gh, PRODUCTION_FILE, "0.0.0-pr-fix-PROJ-5-abcdef0\n", { commit: { message: "hand edit" } });
        assert.match(
            ok(await status({ service: "checkout", environment: "production" })),
            /main pins 0\.0\.0-pr-fix-PROJ-5-abcdef0 \(PROJ-5\), changed by/,
        );
    });
});

describe("status of a whole service", () => {
    function everything(): void {
        configure();
        answerRepository(h.gh, {
            pulls: [
                { number: 91, branch: "deploy/PROJ-60-staging-checkout", title: "staging pr" },
                { number: 95, branch: "deploy/PROJ-61-qa-checkout", title: "qa pr" },
            ],
        });
        answerFile(h.gh, STAGING_FILE, `${OLD}\n`);
        answerFile(h.gh, QA_CHART, "chartVersion: 1.4.2  # build-7\n");
        answerFile(h.gh, QA_IMAGE, "image=registry.example.test/checkout:1.4.2\n", { commit: null });
        answerFile(h.gh, PRODUCTION_FILE, "1.4.1\n", { commit: { message: "release (#80)", author: "D. Person" } });
    }

    test("reads every environment that has a pin, in the order of the catalog, and names the service once", async () => {
        everything();
        const result = await status({ service: "checkout" });
        const lines = ok(result).split("\n");
        assert.equal(lines[0], "checkout");
        assert.deepEqual(
            lines.slice(1).map((line) => line.split(":")[0]),
            ["- staging", "- qa", "- production"],
        );
        assert.match(lines[1] ?? "", /open pin PR #91 "staging pr" by aperson\.$/);
        assert.match(
            lines[2] ?? "",
            /main pins 1\.4\.2, changed by A\. Person .*; open pin PR #95 "qa pr" by aperson\.$/,
        );
        assert.match(
            lines[3] ?? "",
            /^- production: main pins 1\.4\.1, changed by D\. Person 2026-11-01 10:10 UTC, PR #80\.$/,
        );
        assert.deepEqual(h.jig.facts.get(result.id), [{ environments: 3, unreadable: 0 }]);
        onlyReads();
    });

    test("asks GitHub for the open pull requests once for environments that share a repository and branch", async () => {
        everything();
        ok(await status({ service: "checkout" }));
        const pulls = h.gh.calls().filter((call) => (call.args[2] ?? "").includes("/pulls"));
        assert.equal(pulls.length, 1);
    });

    test("is classified in the most restricted environment it reads, so that production masks all of it", async () => {
        everything();
        const result = await status({ service: "checkout" });
        assert.deepEqual(result.cls, { action: "status", environment: "production", effect: "read" });
    });

    test("without a production environment it is classified in a test environment", async () => {
        h.configure(pinSection({ production: null }));
        const result = await status({ service: "checkout" });
        assert.equal(result.cls?.environment, "staging");
    });

    test("one environment that cannot be read does not stop the others", async () => {
        everything();
        answerFile(h.gh, STAGING_FILE, "1.0\n2.0\n");
        const text = ok(await status({ service: "checkout" }));
        assert.match(text, /- staging: the pin could not be read: .* has 2 lines that match/);
        assert.match(text, /- qa: main pins 1\.4\.2/);
        assert.match(text, /- production: main pins 1\.4\.1/);
    });

    test("a service with no pin must be given an environment, and the message lists them", async () => {
        h.configure(pinSection());
        const result = await h.deploy.call({ action: "status", service: "orders-api" });
        assert.match(
            result.blocked ?? "",
            /deploy status without environment reads the pins of a service, and orders-api has none\. Name an environment: staging, production\. Usage: deploy status \{service, environment\?\}/,
        );
        assert.deepEqual(h.gh.calls(), []);
    });

    test("an unknown service lists the known ones", async () => {
        h.configure(pinSection());
        const result = await h.deploy.call({ action: "status", service: "nope" });
        assert.match(result.blocked ?? "", /deploy: no service named "nope"\. Known services: orders-api .*checkout/);
    });
});

describe("a status of a Helm environment is what it was", () => {
    test("reads no GitHub", async () => {
        h.configure(pinSection());
        h.cluster.answer({
            pods: list(pod("orders-api-0", { tag: "1.4.2" })),
            workloads: list(workload("orders-api", { tag: "1.4.2" })),
        });
        const text = ok(await h.deploy.call({ action: "status", service: "orders-api", environment: "staging" }));
        assert.match(text, /^No deploy or rollback was run from here in this session\./);
        assert.deepEqual(h.gh.calls(), []);
    });
});
