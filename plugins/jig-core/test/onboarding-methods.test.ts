// Sign-in methods: the plugin owns their fields and shapes, and the company may only choose among the ids or add a
// fixed sign-in/transport method. Two methods of one section must differ in shape, so no method id is written anywhere.
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { OnboardingEntry, OnboardingMethod } from "../src/contract.ts";
import { checkOnboarding, checkOnboardingMethods } from "../src/onboarding.ts";

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
            /same shape/,
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
            id: "broker",
            label: "Company broker",
            who: "this company",
            fields: [{ kind: "text", path: "auth.transport", value: "acme-broker", label: "The broker" }],
        };
        assert.deepEqual(entry({ add: [broker] }).methods?.jira?.add?.[0]?.fields[0]?.path, "auth.transport");

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
                        broker,
                        {
                            ...broker,
                            id: "broker-2",
                            fields: [{ kind: "text", path: "auth.transport", label: "X", value: "acme-broker" }],
                        },
                    ],
                }),
            /same shape/,
        );
    });
});
