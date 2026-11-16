// The company onboarding list: setup asks its items in the company's order, with its labels and hints, puts the company's
// store first, and falls back to the validators when a plugin wrote no list.
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, test } from "node:test";
import type { OnboardingEntry } from "../src/contract.ts";
import { checkOnboarding } from "../src/onboarding.ts";
import { loadConfigFile } from "../src/config.ts";
import type { SectionCheck } from "../src/config.ts";
import { applyProposal, pendingProposalCount, proposalId, recordDeclined } from "../src/setup-proposal.ts";
import { buildSetupPlan } from "../src/setup-plan.ts";
import { writeSetup } from "../src/setup-write.ts";
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

const proposalList: OnboardingEntry = {
    items: [
        {
            kind: "proposal",
            section: "startChecks",
            value: { name: "VPN", tcp: "vpn.example.com:443", hint: "connect the VPN" },
            label: "A check that the VPN is up",
            why: "The ticket needs it to reach the repository.",
        },
    ],
};

function proposalPlan(entry: OnboardingEntry = proposalList) {
    const built = buildSetupPlan(state(entry));
    assert.ok("plan" in built);
    return built.plan;
}

function proposalField(plan: ReturnType<typeof proposalPlan>) {
    return plan.sections.flatMap((section) => section.fields).find((field) => field.kind === "proposal");
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

    test("an optional item is marked skippable, and a required one is not", () => {
        const built = buildSetupPlan(
            state({
                items: [
                    { kind: "text", section: "acme", path: "required.field", label: "Your required field" },
                    {
                        kind: "text",
                        section: "acme",
                        path: "optional.field",
                        label: "Your optional field",
                        optional: true,
                    },
                ],
            }),
        );
        assert.ok("plan" in built, "the plan is built");
        const fields = built.plan.sections.flatMap((section) => section.fields);
        const required = fields.find((field) => field.path === "required.field");
        assert.equal(required?.optional, undefined);
        assert.equal(required?.question, "Your required field");
        const optional = fields.find((field) => field.path === "optional.field");
        assert.equal(optional?.optional, true);
        assert.equal(optional?.question, "Your optional field (optional: press Enter to leave it unset)");
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

describe("a company's proposed entries", () => {
    test("accepting a proposal writes the entry into the person's own section", () => {
        const plan = proposalPlan();
        const field = proposalField(plan);
        assert.equal(field?.section, "startChecks");
        assert.equal(field?.reason, "The ticket needs it to reach the repository.");
        assert.equal(pendingProposalCount(plan), 1);
        const draft = structuredClone(plan.raw);
        const result = applyProposal(plan, draft, field!);
        assert.ok("change" in result);
        writeSetup(plan, [result.change], new Date("2026-01-01T00:00:00Z"));
        const written = JSON.parse(readFileSync(file, "utf8")) as { startChecks?: Array<{ name: string }> };
        assert.deepEqual(
            written.startChecks?.map((entry) => entry.name),
            ["VPN"],
        );
    });

    test("a proposed map entry lands under its key, not as the whole map", () => {
        const entry: OnboardingEntry = {
            items: [
                {
                    kind: "proposal",
                    section: "git",
                    path: "accounts",
                    key: "github.com:acme/*",
                    value: "acme-work",
                    label: "The acme-work GitHub account for acme repositories",
                },
            ],
        };
        const plan = proposalPlan(entry);
        const field = proposalField(plan);
        assert.deepEqual(field?.proposal && field.proposal.key, "github.com:acme/*");
        const result = applyProposal(plan, structuredClone(plan.raw), field!);
        assert.ok("change" in result);
        writeSetup(plan, [result.change], new Date("2026-01-01T00:00:00Z"));
        assert.deepEqual(JSON.parse(readFileSync(file, "utf8")), {
            lens: { port: "high" },
            git: { accounts: { "github.com:acme/*": "acme-work" } },
        });
    });

    test("declining writes nothing, remembers the no, and setup does not ask again", () => {
        const plan = proposalPlan();
        const field = proposalField(plan);
        assert.ok(field?.proposal);
        recordDeclined(plan.decisionsFile, proposalId(field.proposal));
        assert.deepEqual(JSON.parse(readFileSync(file, "utf8")), { lens: { port: "high" } });
        assert.equal(proposalField(proposalPlan()), undefined);
        assert.equal(pendingProposalCount(proposalPlan()), 0);
    });

    test("an entry the person already has is not proposed again", () => {
        writeFileSync(
            file,
            JSON.stringify({ startChecks: [{ name: "VPN", tcp: "vpn.example.com:443", hint: "connect the VPN" }] }),
        );
        assert.equal(proposalField(proposalPlan()), undefined);
    });
});

test("a proposal is validated when the company registers it", () => {
    assert.doesNotThrow(() => checkOnboarding({ items: proposalList.items }));
    assert.throws(
        () =>
            checkOnboarding({
                items: [{ kind: "proposal", section: "rules", value: {}, label: "A rule" }],
            }),
        /a proposal may name startChecks, git or secrets/,
    );
    assert.throws(
        () =>
            checkOnboarding({
                items: [
                    {
                        kind: "proposal",
                        section: "startChecks",
                        path: "checks",
                        value: { name: "VPN", tcp: "vpn.example.com:443" },
                        label: "A check",
                    },
                ],
            }),
        /no path or key/,
    );
});

test("a secrets proposal names only pass binding keys, validated by parsePassBinding", () => {
    const valid: OnboardingEntry = {
        items: [
            {
                kind: "proposal",
                section: "secrets",
                path: "pass",
                key: "storeDir",
                value: "/tmp/jig-pass-store",
                label: "The pass store folder",
                why: "Your team keeps its entries there.",
            },
        ],
    };
    assert.doesNotThrow(() => checkOnboarding(valid));
    const plan = proposalPlan(valid);
    const field = proposalField(plan);
    assert.match(field?.question ?? "", /changes where your secrets are read from/);
    assert.throws(
        () =>
            checkOnboarding({
                items: [
                    {
                        kind: "proposal",
                        section: "secrets",
                        path: "pass",
                        key: "notAKey",
                        value: "x",
                        label: "A bad key",
                    },
                ],
            }),
        /must be one of storeDir, gnupgHome, unlockAtStart/,
    );
    assert.throws(
        () =>
            checkOnboarding({
                items: [
                    {
                        kind: "proposal",
                        section: "secrets",
                        path: "pass",
                        key: "storeDir",
                        value: "relative/path",
                        label: "A bad folder",
                    },
                ],
            }),
        /absolute path/,
    );
});

test("a bad accepted value is refused before anything is written", () => {
    const bad: OnboardingEntry = {
        items: [
            {
                kind: "proposal",
                section: "startChecks",
                value: { name: "VPN", tcp: "not-a-host:port" },
                label: "A broken check",
            },
        ],
    };
    const plan = proposalPlan(bad);
    const field = proposalField(plan);
    assert.ok(field);
    const result = applyProposal(plan, structuredClone(plan.raw), field);
    assert.ok("problem" in result);
    assert.match(result.problem, /tcp|must be host:port/);
    assert.deepEqual(JSON.parse(readFileSync(file, "utf8")), { lens: { port: "high" } });
});
