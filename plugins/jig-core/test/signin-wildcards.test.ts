// Wildcard sign-in methods against the real ops and api validators: what the plan offers, what it skips, and the
// reason it prints when a dynamic name has no match.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, test } from "node:test";
import { validateApi } from "../../jig-api/src/config.ts";
import { API_METHODS } from "../../jig-api/src/index.ts";
import { validateOps } from "../../jig-ops/src/catalog.ts";
import { OPS_METHODS } from "../../jig-ops/src/index.ts";
import { loadConfigFile } from "../src/config.ts";
import { buildSetupPlan } from "../src/setup-plan.ts";
import type { SetupState } from "../src/setup-plan.ts";

let home: string;
let file: string;
beforeEach(() => {
    home = mkdtempSync(path.join(tmpdir(), "jig-signin-wildcards-"));
    file = path.join(home, "jig.json");
});
afterEach(() => rmSync(home, { recursive: true, force: true }));

function state(section: "ops" | "api", methods: SetupState["onboardingMethods"]): SetupState {
    const checks = new Map([
        ["ops", validateOps],
        ["api", validateApi],
    ]);
    return {
        personal: loadConfigFile(file, checks),
        sectionChecks: checks,
        defaults: new Map(),
        replace: new Map(),
        oneOf: new Map(),
        union: new Map(),
        configPath: file,
        env: {},
        platform: "linux",
        pathLookup: () => undefined,
        enabledBackends: [],
        disabledBackends: [],
        companyBackends: [],
        commands: {},
        onboardingMethods: methods,
        requestedSection: section,
    };
}

test("ops offers ci.auth for services with ci, skips no-ci and unsafe names, through validateOps", () => {
    const ops = {
        services: {
            "with-ci": { ci: { system: "gitlab", url: "https://gitlab.example.com", project: "acme/orders" } },
            "with-ci-no-auth": { ci: { system: "jenkins", url: "https://jenkins.example.com", job: "orders/build" } },
            "no-ci": { environments: { staging: { health: "https://example.test/health" } } },
            "a.b": { ci: { system: "gitlab", url: "https://gitlab.example.com", project: "acme/orders" } },
            constructor: { ci: { system: "gitlab", url: "https://gitlab.example.com", project: "acme/orders" } },
        },
    };
    writeFileSync(file, JSON.stringify({ ops }));
    // The real validator refuses a service without an auth until setup supplies one; that is why the plan offers it.
    assert.ok(
        validateOps(ops).some((error) => /ci\.auth/.test(error)),
        validateOps(ops).join("\n"),
    );
    const built = buildSetupPlan(state("ops", new Map([["ops", OPS_METHODS]])));
    assert.ok("plan" in built, JSON.stringify(built));
    const paths =
        built.plan.sections
            .find((one) => one.name === "ops")
            ?.methods?.flatMap((method) => method.fields.map((field) => field.path)) ?? [];
    assert.ok(
        paths.some((one) => one.startsWith("services.with-ci.ci.auth.")),
        paths.join("\n"),
    );
    assert.ok(
        paths.some((one) => one.startsWith("services.with-ci-no-auth.ci.auth.")),
        paths.join("\n"),
    );
    assert.equal(
        paths.some((one) => one.includes("no-ci")),
        false,
    );
    assert.equal(
        paths.some((one) => one.includes("a.b")),
        false,
    );
    assert.equal(
        paths.some((one) => one.includes("constructor")),
        false,
    );
});

test("api asks for a name when the environment mapping is a string, through validateApi", () => {
    const api = {
        collections: { orders: { http: "/work/orders" } },
        environments: { staging: "staging", "a.b": "production", constructor: "production" },
    };
    writeFileSync(file, JSON.stringify({ api }));
    assert.deepEqual(validateApi(api), []);
    const built = buildSetupPlan(state("api", new Map([["api", API_METHODS]])));
    assert.ok("plan" in built, JSON.stringify(built));
    const methods = built.plan.sections.find((one) => one.name === "api")?.methods ?? [];
    assert.deepEqual(
        methods.flatMap((method) => method.fields),
        [],
    );
    assert.ok(methods.every((method) => (method.notes ?? []).some((note) => /No match/.test(note))));
});

test("wildcard current: the ops and api methods the configured names use are marked", () => {
    const ops = {
        services: {
            "with-ci": {
                ci: {
                    system: "gitlab",
                    url: "https://gitlab.example.com",
                    project: "acme/orders",
                    auth: { token: "pass:ci/token" },
                },
            },
        },
    };
    writeFileSync(file, JSON.stringify({ ops }));
    const built = buildSetupPlan(state("ops", new Map([["ops", OPS_METHODS]])));
    assert.ok("plan" in built, JSON.stringify(built));
    assert.equal(
        built.plan.sections.find((one) => one.name === "ops")?.methods?.find((one) => one.id === "ci-token")?.current,
        true,
    );
    const api = {
        collections: { orders: { http: "/work/orders" } },
        environments: { staging: { environment: "staging", signIn: "acme-sso" } },
    };
    writeFileSync(file, JSON.stringify({ api }));
    const apiPlan = buildSetupPlan(state("api", new Map([["api", API_METHODS]])));
    assert.ok("plan" in apiPlan, JSON.stringify(apiPlan));
    assert.equal(
        apiPlan.plan.sections
            .find((one) => one.name === "api")
            ?.methods?.find((one) => one.id === "environment-sign-in")?.current,
        true,
    );
});
