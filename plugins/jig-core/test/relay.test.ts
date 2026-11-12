// The relay transport: every fixture in docs/relay-protocol/fixtures.json through a fake relay on 127.0.0.1.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { after, before, test } from "node:test";
import type { TransportRequest } from "../src/contract.ts";
import { isTransportRefusal } from "../src/kit/http-error.ts";
import { relayHealth, relayRequest } from "../src/relay.ts";
import type { RelayDeps } from "../src/relay.ts";
import { createHttp } from "../src/kit/http.ts";
import { buildApi } from "../src/api.ts";
import { createState, loadPersonalConfig } from "../src/state.ts";
import { relayChecks } from "../src/doctor-checks.ts";
import type { DoctorContext } from "../src/doctor.ts";
import { setupHarness, SHORT_TIMEOUTS, SITE } from "../../jig-jira/test/support/harness.ts";
import { world as logsWorld } from "../../jig-logs/test/support/world.ts";
import { searchReply } from "../../jig-logs/test/support/fake-search.ts";
import { relayOf } from "../src/transports-section.ts";

interface FixtureCase {
    name: string;
    request: Record<string, unknown> & { service: string; method: TransportRequest["method"]; url: string };
    answer: unknown;
}
const fixtures = JSON.parse(
    readFileSync(fileURLToPath(new URL("../../../docs/relay-protocol/fixtures.json", import.meta.url)), "utf8"),
) as { cases: FixtureCase[] };
const CONFIG = {
    kind: "relay" as const,
    url: "",
    token: "env:RELAY_TOKEN",
    client: "jig",
    services: { jira: "tickets", logs: "logs" },
    fields: {},
};
let server: ReturnType<typeof createServer>;
let url = "";
let seen: Array<{ body: Record<string, unknown>; headers: IncomingMessage["headers"]; raw: string }> = [];
let next: unknown;

before(async () => {
    server = createServer((request: IncomingMessage, response: ServerResponse) => {
        let raw = "";
        request.on("data", (chunk) => {
            raw += String(chunk);
        });
        request.on("end", () => {
            seen.push({ body: JSON.parse(raw || "{}"), headers: request.headers, raw });
            if (request.url === "/v1/health") {
                response.setHeader("content-type", "application/json");
                response.end(
                    JSON.stringify({ ok: true, protocol: 1, service: "orders-api relay", services: { jira: true } }),
                );
                return;
            }
            if (next === "not json") {
                response.statusCode = 200;
                response.end("not json");
                return;
            }
            const answer = next as Record<string, unknown>;
            if (typeof answer.id === "string") answer.id = JSON.parse(raw).id;
            response.statusCode =
                (answer.__httpStatus as number | undefined) ?? (answer.status as number | undefined) ?? 200;
            response.setHeader("content-type", "application/json");
            response.end(JSON.stringify(answer));
        });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (address === null || typeof address === "string") throw new Error("no server address");
    url = `http://127.0.0.1:${address.port}`;
});
after(() => new Promise<void>((resolve) => server.close(() => resolve())));

function requestFor(entry: FixtureCase): TransportRequest {
    return {
        system: entry.request.service,
        method: entry.request.method,
        url: entry.request.url,
        headers: (entry.request.headers as Record<string, string>) ?? {},
        ...(typeof entry.request.body === "string" ? { body: entry.request.body } : {}),
        maxBytes: entry.request.maxBytes as number,
        timeoutMs: entry.request.timeoutMs as number,
    };
}

function deps(resolve: (ref: string, signal?: AbortSignal) => Promise<string> = async () => "relay-token"): RelayDeps {
    const http = createHttp({
        fetch,
        secrets: { resolve },
        signIn: { headers: async () => ({}) },
        transports: {
            request: async () => {
                throw new Error("no transport in this test");
            },
        },
    });
    return { http: () => ({ request: (request, signal) => http.request(request, signal) }) };
}

function transport() {
    const config = { ...CONFIG, url, services: { jira: "tickets", logs: "logs" } };
    return {
        request: (request: TransportRequest, signal?: AbortSignal) =>
            relayRequest("orders", config, request, deps(), signal),
    };
}

test("every fixture case has the outcome and code it names", async () => {
    for (const entry of fixtures.cases) {
        seen = [];
        next = entry.answer;
        const answer =
            typeof entry.answer === "string"
                ? undefined
                : (entry.answer as { outcome?: string; code?: string; status?: number });
        try {
            const result = await transport().request(requestFor(entry));
            assert.equal(answer?.outcome, "response", entry.name);
            assert.equal(result.status, (entry.answer as { status: number }).status, entry.name);
            assert.equal(result.body, (entry.answer as { body: string }).body, entry.name);
        } catch (error) {
            assert.ok(isTransportRefusal(error), `${entry.name}: ${String(error)}`);
            assert.notEqual(answer?.outcome, "response", entry.name);
            if (answer?.outcome === "refused" || typeof entry.answer === "string" || answer?.status !== 200) {
                assert.equal(
                    error.notSent,
                    answer?.outcome !== "unknown" && typeof entry.answer !== "string",
                    entry.name,
                );
            }
            if (answer?.code !== undefined && error.code !== "BAD_ANSWER")
                assert.equal(error.code, answer.code, entry.name);
        }
        assert.equal(seen.length, 1, `${entry.name}: one relay request`);
    }
});

test("a redirect is returned, never followed", async () => {
    seen = [];
    next = {
        protocol: 1,
        id: "ignored",
        outcome: "response",
        status: 302,
        headers: { location: "https://elsewhere.example.com/" },
        body: "",
        truncated: false,
        __httpStatus: 200,
    };
    const result = await transport().request({
        system: "jira",
        method: "GET",
        url: "https://jira.example.com/rest/api/2/issue/ABC-1",
        headers: {},
        maxBytes: 1024,
        timeoutMs: 30000,
    });
    assert.equal(result.status, 302);
    assert.equal(result.headers.location, "https://elsewhere.example.com/");
    assert.equal(seen.length, 1, "the relay was asked once, and no Location was fetched");
});

test("the token is resolved for every request and never appears in the relay request headers", async () => {
    seen = [];
    next = fixtures.cases[0]?.answer;
    await transport().request(requestFor(fixtures.cases[0]!));
    assert.equal(seen[0]?.headers.authorization, "Bearer relay-token");
    assert.equal(seen[0]?.raw.includes("relay-token"), false, "the token is in the header, not the body");
    assert.equal(seen[0]?.headers["transfer-encoding"], undefined);
    assert.equal(seen[0]?.headers.origin, undefined);
    assert.match(seen[0]?.headers["content-length"] ?? "", /^\d+$/);
    assert.equal(seen[0]?.body.maxBytes, 8388609);
    assert.equal(seen[0]?.body.timeoutMs, 28000, "the relay's deadline is before Jig's");
    assert.equal(seen[0]?.body.protocol, 1);
    assert.equal(seen[0]?.body.client, "jig");
});

test("a token that cannot be read is a refusal that never reaches the relay", async () => {
    seen = [];
    const config = { ...CONFIG, url, token: "env:MISSING" };
    await assert.rejects(
        relayRequest(
            "orders",
            config,
            requestFor(fixtures.cases[0]!),
            deps(async () => {
                throw new Error('the env secret backend is not enabled; add "env" to secrets.backends');
            }),
        ),
        (error: unknown) => {
            assert.ok(isTransportRefusal(error));
            assert.equal(error.notSent, true);
            assert.match(error.message, /transports\.orders\.token/);
            return true;
        },
    );
    assert.equal(seen.length, 0);
});

test("a service not in the map is refused before sending", async () => {
    seen = [];
    const config = { ...CONFIG, url, services: { jira: "tickets" } };
    await assert.rejects(
        relayRequest(
            "orders",
            config,
            { ...requestFor(fixtures.cases[0]!), system: "logs" },
            deps(async () => "x"),
        ),
        (error: unknown) => isTransportRefusal(error) && error.notSent === true,
    );
    assert.equal(seen.length, 0);
});

test("two requests have different ids", async () => {
    seen = [];
    next = fixtures.cases[0]?.answer;
    await transport().request(requestFor(fixtures.cases[0]!));
    next = fixtures.cases[0]?.answer;
    await transport().request(requestFor(fixtures.cases[0]!));
    assert.notEqual(seen[0]?.body.id, seen[1]?.body.id);
});

test("a token whose backend is off names the token key and the backend fix", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "jig-relay-"));
    const file = path.join(dir, "jig.json");
    writeFileSync(
        file,
        JSON.stringify({
            secrets: { backends: ["pass"] },
            transports: {
                orders: {
                    kind: "relay",
                    url,
                    token: "file:/tmp/relay-token-not-read",
                    services: { jira: "tickets" },
                },
            },
        }),
    );
    const state = createState({} as never, { env: process.env });
    state.agentDir = () => dir;
    state.configPath = () => file;
    loadPersonalConfig(state, file);
    buildApi(state);
    await assert.rejects(
        state.http.request({
            system: "jira",
            method: "GET",
            url: "https://jira.example.com/",
            transport: "orders",
        }),
        (error: unknown) => {
            const message = (error as Error).message;
            assert.match(message, /transports\.orders\.token/);
            assert.match(message, /add "file" to secrets\.backends/);
            return true;
        },
    );
    rmSync(dir, { recursive: true, force: true });
});

test("health reads with and without the token, and reports the protocol", async () => {
    const health = await relayHealth("orders", { ...CONFIG, url }, deps());
    assert.equal(health.protocol, 1);
    assert.equal(health.service, "orders-api relay");
    const withToken = await relayHealth("orders", { ...CONFIG, url }, deps(), { token: true });
    assert.equal(withToken.services?.jira, true);
});

test("a missing token is RELAY_TOKEN, and a cut answer is REPLY_TOO_LARGE", async () => {
    const noToken = { ...CONFIG, url, token: undefined };
    await assert.rejects(
        relayRequest("orders", noToken, requestFor(fixtures.cases[0]!), deps()),
        (error: unknown) => isTransportRefusal(error) && error.code === "RELAY_TOKEN" && error.notSent === true,
    );
    let asked: { maxBytes?: number; timeoutMs?: number } = {};
    const cutHttp = {
        async request(request: { maxBytes?: number; timeoutMs?: number }) {
            asked = request;
            return {
                status: 200,
                headers: {},
                cookies: [],
                body: "",
                bytes: 0,
                truncated: true,
                binary: false,
            };
        },
    };
    await assert.rejects(
        relayRequest("orders", { ...CONFIG, url }, requestFor(fixtures.cases[0]!), { http: () => cutHttp }),
        (error: unknown) => isTransportRefusal(error) && error.code === "REPLY_TOO_LARGE" && error.notSent === false,
    );
    assert.equal(asked.maxBytes, 8388609 * 4 + 65536);
    assert.equal(asked.timeoutMs, 30000);
});

test("a relay that is not running is a not-sent refusal", async () => {
    // Port 1 is never served: fetch refuses it before connecting, as a browser does.
    const config = { ...CONFIG, url: "http://127.0.0.1:1" };
    await assert.rejects(relayRequest("orders", config, requestFor(fixtures.cases[0]!), deps()), (error: unknown) => {
        assert.ok(isTransportRefusal(error));
        assert.equal(error.code, "RELAY_NOT_RUNNING");
        assert.equal(error.notSent, true);
        return true;
    });
});

test("health has a five second deadline", async () => {
    const hanging = createServer(() => {
        // Accept the connection, and never answer.
    });
    await new Promise<void>((resolve) => hanging.listen(0, "127.0.0.1", resolve));
    const found = hanging.address();
    const port = typeof found === "object" && found !== null ? found.port : 0;
    const started = Date.now();
    try {
        await assert.rejects(relayHealth("orders", { ...CONFIG, url: `http://127.0.0.1:${port}` }, deps()));
        const elapsed = Date.now() - started;
        assert.ok(elapsed >= 4_500 && elapsed < 7_000, `health took ${elapsed} ms`);
    } finally {
        hanging.closeAllConnections();
        await new Promise<void>((resolve) => hanging.close(() => resolve()));
    }
});

test("a relay from jig.json is registered and reachable through jig-core's http", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "jig-relay-"));
    const file = path.join(dir, "jig.json");
    writeFileSync(
        file,
        JSON.stringify({
            secrets: { backends: ["env"] },
            transports: {
                orders: {
                    kind: "relay",
                    url,
                    token: "env:RELAY_TOKEN",
                    services: { jira: "tickets" },
                },
            },
        }),
    );
    const state = createState({} as never, {
        env: { ...process.env, RELAY_TOKEN: "relay-token" },
    });
    state.agentDir = () => dir;
    state.configPath = () => file;
    loadPersonalConfig(state, file);
    buildApi(state);
    next = fixtures.cases[0]?.answer;
    const reply = await state.http.request({
        system: "jira",
        method: "GET",
        url: "https://jira.example.com/rest/api/2/issue/ABC-1",
        transport: "orders",
    });
    assert.equal(reply.status, 200);
    assert.equal(JSON.stringify(reply).includes("relay-token"), false);
    rmSync(dir, { recursive: true, force: true });
});

test("doctor lines name the relay, its protocol and its token", async () => {
    const context = {
        sections: new Map([["transports", { orders: { ...CONFIG, url } }]]),
        relay: { http: () => deps().http() },
    } as unknown as DoctorContext;
    const lines = await relayChecks(context);
    assert.deepEqual(
        lines.map((line) => [line.id, line.level]),
        [
            ["relay.orders.health", "ok"],
            ["relay.orders.protocol", "ok"],
            ["relay.orders.token", "ok"],
        ],
    );
});

test("doctor repeats a token backend's own fix and names the token key", async () => {
    const context = {
        sections: new Map([["transports", { orders: { ...CONFIG, url } }]]),
        relay: {
            http: () =>
                deps(async () => {
                    throw new Error('the env secret backend is not enabled: add "env" to secrets.backends');
                }).http(),
        },
    } as unknown as DoctorContext;
    const lines = await relayChecks(context);
    const token = lines.find((line) => line.id === "relay.orders.token");
    assert.equal(token?.level, "fail");
    assert.match(token?.detail ?? "", /transports\.orders\.token/);
    assert.match(token?.detail ?? "", /add "env" to secrets\.backends/);
});

test("jig-jira reads through a relay transport", async () => {
    const h = await setupHarness("cloud", SHORT_TIMEOUTS);
    let refusedWrite = false;
    let relayedHeaders: Record<string, string> = {};
    const forward = createServer((request: IncomingMessage, response: ServerResponse) => {
        let raw = "";
        request.on("data", (chunk) => (raw += String(chunk)));
        request.on("end", async () => {
            const body = JSON.parse(raw) as {
                id: string;
                url: string;
                method: string;
                headers: Record<string, string>;
                body?: string;
            };
            relayedHeaders = body.headers;
            if (refusedWrite) {
                response.setHeader("content-type", "application/json");
                response.end(
                    JSON.stringify({
                        protocol: 1,
                        id: body.id,
                        outcome: "refused",
                        code: "SERVICE_OFF",
                        status: 403,
                        message: "Jira is off in the relay",
                    }),
                );
                return;
            }
            const target = new URL(body.url);
            const jiraUrl = new URL(h.jira.origin);
            const answer = await fetch(`${jiraUrl.origin}${target.pathname}${target.search}`, {
                method: body.method,
                headers: { accept: body.headers.accept ?? "application/json" },
                ...(body.body === undefined ? {} : { body: body.body }),
            });
            response.setHeader("content-type", "application/json");
            response.end(
                JSON.stringify({
                    protocol: 1,
                    id: body.id,
                    outcome: "response",
                    status: answer.status,
                    headers: { "content-type": "application/json" },
                    body: await answer.text(),
                    truncated: false,
                }),
            );
        });
    });
    await new Promise<void>((resolve) => forward.listen(0, "127.0.0.1", resolve));
    const found = forward.address();
    const port = typeof found === "object" && found !== null ? found.port : 0;
    try {
        h.configure({ site: SITE, auth: { transport: "orders" } });
        h.jig.transports.set("orders", {
            request: (request, signal) =>
                relayRequest("orders", { ...CONFIG, url: `http://127.0.0.1:${port}` }, request, deps(), signal),
        });
        const result = await h.call({ action: "get", key: "PROJ-1" });
        assert.equal(result.error, undefined);
        assert.match(result.text, /PROJ-1/);
        assert.equal(relayedHeaders.authorization, undefined, "Jira's headers are not relayed");
        assert.equal(relayedHeaders.cookie, undefined, "Jira's headers are not relayed");
        refusedWrite = true;
        const write = await h.call({ action: "comment", key: "PROJ-1", text: "hi" }, { ask: false });
        assert.match(write.error?.message ?? "", /Jira was not changed: Jira is off in the relay \(SERVICE_OFF\)/);
    } finally {
        await new Promise<void>((resolve) => forward.close(() => resolve()));
        await h.close();
    }
});

test("jig-logs searches through a relay, and reports a refusal in its own words", async (t) => {
    let answer: Record<string, unknown> = {
        protocol: 1,
        outcome: "response",
        status: 200,
        headers: { "content-type": "application/json" },
        body: JSON.stringify(searchReply().json),
        truncated: false,
    };
    const relay = createServer((request: IncomingMessage, response: ServerResponse) => {
        let raw = "";
        request.on("data", (chunk) => (raw += String(chunk)));
        request.on("end", () => {
            const body = JSON.parse(raw) as { id: string };
            response.setHeader("content-type", "application/json");
            response.end(JSON.stringify({ ...answer, id: body.id }));
        });
    });
    await new Promise<void>((resolve) => relay.listen(0, "127.0.0.1", resolve));
    const found = relay.address();
    const port = typeof found === "object" && found !== null ? found.port : 0;
    const w = await logsWorld(t, {
        backend: "transport",
        section: {
            backend: { transport: "orders", url: "https://logs.example.com" },
            environments: { staging: { index: "app-staging-*" } },
        },
    });
    try {
        w.jig.transports.set("orders", {
            request: (request, signal) =>
                relayRequest(
                    "orders",
                    { ...CONFIG, url: `http://127.0.0.1:${port}`, services: { logs: "logs" } },
                    request,
                    deps(),
                    signal,
                ),
        });
        const succeeded = await w.call({ phrase: "message", environment: "staging", window: "30m" });
        assert.equal(succeeded.error, undefined);
        answer = {
            protocol: 1,
            outcome: "refused",
            code: "SERVICE_OFF",
            status: 403,
            message: "logs are off in the relay",
        };
        const refused = await w.call({ phrase: "message", environment: "staging", window: "30m" });
        assert.match(
            refused.error?.message ?? "",
            /the log backend was not changed: logs are off in the relay \(SERVICE_OFF\)/,
        );
    } finally {
        await new Promise<void>((resolve) => relay.close(() => resolve()));
    }
});
