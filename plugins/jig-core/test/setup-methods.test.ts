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
import { runSetup, setupStateFrom } from "../src/setup.ts";
import type { SetupUi } from "../src/setup.ts";
import { createState } from "../src/state.ts";
import { fakePi } from "./support/fake-pi.ts";
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
        assert.ok("plan" in built, JSON.stringify(built));
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

    test("a company prefill fixes the plugin method's field", () => {
        const broker = {
            id: "transport",
            label: "Company broker",
            who: "this company",
            fields: [{ kind: "text" as const, path: "auth.transport", label: "The broker", value: "acme-broker" }],
        };
        const onboarding = checkOnboarding(
            { items: [], methods: { jira: { default: "transport", add: [broker] } } },
            new Map([["jira", methods]]),
        );
        const built = buildSetupPlan(state(onboarding));
        assert.ok("plan" in built, JSON.stringify(built));
        const section = built.plan.sections.find((one) => one.name === "jira");
        const chosen = section?.methods?.find((method) => method.id === "transport");
        assert.equal(chosen?.default, true);
        assert.equal(chosen?.fields[0]?.fixed, "acme-broker");
        assert.equal(chosen?.fields[0]?.path, "auth.transport");
        assert.equal(chosen?.fields[0]?.fixed, "acme-broker");
    });
});

describe("the production setup state and wildcard methods", () => {
    const apiMethods = [
        {
            id: "sign-in",
            label: "Sign-in",
            fields: [
                { kind: "text", path: "environments.*.environment", label: "Environment" },
                { kind: "text", path: "environments.*.signIn", label: "Sign-in service" },
            ],
        },
    ] as const;
    const apiChecks = new Map<string, SectionCheck>([
        [
            "api",
            (raw) => {
                const environments = (raw as { environments?: Record<string, { signIn?: unknown }> } | undefined)
                    ?.environments;
                if (environments === undefined) return ["api.environments: required"];
                return Object.entries(environments).some(([, entry]) => typeof entry.signIn !== "string")
                    ? ["api.environments: signIn is required"]
                    : [];
            },
        ],
    ]);

    function apiState(config: unknown, onboarding?: OnboardingEntry): SetupState {
        writeFileSync(file, JSON.stringify(config));
        const state = {
            personal: loadConfigFile(file, apiChecks),
            sectionChecks: apiChecks,
            defaults: new Map(),
            replace: new Map(),
            oneOf: new Map(),
            union: new Map(),
            sectionDefaults: new Map(),
            sectionReplace: new Map(),
            sectionOneOf: new Map(),
            sectionUnion: new Map(),
            company: { secretBackends: [] },
            onboarding,
            onboardingMethods: new Map([["api", apiMethods]]),
            configPath: file,
            env: {},
            platform: "linux" as const,
            pathLookup: () => undefined,
            enabledBackends: [],
            disabledBackends: [],
            companyBackends: [],
            commands: {},
        };
        return state as unknown as SetupState;
    }

    test("setupStateFrom passes the registered methods through a real state", () => {
        const state = createState(fakePi().pi, { env: {} });
        state.onboardingMethods.set("api", apiMethods);
        assert.equal(setupStateFrom(state).onboardingMethods, state.onboardingMethods);
    });

    test("wildcard paths are expanded to the configured environment names", () => {
        const built = buildSetupPlan(apiState({ api: { environments: { staging: { environment: "staging" } } } }));
        assert.ok("plan" in built, JSON.stringify(built));
        const section = built.plan.sections.find((one) => one.name === "api");
        assert.deepEqual(
            section?.methods?.[0]?.fields.map((field) => field.path),
            ["environments.staging.environment", "environments.staging.signIn"],
        );
    });

    test("a named section enters the plan even when it is valid, so its sign-in can change", () => {
        const state = apiState({
            api: { environments: { staging: { environment: "staging", signIn: "acme-sso" } } },
        });
        state.requestedSection = "api";
        const built = buildSetupPlan(state);
        assert.ok("plan" in built, JSON.stringify(built));
        assert.equal(
            built.plan.sections.some((one) => one.name === "api"),
            true,
            JSON.stringify(built.plan.sections.map((one) => [one.name, one.fields.length, one.methods?.length])),
        );
    });

    test("an already valid section does not enter the plan just because it has methods", () => {
        const built = buildSetupPlan(
            apiState({ api: { environments: { staging: { environment: "staging", signIn: "acme-sso" } } } }),
        );
        assert.ok("plan" in built, JSON.stringify(built));
        assert.equal(
            built.plan.sections.some((one) => one.name === "api"),
            false,
        );
    });
});

describe("fallbacks, wildcards and unknown sections", () => {
    function wildcardState(section: string, config: unknown, methods: readonly OnboardingMethod[]): SetupState {
        writeFileSync(file, JSON.stringify(config));
        return {
            personal: loadConfigFile(file, new Map([[section, () => []]])),
            sectionChecks: new Map([[section, () => []]]),
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
            onboardingMethods: new Map([[section, methods]]),
        };
    }

    test("hiding the default falls back to the first visible method", () => {
        const onboarding = checkOnboarding(
            { items: [], methods: { jira: { hide: ["cloud-basic"] } } },
            new Map([["jira", methods]]),
        );
        const built = buildSetupPlan({ ...state(onboarding), requestedSection: "jira" });
        assert.ok("plan" in built, JSON.stringify(built));
        const section = built.plan.sections.find((one) => one.name === "jira");
        assert.equal(section?.methods?.[0]?.id, "transport");
        assert.equal(section?.methods?.[0]?.default, true);
    });

    test("a prefill and a new company method both survive", () => {
        const add = [
            {
                id: "transport",
                label: "Company broker",
                fields: [{ kind: "text" as const, path: "auth.transport", label: "Broker", value: "acme-broker" }],
            },
            {
                id: "own-sign-in",
                label: "Own sign-in",
                fields: [{ kind: "text" as const, path: "auth.signIn", label: "Service", value: "acme-sso" }],
            },
        ];
        const onboarding = checkOnboarding(
            { items: [], methods: { jira: { default: "transport", add } } },
            new Map([["jira", methods]]),
        );
        const built = buildSetupPlan({ ...state(onboarding), requestedSection: "jira" });
        assert.ok("plan" in built, JSON.stringify(built));
        const section = built.plan.sections.find((one) => one.name === "jira");
        assert.equal(section?.methods?.find((one) => one.id === "transport")?.fields[0]?.fixed, "acme-broker");
        assert.equal(section?.methods?.find((one) => one.id === "own-sign-in")?.fields[0]?.fixed, "acme-sso");
    });

    test("a string mapping and a dotted key produce a method with a reason, not an unsafe path", () => {
        const method = {
            id: "environment",
            label: "Environment",
            fields: [{ kind: "text" as const, path: "environments.*.signIn", label: "Sign-in" }],
        };
        const state = wildcardState("api", { api: { environments: { staging: "staging", "a.b": "production" } } }, [
            method,
        ]);
        state.requestedSection = "api";
        const built = buildSetupPlan(state);
        assert.ok("plan" in built, JSON.stringify(built));
        const section = built.plan.sections.find((one) => one.name === "api");
        assert.deepEqual(section?.methods?.[0]?.fields, []);
        assert.match(section?.methods?.[0]?.notes?.[0] ?? "", /No match/);
    });

    test("an unknown setup section is a usage error listing the known names", async () => {
        writeFileSync(file, "{}");
        const seen: string[] = [];
        const ui = {
            notify: (text: string) => void seen.push(text),
        } as unknown as SetupUi;
        const state = {
            sectionChecks: new Map([["jira", () => []]]),
        } as unknown as Parameters<typeof runSetup>[0];
        assert.equal(await runSetup(state, ui, "nope"), 2);
        assert.match(seen.join("\n"), /Unknown section "nope".*jira/);
    });
});
