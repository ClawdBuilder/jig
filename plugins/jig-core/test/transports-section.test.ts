// The `transports` section: a relay configured in jig.json, its company defaults, the URL rule and the name clash.
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, test } from "node:test";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { buildApi } from "../src/api.ts";
import { describeProblem } from "../src/config.ts";
import { createState, loadPersonalConfig } from "../src/state.ts";
import { validateTransportsSection } from "../src/transports-section.ts";
import { isTransportRefusal } from "../src/kit/http-error.ts";
import type { Transport } from "../src/contract.ts";

const RELAY: Transport = { request: async () => ({ status: 200, headers: {}, body: "{}" }) };
let dir: string;
let counter = 0;
beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "jig-transports-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function stateWith(personal: unknown) {
    const file = path.join(dir, `jig-${counter++}.json`);
    writeFileSync(file, JSON.stringify(personal));
    const state = createState({} as ExtensionAPI);
    const api = buildApi(state);
    return { state, api, file, load: () => loadPersonalConfig(state, file) };
}

const COMPANY = {
    kind: "relay",
    url: "https://relay.example.com",
    services: { jira: "tickets", logs: "logs" },
    fields: { tenant: "orders" },
};

describe("the relays section", () => {
    test("a company gives the relay, the person gives the token", () => {
        const { api, load, state } = stateWith({
            transports: { acme: { token: "env:RELAY_TOKEN", services: { jira: "other" }, client: "person" } },
        });
        api.config.addSectionDefaults("transports", { acme: COMPANY });
        load();
        assert.deepEqual(state.policy().problems, []);
        assert.deepEqual(api.config.section("transports"), {
            acme: {
                ...COMPANY,
                client: "person",
                token: "env:RELAY_TOKEN",
                services: { jira: "other", logs: "logs" },
            },
        });
    });

    test("a relative file token is refused, and a company cannot register the section", () => {
        assert.match(
            validateTransportsSection({ acme: { ...COMPANY, token: "file:relative/token" } })[0] ?? "",
            /file: must name an absolute path/,
        );
        const { api } = stateWith({});
        assert.throws(
            () => api.config.registerSection("transports", () => []) as unknown,
            /transports.*jig-core's section/,
        );
    });

    test("a plain-http relay is only this machine; path, query, user name and password are refused", () => {
        const good = (url: string) => validateTransportsSection({ acme: { ...COMPANY, url } });
        assert.deepEqual(good("http://127.0.0.1:8700"), []);
        assert.deepEqual(good("http://localhost:8700/"), []);
        assert.deepEqual(good("http://[::1]:8700"), []);
        assert.deepEqual(good("https://relay.example.com"), []);
        for (const url of [
            "http://relay.example.com",
            "https://relay.example.com/path",
            "https://relay.example.com?x=1",
            "https://relay.example.com#x",
            "https://user:pass@relay.example.com",
        ]) {
            assert.match(good(url)[0] ?? "", /transports\.acme\.url/);
        }
    });

    test("client, token, services and fields are checked, and a protocol field cannot be fixed", () => {
        const errors = validateTransportsSection({
            acme: {
                ...COMPANY,
                client: "a".repeat(65),
                token: "a-pasted-token",
                services: { jira: "" },
                fields: { protocol: 2, body: "x", tenant: {} },
            },
        });
        assert.ok(errors.some((error) => error.startsWith("transports.acme.client:")));
        assert.ok(errors.some((error) => error.startsWith("transports.acme.token:")));
        assert.ok(errors.some((error) => error.startsWith("transports.acme.services:")));
        assert.ok(errors.some((error) => error.includes("cannot set protocol")));
        assert.ok(errors.some((error) => error.includes("cannot set body")));
    });

    test("a file token's path is secret to Jig's file tools", () => {
        const tokenFile = path.join(dir, "relay-token");
        const { load, state } = stateWith({
            transports: { acme: { ...COMPANY, token: `file:${tokenFile}` } },
        });
        load();
        assert.ok(
            state.policy().protectedPaths.some((entry) => entry.path === tokenFile && entry.kind === "secret"),
            "the token file is a secret path",
        );
    });

    test("the protected file token follows a reload, changed or removed", () => {
        const { load, state, file } = stateWith({ transports: { acme: { ...COMPANY, token: "file:/tmp/relay-one" } } });
        load();
        assert.ok(state.policy().protectedPaths.some((entry) => entry.path === "/tmp/relay-one"));
        writeFileSync(file, JSON.stringify({ transports: { acme: { ...COMPANY, token: "file:/tmp/relay-two" } } }));
        load();
        assert.ok(state.policy().protectedPaths.some((entry) => entry.path === "/tmp/relay-two"));
        assert.equal(
            state.policy().protectedPaths.some((entry) => entry.path === "/tmp/relay-one"),
            false,
        );
        writeFileSync(file, JSON.stringify({ transports: { acme: { ...COMPANY, token: "env:RELAY_TOKEN" } } }));
        load();
        assert.equal(
            state.policy().protectedPaths.some((entry) => entry.path === "/tmp/relay-two"),
            false,
        );
    });

    test("a clashing name is unusable in both orders, and the other relay keeps working", async () => {
        const first = stateWith({
            transports: { acme: COMPANY, other: { ...COMPANY, url: "https://other.example.com" } },
        });
        first.load();
        first.api.transports.register("acme", RELAY);
        let refused: unknown;
        try {
            await first.api.transports.request("acme", {
                system: "jira",
                method: "GET",
                url: "https://jira.example.com/",
                headers: {},
                maxBytes: 1024,
                timeoutMs: 1000,
            });
        } catch (error) {
            refused = error;
        }
        assert.ok(isTransportRefusal(refused));
        assert.match(refused.message, /transports\.acme|declared in transports/);
        assert.ok(
            first.state
                .policy()
                .problems.some(
                    (problem) =>
                        problem.key === "transports.acme" && describeProblem(problem).includes("one of them must go"),
                ),
        );
        first.api.transports.register("other", RELAY);
        const section = first.api.config.section("transports") as Record<string, unknown>;
        assert.ok(section.other !== undefined, "the other relay is still declared");

        const second = stateWith({ transports: { acme: COMPANY } });
        second.api.transports.register("acme", RELAY);
        second.load();
        assert.equal(
            second.api.config.section("transports") !== undefined,
            true,
            "one clash does not delete the section",
        );
        assert.ok(second.state.relayClashes.has("acme"));
    });

    test("a reload keeps a clash and leaves a second relay alone", () => {
        const { state, api, file, load } = stateWith({ transports: { acme: COMPANY } });
        api.transports.register("acme", RELAY);
        load();
        assert.ok(state.relayClashes.has("acme"));
        writeFileSync(
            file,
            JSON.stringify({ transports: { acme: COMPANY, other: { ...COMPANY, url: "https://other.example.com" } } }),
        );
        load();
        assert.ok(state.relayClashes.has("acme"));
        assert.equal(state.personal.problems.filter((problem) => problem.key === "transports.acme").length, 1);
        assert.ok(api.config.section("transports") !== undefined);
    });
});

describe("the protocol fixtures", () => {
    test("the examples a relay's tests copy have one protocol and match their requests", () => {
        const file = fileURLToPath(new URL("../../../docs/relay-protocol/fixtures.json", import.meta.url));
        const fixtures = JSON.parse(readFileSync(file, "utf8")) as {
            protocol: number;
            health: { answer: { protocol: number } };
            cases: Array<{ name: string; request: { id: string; protocol: number }; answer: unknown }>;
            healthErrors: Array<{ name: string; answer: unknown }>;
        };
        assert.equal(fixtures.protocol, 1);
        assert.equal(fixtures.health.answer.protocol, 1);
        assert.deepEqual(
            fixtures.cases.map((entry) => entry.name),
            [
                "response",
                "refused:SIGN_IN_REQUIRED",
                "refused:SERVICE_OFF",
                "refused:PAUSED",
                "refused:BUSY",
                "refused:OUTSIDE_LIMITS",
                "refused:INVALID_REQUEST",
                "unknown",
                "refused:OUTSIDE_LIMITS:redirected-read",
                "unknown:REDIRECTED",
                "refused:REQUEST_TOO_LARGE",
                "unauthorized",
                "malformed",
            ],
        );
        for (const entry of fixtures.cases) {
            assert.equal(entry.request.protocol, 1);
            if (typeof entry.answer !== "string") {
                const answer = entry.answer as { id?: string; protocol?: number; status?: number };
                if (answer.status === 200) assert.equal(answer.id, entry.request.id, entry.name);
                if (answer.id !== undefined && answer.id !== null)
                    assert.equal(answer.id, entry.request.id, entry.name);
                assert.equal(answer.protocol, 1, entry.name);
            }
        }
        assert.equal(fixtures.healthErrors[0]?.name, "unknown protocol");
    });
});
