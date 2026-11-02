// The `pin` deploy method and the read-only `pinned` entry in the catalog: what is accepted, what each refusal says, and
// that a pin needs no cluster. Nothing here reads GitHub.
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { layered } from "../../jig-core/src/section-defaults.ts";
import { OPS_REPLACE, pinOf, readOps, validateOps } from "../src/catalog.ts";
import type { Catalog } from "../src/catalog.ts";
import { branchPattern, groupNames, isRefName } from "../src/deploy/pin-config.ts";
import type { PinDeploy } from "../src/deploy/pin-config.ts";
import { pinDeploy, pinnedProduction, pinSection, qaDeploy } from "./support/pin-world.ts";
import type { Raw } from "./support/section.ts";

const AT = "ops.services.checkout.environments";

function catalog(raw: Raw = pinSection()): Catalog {
    const read = readOps(raw);
    assert.deepEqual(read.errors, []);
    return read.catalog as Catalog;
}

/** The errors of a catalog whose staging deploy is the pin with these changes (a key set to undefined is left out). */
function errorsOf(more: Raw): string[] {
    return validateOps(pinSection({ staging: { deploy: pinDeploy(more) } }));
}

describe("a valid pin", () => {
    test("is read into its repository, branch, files, patterns and templates, with merge person by default", () => {
        const staging = catalog().services.get("checkout")?.environments.get("staging");
        const deploy = staging?.deploy as PinDeploy;
        assert.equal(deploy.method, "pin");
        assert.deepEqual(
            [deploy.repo, deploy.base, deploy.merge, deploy.apply],
            ["acme/deploy-control", "main", "person", "job"],
        );
        assert.equal(deploy.pins[0]?.file, "clusters/staging/checkout/chart.version");
        assert.deepEqual(deploy.pins[0]?.groups, ["version"]);
        assert.equal(deploy.pins[0]?.write, "{version}");
        assert.equal(deploy.branch, "deploy/{ticket}-{environment}-{service}");
        assert.equal(deploy.ticket?.regex.test("PROJ-57"), true);
        assert.equal(deploy.ticket?.regex.test("xPROJ-57"), false, "a value pattern must match the whole value");
        assert.equal(staging?.kubernetes, undefined, "a pin changes a line of a repository and needs no cluster");
    });

    test("pinOf is the pin deploy of an environment, or the read-only pinned entry of one with no deploy", () => {
        const environments = catalog().services.get("checkout")?.environments;
        assert.equal(pinOf(environments?.get("staging") as never)?.base, "main");
        assert.equal(environments?.get("production")?.deploy, undefined);
        assert.equal(
            pinOf(environments?.get("production") as never)?.pins[0]?.file,
            "clusters/production/checkout/chart.version",
        );
        const orders = catalog().services.get("orders-api")?.environments.get("staging");
        assert.equal(pinOf(orders as never), undefined, "a Helm environment has no pin");
    });

    test("pinned is a place to read and no more: it holds no write line", () => {
        const production = catalog().services.get("checkout")?.environments.get("production");
        assert.equal("write" in (production?.pinned?.pins[0] ?? {}), false);
        assert.equal(production?.pinned?.holder?.regex.test("0.0.0-pr-feature-PROJ-41-1a2b3c4"), true);
    });

    test("a pin with two files, a kept group and a value a call may set", () => {
        const qa = catalog().services.get("checkout")?.environments.get("qa")?.deploy as PinDeploy;
        assert.deepEqual(
            qa.pins.map((pin) => pin.groups),
            [["version", "build"], ["version"]],
        );
        assert.deepEqual([...qa.values.keys()], ["build"]);
    });

    test("an environment may have only a pinned entry", () => {
        const raw = pinSection();
        ((raw.services as Record<string, Raw>).checkout as { environments: Record<string, Raw> }).environments.edge = {
            pinned: pinnedProduction(),
        };
        assert.deepEqual(validateOps(raw), []);
    });

    test("a user's deploy replaces the company's whole, so a pin is never mixed with Helm", () => {
        const company = pinSection({
            staging: { deploy: { method: "helm", release: "checkout", chart: "deploy/chart" } },
        });
        const mine = { services: { checkout: { environments: { staging: { deploy: pinDeploy() } } } } };
        (
            (company.services as Record<string, Raw>).checkout as { environments: Record<string, Raw> }
        ).environments.staging = {
            ...(((company.services as Record<string, Raw>).checkout as { environments: Record<string, Raw> })
                .environments.staging as Raw),
            runtime: { kubernetes: { context: "c", namespace: "n", selector: "app=checkout" } },
        };
        assert.ok(OPS_REPLACE.includes("services.*.environments.*.deploy"));
        assert.deepEqual(validateOps(layered(company, mine, OPS_REPLACE)), []);
        const mixed = validateOps(layered(company, mine));
        assert.ok(mixed.length > 0, "merged key by key, Helm's release and chart are unknown fields of a pin");
    });
});

describe("a pin that is refused", () => {
    const deploy = `${AT}.staging.deploy`;

    test("names every error by its key and never repeats a value", () => {
        assert.deepEqual(errorsOf({ repo: "not a repo" }), [
            `${deploy}.repo: must be a GitHub repository as owner/name, such as acme/deploy-control`,
        ]);
        assert.deepEqual(errorsOf({ base: "a..b" }), [`${deploy}.base: must be a plain branch name, such as main`]);
        assert.deepEqual(errorsOf({ repo: undefined }), [
            `${deploy}.repo: required, a GitHub repository as owner/name, such as acme/deploy-control`,
        ]);
        assert.deepEqual(errorsOf({ colour: "red" }), [`${deploy}.colour: unknown field`]);
    });

    test("needs 1 to 4 places, each a plain path, once", () => {
        const pin = (file: string) => ({ file, line: "^(?<version>\\S+)$", write: "{version}" });
        assert.deepEqual(errorsOf({ pins: [] }), [
            `${deploy}.pins: must be a list of 1 to 4 places the version is written`,
        ]);
        assert.equal(errorsOf({ pins: [1, 2, 3, 4, 5].map((n) => pin(`f${n}`)) }).length, 1);
        assert.deepEqual(errorsOf({ pins: [pin("../secrets.txt")] }), [
            `${deploy}.pins[0].file: must not contain . or .. as a folder`,
        ]);
        assert.match(errorsOf({ pins: [pin("a b")] })[0] ?? "", /pins\[0\]\.file: must be a path in the repository/);
        assert.match(errorsOf({ pins: [pin("a/b"), pin("a/b")] })[0] ?? "", /pins\[1\]\.file: a file may appear once/);
    });

    test("a line pattern must be valid and have a version group", () => {
        const pin = (line: string) => ({ file: "a/b", line, write: "{version}" });
        assert.deepEqual(errorsOf({ pins: [pin("^(\\S+$")] }), [
            `${deploy}.pins[0].line: is not a valid regular expression`,
        ]);
        assert.deepEqual(errorsOf({ pins: [pin("^\\S+$")] }), [
            `${deploy}.pins[0].line: must have a named group (?<version>...) that holds the version`,
        ]);
        assert.deepEqual(errorsOf({ pins: [pin("^(?<version>\\S+) (?<ticket>\\S+)$")] }), [
            `${deploy}.pins[0].line: the group name ticket is a placeholder of its own`,
        ]);
    });

    test("a write line holds {version} and only placeholders there are", () => {
        const pin = (write: string) => ({ file: "a/b", line: "^v=(?<version>\\S+) (?<build>b\\d+)$", write });
        assert.deepEqual(errorsOf({ pins: [pin("v={version} {build}")] }), []);
        assert.deepEqual(errorsOf({ pins: [pin("v={version} {colour}")] }), [
            `${deploy}.pins[0].write: unknown placeholder {colour}`,
        ]);
        assert.deepEqual(errorsOf({ pins: [pin("v=1.0.0")] }), [
            `${deploy}.pins[0].write: must contain {version}, or the line would not change with the version`,
        ]);
        assert.match(
            errorsOf({ pins: [{ file: "a/b", line: "^(?<version>\\S+)$" }] })[0] ?? "",
            /pins\[0\]\.write: required/,
        );
    });

    test("templates use the four placeholders, and make a branch name and a title that can be used", () => {
        assert.deepEqual(errorsOf({ branch: "deploy/{ticket}-{colour}" }), [
            `${deploy}.branch: unknown placeholder {colour}`,
        ]);
        assert.match(errorsOf({ branch: "deploy {ticket}" })[0] ?? "", /branch: must make a plain branch name/);
        assert.match(errorsOf({ branch: "../{ticket}" })[0] ?? "", /branch: must make a plain branch name/);
        assert.deepEqual(errorsOf({ title: "deploy {service}\nnow" }), [
            `${deploy}.title: required, text on one line with placeholders from {version}, {ticket}, {service}, {environment}`,
        ]);
    });

    test("{ticket} in a template needs a ticket pattern", () => {
        assert.deepEqual(errorsOf({ ticket: undefined }), [
            `${deploy}.ticket: required, because a template uses {ticket}`,
        ]);
        const noTicket = {
            branch: "deploy/{environment}-{service}",
            title: "deploy {service} {version}",
            ticket: undefined,
        };
        assert.deepEqual(errorsOf(noTicket), []);
    });

    test("holder needs a ticket group and runsAs a version group", () => {
        assert.deepEqual(errorsOf({ holder: "PROJ-\\d+" }), [
            `${deploy}.holder: must have a named group (?<ticket>...)`,
        ]);
        assert.deepEqual(errorsOf({ runsAs: "^\\S+$" }), [`${deploy}.runsAs: must have a named group (?<version>...)`]);
        assert.deepEqual(errorsOf({ runsAs: "^(?<version>\\d+\\.\\d+\\.\\d+)-\\d+$" }), []);
    });

    test("values name groups of a line other than version, and merge and apply are from their lists", () => {
        assert.deepEqual(errorsOf({ values: { colour: "^x$" } }), [
            `${deploy}.values.colour: must be a named group of a pin's line, other than version`,
        ]);
        assert.deepEqual(errorsOf({ merge: "robot" }), [`${deploy}.merge: must be person (the default) or tool`]);
        assert.match(errorsOf({ apply: undefined })[0] ?? "", /apply: required, job/);
    });

    test("apply job needs the environment's job, and apply itself needs none", () => {
        const raw = pinSection({ staging: { job: undefined } });
        const errors = validateOps(raw);
        assert.deepEqual(errors, [`${deploy}.apply: "job" needs the environment's job, which deploys what main pins`]);
        assert.deepEqual(errorsOf({ apply: "itself" }), []);
        const noJob = pinSection({ staging: { job: undefined, deploy: pinDeploy({ apply: "itself" }) } });
        assert.deepEqual(validateOps(noJob), []);
    });

    test("pinned beside a deploy is an error, and a write line in pinned is an unknown field", () => {
        const both = pinSection({ staging: { pinned: pinnedProduction() } });
        assert.deepEqual(validateOps(both), [
            `${AT}.staging.pinned: is for an environment with no deploy; a pin deploy is read through itself`,
        ]);
        const write = pinSection({
            production: {
                pinned: pinnedProduction({ pins: [{ file: "a/b", line: "^(?<version>\\S+)$", write: "{version}" }] }),
            },
        });
        assert.deepEqual(validateOps(write), [`${AT}.production.pinned.pins[0].write: unknown field`]);
    });

    test("Helm and kubectl still need a cluster, and an environment still needs at least one thing", () => {
        const helm = pinSection({
            staging: { deploy: { method: "helm", release: "checkout", chart: "deploy/chart" } },
        });
        assert.match(validateOps(helm)[0] ?? "", /deploys to a Kubernetes cluster/);
        const raw = pinSection();
        ((raw.services as Record<string, Raw>).checkout as { environments: Record<string, Raw> }).environments.empty =
            {};
        assert.deepEqual(validateOps(raw), [
            `${AT}.empty: must have at least one of deploy, pinned, runtime, health and job`,
        ]);
    });

    test("qa with two files keeps its own checks", () => {
        assert.deepEqual(validateOps(pinSection({ staging: { deploy: qaDeploy() } })), []);
    });
});

describe("the helpers of a pin", () => {
    test("group names are read from the pattern's text, not from lookbehinds, classes or escapes", () => {
        assert.deepEqual(groupNames("^(?<version>\\S+) (?<build>b\\d+)$"), ["version", "build"]);
        assert.deepEqual(groupNames("(?<=x)(?<!y)[(?<no>]\\(?<escaped>(?:a)"), []);
    });

    test("a ref name is plain: no .., //, /. or .lock, and no leading dash", () => {
        for (const good of ["main", "release/1.0", "deploy/PROJ-57-staging-checkout"])
            assert.equal(isRefName(good), true, good);
        for (const bad of ["", "-x", "a..b", "a//b", "a/.b", "a.lock", "a/", "a b", "a~b"])
            assert.equal(isRefName(bad), false, bad);
    });

    test("the open pull requests of a pin are found by a pattern made from the branch template", () => {
        const pattern = branchPattern("deploy/{ticket}-{environment}-{service}", "checkout", "staging");
        assert.equal(pattern.test("deploy/PROJ-57-staging-checkout"), true);
        assert.equal(pattern.test("deploy/PROJ-57-qa-checkout"), false);
        assert.equal(pattern.test("other/PROJ-57-staging-checkout"), false);
    });
});
