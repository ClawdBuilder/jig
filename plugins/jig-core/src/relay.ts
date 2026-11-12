// A relay transport: sends a tool's request to a relay as JSON (docs/relay-protocol.md), reads one of its three answers,
// and turns a refusal into a TransportRefusal. The relay holds the session; Jig holds only its own token. Every HTTP call
// goes through jig-core's client, so limits, redirects, aborts and the redactor behave as they do for every request.
import { randomUUID } from "node:crypto";
import type { HttpRequest, HttpResponse, TransportRequest, TransportResponse } from "./contract.ts";
import { isHttpError, TransportRefusal } from "./kit/http-error.ts";
import { printable } from "./kit/text.ts";
import type { RelayTransportConfig } from "./transports-section.ts";

export const RELAY_PROTOCOL = 1;
const MAX_RELAY_BYTES = 16 * 1024 * 1024;
const MAX_RELAY_TIMEOUT_MS = 120_000;
const MIN_RELAY_TIMEOUT_MS = 1_000;
const HEALTH_TIMEOUT_MS = 5_000;
const ANSWER_SLACK = 64 * 1024;
const CODE = /^[A-Z][A-Z0-9_]{0,63}$/;
const HEADERS = new Set(["accept", "content-type"]);

/** The jig-core HTTP client the relay uses; looked up at call time so a reload sees the current one. */
export interface RelayHttp {
    request(request: HttpRequest, signal?: AbortSignal): Promise<HttpResponse>;
}

export interface RelayDeps {
    http: () => RelayHttp;
}

/** A relay's request body, as the protocol names it. */
interface RelayBody {
    protocol: 1;
    id: string;
    client: string;
    service: string;
    method: TransportRequest["method"];
    url: string;
    headers: Record<string, string>;
    body?: string;
    maxBytes: number;
    timeoutMs: number;
    [field: string]: unknown;
}

function codeOf(value: unknown): string {
    return typeof value === "string" && CODE.test(value) ? value : "BAD_ANSWER";
}

function responseHeaders(value: unknown): Record<string, string | string[]> {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
        throw new TransportRefusal("BAD_ANSWER", "the relay's response headers are not an object", false);
    }
    const out: Record<string, string | string[]> = {};
    for (const [name, header] of Object.entries(value)) {
        if (typeof header === "string") out[name.toLowerCase()] = header;
        else if (Array.isArray(header) && header.every((item) => typeof item === "string")) {
            out[name.toLowerCase()] = [...header];
        } else throw new TransportRefusal("BAD_ANSWER", `the relay's header "${printable(name)}" is not text`, false);
    }
    return out;
}

function badAnswer(message: string, requestId?: string): TransportRefusal {
    return new TransportRefusal("BAD_ANSWER", message, false, requestId);
}

/** Parse one relay answer. Throws TransportRefusal for every outcome except `response`. */
function answerOf(value: unknown, requestId: string): TransportResponse {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
        throw badAnswer("the relay answered with something that is not a JSON object", requestId);
    }
    const answer = value as Record<string, unknown>;
    if (answer.protocol !== RELAY_PROTOCOL) {
        throw badAnswer(
            `the relay speaks protocol ${String(answer.protocol)}; Jig knows protocol ${RELAY_PROTOCOL}`,
            requestId,
        );
    }
    const echoed = answer.id;
    if (echoed !== undefined && echoed !== null && echoed !== requestId) {
        throw badAnswer("the relay answered a different request id", typeof echoed === "string" ? echoed : undefined);
    }
    const outcome = answer.outcome;
    if (outcome === "response") {
        const status = answer.status;
        if (typeof status !== "number" || !Number.isInteger(status) || status < 100 || status > 599) {
            throw badAnswer("the relay's response has no valid status", requestId);
        }
        if (typeof answer.body !== "string") throw badAnswer("the relay's response body is not text", requestId);
        if (typeof answer.truncated !== "boolean") {
            if (answer.truncated !== undefined)
                throw badAnswer("the relay's truncated field is not true/false", requestId);
        }
        return {
            status,
            headers: responseHeaders(answer.headers ?? {}),
            body: answer.body,
            ...(answer.truncated === true ? { truncated: true } : {}),
        };
    }
    const code = codeOf(answer.code);
    const message = typeof answer.message === "string" ? answer.message : "";
    if (outcome === "refused")
        throw new TransportRefusal(code, message || "the relay refused the request", true, requestId);
    if (outcome === "unknown") {
        throw new TransportRefusal(code, message || "the relay does not know whether it was sent", false, requestId);
    }
    throw badAnswer("the relay's outcome is not response, refused or unknown", requestId);
}

/** Why a relay's HTTP request failed, in terms a tool can act on. */
function relayFailure(name: string, config: RelayTransportConfig, error: unknown): TransportRefusal {
    if (isHttpError(error)) {
        if (error.code === "auth_failed") {
            return new TransportRefusal("RELAY_TOKEN", `transports.${name}.token: ${error.message}`, true);
        }
        if (error.notSent) {
            return new TransportRefusal(
                "RELAY_NOT_RUNNING",
                `the relay at ${config.url} is not running or not answering (${error.code})`,
                true,
            );
        }
        return new TransportRefusal("CONNECTION_LOST", error.message, false);
    }
    return new TransportRefusal("CONNECTION_LOST", error instanceof Error ? error.message : String(error), false);
}

/** Sends one request through a relay. Never retries. */
export async function relayRequest(
    name: string,
    config: RelayTransportConfig,
    request: TransportRequest,
    deps: RelayDeps,
    signal?: AbortSignal,
): Promise<TransportResponse> {
    const service = Object.hasOwn(config.services, request.system)
        ? config.services[request.system]
        : Object.keys(config.services).length === 0
          ? request.system
          : undefined;
    if (service === undefined) {
        throw new TransportRefusal(
            "INVALID_REQUEST",
            `transports.${name}.services has no entry for ${printable(request.system)}`,
            true,
        );
    }
    if (config.token === undefined) {
        throw new TransportRefusal("RELAY_TOKEN", `transports.${name}.token is not set`, true);
    }
    const id = randomUUID();
    const headers: Record<string, string> = {};
    for (const [header, value] of Object.entries(request.headers ?? {})) {
        if (HEADERS.has(header.toLowerCase())) headers[header.toLowerCase()] = value;
    }
    if (request.body !== undefined) headers["content-type"] = headers["content-type"] ?? "application/json";
    const maxBytes = Math.min(request.maxBytes + 1, MAX_RELAY_BYTES);
    const timeoutMs = Math.min(Math.max(request.timeoutMs - 2_000, MIN_RELAY_TIMEOUT_MS), MAX_RELAY_TIMEOUT_MS);
    const answerBytes = Math.min(maxBytes * 4 + ANSWER_SLACK, 64 * 1024 * 1024);
    const body: RelayBody = {
        ...config.fields,
        protocol: RELAY_PROTOCOL,
        id,
        client: config.client,
        service,
        method: request.method,
        url: request.url,
        headers,
        ...(request.body === undefined ? {} : { body: request.body }),
        maxBytes,
        timeoutMs,
    };
    let reply: HttpResponse;
    try {
        reply = await deps.http().request(
            {
                system: "relay",
                method: "POST",
                url: `${config.url.replace(/\/$/, "")}/v1/request`,
                headers: { "content-type": "application/json", accept: "application/json" },
                auth: { bearer: config.token },
                body: JSON.stringify(body),
                maxBytes: answerBytes,
                timeoutMs: request.timeoutMs,
            },
            signal,
        );
    } catch (error) {
        throw relayFailure(name, config, error);
    }
    if (reply.truncated) {
        throw new TransportRefusal("REPLY_TOO_LARGE", "the relay's answer is too large to read", false, id);
    }
    let value: unknown;
    try {
        value = JSON.parse(reply.body);
    } catch {
        throw badAnswer("the relay's answer is not JSON", id);
    }
    if (reply.status !== 200) {
        if (typeof value === "object" && value !== null) {
            const answer = value as Record<string, unknown>;
            if (answer.outcome === "refused") {
                throw new TransportRefusal(
                    codeOf(answer.code),
                    typeof answer.message === "string" ? answer.message : "the relay refused the request",
                    true,
                );
            }
        }
        throw badAnswer(`the relay answered HTTP ${reply.status} without a refused body`, id);
    }
    return answerOf(value, id);
}

/** Reads a relay's health. The token is optional; with it the relay also returns `services`. */
export async function relayHealth(
    name: string,
    config: RelayTransportConfig,
    deps: RelayDeps,
    options: { token?: boolean; signal?: AbortSignal } = {},
): Promise<{ protocol: number; service: string; services?: Record<string, boolean>; tokenError?: string }> {
    let auth: { bearer: string } | undefined;
    if (options.token === true) {
        if (config.token === undefined) {
            return { protocol: 0, service: "", tokenError: `transports.${name}.token is not set` };
        }
        auth = { bearer: config.token };
    }
    let reply: HttpResponse;
    try {
        reply = await deps.http().request(
            {
                system: "relay",
                method: "GET",
                url: `${config.url.replace(/\/$/, "")}/v1/health`,
                headers: { accept: "application/json" },
                ...(auth === undefined ? {} : { auth }),
                timeoutMs: HEALTH_TIMEOUT_MS,
                maxBytes: 64 * 1024,
            },
            options.signal,
        );
    } catch (error) {
        if (isHttpError(error) && error.code === "auth_failed") {
            return { protocol: 0, service: "", tokenError: `transports.${name}.token: ${error.message}` };
        }
        throw error;
    }
    if (reply.truncated) throw new Error("the relay's health answer is too large");
    let body: Record<string, unknown>;
    try {
        body = JSON.parse(reply.body) as Record<string, unknown>;
    } catch {
        throw new Error(`the relay at ${config.url} did not answer with JSON`);
    }
    if (typeof body !== "object" || body === null || Array.isArray(body)) {
        throw new Error(`the relay at ${config.url} did not answer with JSON`);
    }
    const protocol = typeof body.protocol === "number" ? body.protocol : 0;
    const service = typeof body.service === "string" ? body.service : "";
    if (reply.status !== 200) {
        const message = typeof body.message === "string" ? body.message : `HTTP ${reply.status}`;
        throw new Error(`the relay refused health: ${message}`);
    }
    return {
        protocol,
        service,
        ...(typeof body.services === "object" && body.services !== null
            ? { services: body.services as Record<string, boolean> }
            : {}),
    };
}
