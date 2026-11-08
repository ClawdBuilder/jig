// The company onboarding list: setup asks its items in the company's order, with its labels and hints, puts the company's
// store first, and falls back to the validators when a plugin wrote no list.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, test } from "node:test";
import type { OnboardingEntry } from "../src/contract.ts";
import { loadConfigFile } from "../src/config.ts";
import type { SectionCheck } from "../src/config.ts";
import { buildSetupPlan } from "../src/setup-plan.ts";
import type { SetupState } from "../src/setup-plan.ts";

let home: string;
let file: string;

beforeEach(() => {
    home = mkdtempSync(path.join(tmpdir(), "jig-setup-onboarding-"));
    file = path.join(home, "jig.json");
    writeFileSync(file, JSON.stringify({ lens: { port: "high" } }));
});
afterEach(() => rmSync(home, { recursive: true, force: true }));

const checks = new Map<string, SectionCheck>([
    [
        "acme",
        (raw) => {
            const value = raw as { bastion?: { user?: unknown }; sso?: { token?: unknown } };
            const errors: string[] = [];
            if (typeof value?.bastion?.user !== "string" || value.bastion.user === "")
                errors.push("acme.bastion.user is required");
            if (typeof value?.sso?.token !== "string") errors.push("acme.sso.token is required");
            return errors;
        },
    ],
    ["lens", (raw) => (typeof (raw as { port?: unknown }).port === "number" ? [] : ["lens.port must be a number"])],
]);

const defaults = new Map<string, unknown>([["acme", { bastion: {} }]]);

const list: OnboardingEntry = {
    preferredStore: "pass",
    items: [
        { kind: "info", label: "Acme SSO", detail: "Acme's command signs you in." },
        {
            kind: "reference",
            section: "acme",
            path: "sso.token",
            label: "The Acme SSO token",
            why: "The gateway signs in with it.",
            suggested: { pass: "pass:acme/sso-token" },
            addHints: { pass: "pass insert acme/sso-token" },
        },
        {
            kind: "text",
            section: "acme",
            path: "bastion.user",
            label: "Your login on the bastion host",
            placeholder: "jdoe",
            why: "The databases go through the bastion.",
        },
        {
            kind: "pick",
            section: "acme",
            path: "gateway.proxy",
            label: "How requests reach Acme's network",
            choices: ["http://127.0.0.1:3128", "http://127.0.0.1:3129"],
        },
        {
            kind: "login",
            tool: "gh",
            status: ["gh", "auth", "status"],
            login: "gh auth login",
            label: "GitHub login",
            why: "Pull requests.",
        },
    ],
};

function state(onboarding?: OnboardingEntry): SetupState {
    return {
        personal: loadConfigFile(file, checks, {
            defaults,
            replace: new Map(),
            oneOf: new Map(),
            union: new Map(),
        }),
        sectionChecks: checks,
        defaults,
        replace: new Map(),
        oneOf: new Map(),
        union: new Map(),
        configPath: file,
        env: {},
        platform: "linux",
        pathLookup: () => "/usr/bin/program",
        enabledBackends: [],
        disabledBackends: [],
        companyBackends: [],
        commands: {},
        ...(onboarding === undefined ? {} : { onboarding }),
    };
}

describe("a company's onboarding list", () => {
    test("setup asks its items in the company's order, with its words", () => {
        const built = buildSetupPlan(state(list));
        assert.ok("plan" in built, "the plan is built");
        const plan = built.plan;
        assert.equal(plan.intro[0], "Acme SSO — Acme's command signs you in.");
        assert.deepEqual(plan.logins, [{ label: "GitHub login", command: "gh auth login", why: "Pull requests." }]);
        // The company's section comes first; lens, which the list does not name, keeps its place after it.
        assert.deepEqual(
            plan.sections.map((section) => section.name),
            ["acme", "lens"],
        );
        const fields = plan.sections[0]?.fields ?? [];
        assert.deepEqual(
            fields.map((field) => field.path),
            ["sso.token", "bastion.user", "gateway.proxy"],
        );
        const token = fields[0];
        assert.equal(token?.label, "The Acme SSO token");
        assert.equal(token?.question, "Where does the Acme SSO token live?");
        assert.equal(token?.reason, "The gateway signs in with it.");
        const user = fields[1];
        assert.equal(user?.label, "Your login on the bastion host");
        assert.equal(user?.placeholder, "jdoe");
        assert.equal(user?.reason, "The databases go through the bastion.");
        const proxy = fields[2];
        assert.equal(proxy?.kind, "pick");
        assert.deepEqual(proxy?.choices, ["http://127.0.0.1:3128", "http://127.0.0.1:3129"]);
    });

    test("the company's preferred store is first, and its suggested reference and hint are carried", () => {
        const built = buildSetupPlan(state(list));
        assert.ok("plan" in built);
        const token = built.plan.sections[0]?.fields.find((field) => field.path === "sso.token");
        assert.equal(token?.kind, "reference");
        assert.equal(token?.reference?.preferred, "pass");
        assert.equal(token?.reference?.stores[0], "pass");
        assert.deepEqual(token?.reference?.suggested, { pass: "pass:acme/sso-token" });
        assert.deepEqual(token?.reference?.addHints, { pass: "pass insert acme/sso-token" });
    });

    test("without a list, setup still builds the plan from the validators, with plain labels", () => {
        const built = buildSetupPlan(state(undefined));
        assert.ok("plan" in built);
        assert.deepEqual(built.plan.intro, []);
        assert.deepEqual(built.plan.logins, []);
        // acme is first by load order, not by a company list.
        assert.deepEqual(
            built.plan.sections.map((section) => section.name),
            ["acme", "lens"],
        );
        const labels = (built.plan.sections[0]?.fields ?? []).map((field) => field.label);
        assert.ok(!labels.includes("The Acme SSO token"), "the company's label is not there");
        assert.ok(
            labels.some((label) => label.toLowerCase().includes("token")),
            labels.join(", "),
        );
    });
});
