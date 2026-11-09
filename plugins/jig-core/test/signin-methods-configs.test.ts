// Every method a plugin declares must write a section its own validator accepts. The sample values are neutral; no
// method id is part of the section.
import assert from "node:assert/strict";
import { test } from "node:test";
import { validateApi } from "../../jig-api/src/config.ts";
import { API_METHODS } from "../../jig-api/src/index.ts";
import { validateJira } from "../../jig-jira/src/config.ts";
import { JIRA_METHODS } from "../../jig-jira/src/index.ts";
import { validateLogsSection } from "../../jig-logs/src/config.ts";
import { LOGS_METHODS } from "../../jig-logs/src/index.ts";
import { validateOps } from "../../jig-ops/src/catalog.ts";
import { OPS_METHODS } from "../../jig-ops/src/index.ts";
import type { OnboardingMethod } from "../src/contract.ts";

function put(target: Record<string, unknown>, path: string, value: unknown): void {
    const parts = path.split(".");
    let at = target;
    for (const part of parts.slice(0, -1)) {
        if (typeof at[part] !== "object" || at[part] === null) at[part] = {};
        at = at[part] as Record<string, unknown>;
    }
    at[parts.at(-1) ?? path] = value;
}

const values: Record<string, string> = {
    "auth.email": "dev@example.com",
    "auth.token": "pass:jira/token",
    "auth.oauth": "cmd:jira-oauth",
    "auth.cloudId": "acme",
    "auth.signIn": "acme-sso",
    "auth.transport": "acme-broker",
    "backend.auth.username": "reader",
    "backend.auth.password": "pass:logs/reader",
    "backend.auth.apiKey": "pass:logs/key",
    "backend.auth.token": "pass:logs/token",
    "backend.transport": "acme-broker",
    "environments.*.environment": "staging",
    "environments.*.signIn": "acme-sso",
    "environments.*.transport": "acme-broker",
    "services.*.ci.auth.token": "pass:ci/token",
    "services.*.ci.auth.user": "ci-bot",
    "services.*.ci.auth.signIn": "acme-sso",
    "services.*.ci.auth.transport": "acme-broker",
};

function write(method: OnboardingMethod, section: Record<string, unknown>, wildcard: string): void {
    for (const field of method.fields) {
        const path = field.path.replaceAll("*", wildcard);
        put(section, path, field.kind === "reference" ? values[field.path] : (values[field.path] ?? "value"));
    }
}

test("every Jira method writes a valid jira section", () => {
    for (const method of JIRA_METHODS) {
        const section: Record<string, unknown> = { site: "https://example.atlassian.net" };
        write(method, section, "x");
        assert.deepEqual(validateJira(section), [], method.id);
    }
});

test("every logs method writes a valid logs section", () => {
    for (const method of LOGS_METHODS) {
        const section: Record<string, unknown> = {
            backend: { type: "elasticsearch", url: "https://logs.example.com" },
            environments: { staging: { index: "logs-*" } },
        };
        write(method, section, "x");
        assert.deepEqual(validateLogsSection(section), [], method.id);
    }
});

test("every API method writes a valid api section with its environment", () => {
    for (const method of API_METHODS) {
        const section: Record<string, unknown> = { collections: { orders: { http: "/work/orders" } } };
        write(method, section, "staging");
        assert.deepEqual(validateApi(section), [], method.id);
    }
});

test("every ops method writes a valid ops section for its CI system", () => {
    const systems: Record<string, Record<string, unknown>> = {
        "ci-token": { system: "gitlab", url: "https://gitlab.example.com", project: "acme/orders-api" },
        "ci-basic": { system: "jenkins", url: "https://jenkins.example.com", job: "orders/build" },
        "ci-sign-in": {
            system: "concourse",
            url: "https://ci.example.com",
            team: "main",
            pipeline: "deploy",
            job: "orders",
        },
        "ci-transport": {
            system: "concourse",
            url: "https://ci.example.com",
            team: "main",
            pipeline: "deploy",
            job: "orders",
        },
    };
    for (const method of OPS_METHODS) {
        const section: Record<string, unknown> = {
            services: {
                "orders-api": { ci: systems[method.id] ?? {}, environments: { staging: { health: "https://x" } } },
            },
        };
        write(method, section, "orders-api");
        assert.deepEqual(validateOps(section), [], method.id);
    }
});
