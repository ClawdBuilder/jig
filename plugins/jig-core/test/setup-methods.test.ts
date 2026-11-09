// Setup asks the plugin's sign-in methods first, with the company's default and hidden ids; the plan carries each
// method's fields, including a company-only fixed transport, and no method id is written.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, test } from "node:test";
import { loadConfigFile } from "../src/config.ts";
import type { SectionCheck } from "../src/config.ts";
import type { OnboardingEntry, OnboardingMethod } from "../src/contract.ts";
import { checkOnboarding } from "../src/onboarding.ts";
import { buildSetupPlan } from "../src/setup-plan.ts";
import type { SetupState } from "../src/setup-plan.ts";

let home: string;
let file: string;

beforeEach(() => {
    home = mkdtempSync(path.join(tmpdir(), "jig-setup-methods-"));
    file = path.join(home, "jig.json");
    writeFileSync(file, JSON.stringify({ jira: {} }));
});
afterEach(() => rmSync(home, { recursive: true, force: true }));

const checks = new Map<string, SectionCheck>([
    [
        "jira",
        (raw) =>
            typeof (raw as { auth?: unknown } | undefined)?.auth === "object"
                ? []
                : ["jira.auth: required, one of email/token, token, oauth, signIn or transport"],
    ],
]);

const methods: readonly OnboardingMethod[] = [
    {
        id: "cloud-basic",
        label: "Email and API token",
        who: "Jira Cloud",
        fields: [
            { kind: "text", path: "auth.email", label: "Your Jira email" },
            { kind: "reference", path: "auth.token", label: "The API token" },
        ],
    },
    {
        id: "transport",
        label: "Company transport",
        fields: [{ kind: "text", path: "auth.transport", label: "The transport name" }],
    },
];

function state(onboarding?: OnboardingEntry): SetupState {
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
        ...(onboarding === undefined ? {} : { onboarding }),
        onboardingMethods: new Map([["jira", methods]]),
    };
}

describe("the setup plan's sign-in methods", () => {
    test("offers the plugin methods, defaults the company's choice and hides an id", () => {
        const onboarding = checkOnboarding(
            { items: [], methods: { jira: { default: "transport", hide: ["cloud-basic"] } } },
            new Map([["jira", methods]]),
        );
        const built = buildSetupPlan(state(onboarding));
        assert.ok("plan" in built, "plan");
        const section = built.plan.sections.find((one) => one.name === "jira");
        assert.deepEqual(
            section?.methods?.map((method) => method.id),
            ["transport"],
        );
        assert.equal(section?.methods?.[0]?.default, true);
        assert.deepEqual(
            section?.methods?.[0]?.fields.map((field) => [field.path, field.kind]),
            [["auth.transport", "text"]],
        );
    });

    test("a company-only method's field is fixed, and the method id is not among the fields", () => {
        const broker = {
            id: "broker",
            label: "Company broker",
            who: "this company",
            fields: [{ kind: "text" as const, path: "auth.transport", label: "The broker", value: "acme-broker" }],
        };
        const onboarding = checkOnboarding(
            { items: [], methods: { jira: { default: "broker", add: [broker] } } },
            new Map([["jira", methods]]),
        );
        const built = buildSetupPlan(state(onboarding));
        assert.ok("plan" in built, "plan");
        const section = built.plan.sections.find((one) => one.name === "jira");
        const chosen = section?.methods?.find((method) => method.id === "broker");
        assert.equal(chosen?.default, true);
        assert.equal(chosen?.fields[0]?.fixed, "acme-broker");
        assert.equal(chosen?.fields[0]?.path, "auth.transport");
        assert.equal(
            chosen?.fields.some((field) => field.path === "id"),
            false,
        );
    });
});
