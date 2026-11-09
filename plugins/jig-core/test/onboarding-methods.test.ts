// Sign-in methods: the plugin owns their fields and shapes, and the company may only choose among the ids or add a
// fixed sign-in/transport method. Two methods of one section must differ in shape, so no method id is written anywhere.
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { OnboardingEntry, OnboardingMethod } from "../src/contract.ts";
import { checkOnboarding, checkOnboardingMethods, inferredMethod } from "../src/onboarding.ts";
import { withJig } from "../src/client.ts";
import { buildApi } from "../src/api.ts";
import { createState } from "../src/state.ts";
import { fakePi } from "./support/fake-pi.ts";

const methods: readonly OnboardingMethod[] = [
    {
        id: "token",
        label: "Token",
        who: "the service",
        fields: [{ kind: "reference", path: "auth.token", label: "The token" }],
    },
    {
        id: "transport",
        label: "Company transport",
        fields: [{ kind: "text", path: "auth.transport", label: "The transport name" }],
    },
];

const entry = (methodsField: unknown): OnboardingEntry =>
    checkOnboarding({ items: [], methods: { jira: methodsField } }, new Map([["jira", methods]]));

describe("checkOnboardingMethods", () => {
    test("accepts distinct shapes and rejects a second method with the same shape", () => {
        assert.equal(checkOnboardingMethods("jira", methods).length, 2);
        assert.throws(
            () =>
                checkOnboardingMethods("jira", [
                    methods[0],
                    {
                        id: "other",
                        label: "Other",
                        fields: [{ kind: "reference", path: "auth.token", label: "Token" }],
                    },
                ]),
            /same required paths/,
        );
    });

    test("rejects duplicate ids, bad paths and a plugin field with a fixed value", () => {
        assert.throws(() => checkOnboardingMethods("jira", [methods[0], methods[0]]), /used twice/);
        assert.throws(
            () =>
                checkOnboardingMethods("jira", [
                    { id: "x", label: "X", fields: [{ kind: "text", path: "../x", label: "X" }] },
                ]),
            /path/,
        );
        for (const path of ["auth.constructor", "auth.prototype", "auth.__proto__"]) {
            assert.throws(
                () =>
                    checkOnboardingMethods("jira", [
                        { id: "x", label: "X", fields: [{ kind: "text", path, label: "X" }] },
                    ]),
                /prototype key/,
                path,
            );
        }
        assert.throws(
            () =>
                checkOnboardingMethods("jira", [
                    { id: "x", label: "X", fields: [{ kind: "text", path: "auth.x", label: "X", value: "fixed" }] },
                ]),
            /only a company-only method/,
        );
    });
});

describe("the company's method choice", () => {
    test("names a registered default and hides registered ids", () => {
        const checked = entry({ default: "transport", hide: ["token"] });
        assert.deepEqual(checked.methods, { jira: { default: "transport", hide: ["token"] } });
        assert.deepEqual(checked.items, []);
    });

    test("rejects an id the plugin did not register", () => {
        assert.throws(() => entry({ default: "nope" }), /not a method of this section/);
        assert.throws(() => entry({ hide: ["nope"] }), /not a method of this section/);
    });

    test("adds a company-only fixed transport, and rejects a non-fixed or non-transport one", () => {
        const broker = {
            id: "transport",
            label: "Company broker",
            who: "this company",
            fields: [{ kind: "text", path: "auth.transport", value: "acme-broker", label: "The broker" }],
        };
        assert.deepEqual(entry({ add: [broker] }).methods?.jira?.add?.[0]?.fields[0]?.path, "auth.transport");
        assert.throws(() => entry({ add: [{ ...broker, id: "broker" }] }), /use "transport" to prefill/);

        assert.throws(
            () =>
                entry({ add: [{ ...broker, fields: [{ kind: "text", path: "auth.transport", label: "No value" }] }] }),
            /fixes every field/,
        );
        assert.throws(
            () =>
                entry({ add: [{ ...broker, fields: [{ kind: "text", path: "auth.email", value: "x", label: "X" }] }] }),
            /signIn or transport/,
        );
        assert.throws(
            () =>
                entry({
                    add: [
                        {
                            id: "own-sign-in",
                            label: "Own sign-in",
                            fields: [{ kind: "text", path: "auth.signIn", label: "X", value: "acme-sso" }],
                        },
                        {
                            id: "own-sign-in-2",
                            label: "Own sign-in 2",
                            fields: [{ kind: "text", path: "auth.signIn", label: "X", value: "acme-sso" }],
                        },
                    ],
                }),
            /same required paths/,
        );
    });
});

describe("registration ownership and order", () => {
    test("a section is registered once, with its methods", async () => {
        const { start } = await import("./support/harness.ts");
        const h = await start({ ui: false });
        try {
            withJig((api) => api.config.registerSection("jira", () => [], { methods }));
            assert.throws(
                () => withJig((api) => api.config.registerSection("jira", () => [])),
                /already registered by another plugin/,
            );
        } finally {
            await h.shutdown();
        }
    });

    test("a default that is hidden is refused, and setup falls back to the first visible method", async () => {
        assert.throws(() => entry({ default: "transport", hide: ["transport"] }), /cannot also be hidden/);
    });

    test("company choices are checked when the entry arrives after the methods", async () => {
        const { start } = await import("./support/harness.ts");
        const h = await start({ ui: false });
        try {
            withJig((api) => api.config.registerSection("jira", () => [], { methods }));
            assert.throws(
                () => withJig((api) => api.onboarding?.register({ items: [], methods: { jira: { default: "nope" } } })),
                /not a method of this section/,
            );
            withJig((api) => api.onboarding?.register({ items: [], methods: { jira: { default: "transport" } } }));
        } finally {
            await h.shutdown();
        }
    });

    test("company choices are checked when the methods arrive after the entry", async () => {
        const { start } = await import("./support/harness.ts");
        const h = await start({ ui: false });
        try {
            withJig((api) => api.onboarding?.register({ items: [], methods: { jira: { default: "nope" } } }));
            assert.throws(
                () => withJig((api) => api.config.registerSection("jira", () => [], { methods })),
                /company onboarding:.*not a method of this section/,
            );
            // The methods stay registered, so a valid company entry now works.
            withJig((api) => api.onboarding?.register({ items: [], methods: { jira: { default: "transport" } } }));
        } finally {
            await h.shutdown();
        }
    });
});

test("the method in use is inferred by the most specific required path set", () => {
    const narrow = {
        id: "data-center",
        label: "Data Center",
        fields: [{ kind: "reference" as const, path: "auth.token", label: "Token" }],
    };
    const wide = {
        id: "cloud",
        label: "Cloud",
        fields: [
            { kind: "text" as const, path: "auth.email", label: "Email" },
            { kind: "reference" as const, path: "auth.token", label: "Token" },
        ],
    };
    assert.equal(inferredMethod([narrow, wide], { auth: { token: "pass:t" } })?.id, "data-center");
    assert.equal(inferredMethod([narrow, wide], { auth: { email: "e", token: "pass:t" } })?.id, "cloud");
    assert.equal(
        inferredMethod([narrow, wide, { ...wide, id: "cloud-2" }], { auth: { email: "e", token: "pass:t" } }),
        undefined,
    );
});

test("a bad company entry names the company and keeps the plugin's methods", async () => {
    const { start } = await import("./support/harness.ts");
    const h = await start({ ui: false });
    try {
        withJig((api) => api.config.registerSection("jira", () => [], { methods }));
        assert.throws(
            () =>
                withJig((api) => {
                    const company = api.profiles?.register("acme", { displayName: "Acme" });
                    company?.onboarding?.register({ items: [], methods: { jira: { default: "nope" } } });
                }),
            /company acme onboarding:.*not a method of this section/,
        );
        // The failed company entry did not remove the plugin's methods.
        withJig((api) => {
            const company = api.profiles?.register("acme", { displayName: "Acme" });
            company?.onboarding?.register({ items: [], methods: { jira: { default: "transport" } } });
        });
    } finally {
        await h.shutdown();
    }
});

test("a refused registration writes nothing, and a no-method section is refused", () => {
    const state = createState(fakePi().pi);
    const api = buildApi(state);
    api.onboarding?.register({ items: [], methods: { jira: { default: "nope" } } });
    assert.throws(
        () => api.config.registerSection("jira", () => [], { methods }),
        /company onboarding:.*not a method of this section/,
    );
    assert.equal(state.sectionChecks.has("jira"), false);
    assert.equal(state.onboardingMethods.has("jira"), false);
    api.onboarding?.register({ items: [], methods: { jira: { default: "transport" } } });
    api.config.registerSection("jira", () => [], { methods });
    assert.equal(state.sectionChecks.has("jira"), true);
    api.config.registerSection("other", () => []);
    assert.throws(
        () => api.onboarding?.register({ items: [], methods: { other: { default: "x" } } }),
        /section "other" has no methods/,
    );
});

test("a reload-style second load keeps the same validator and replaces its methods", () => {
    const state = createState(fakePi().pi);
    const api = buildApi(state);
    const check = () => [];
    api.config.registerSection("jira", check, { methods });
    api.config.registerSection("jira", check, { methods });
    assert.equal(state.sectionChecks.get("jira"), check);
    assert.deepEqual(
        state.onboardingMethods.get("jira")?.map((method) => method.id),
        ["token", "transport"],
    );
    assert.throws(
        () => api.config.registerSection("jira", () => [], { methods }),
        /already registered by another plugin/,
    );
});
