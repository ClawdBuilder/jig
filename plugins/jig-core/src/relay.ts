// A relay transport: sends a tool's request to a relay as JSON (docs/relay-protocol.md), reads one of its three answers,
// and turns a refusal into a TransportRefusal. The relay holds the session; Jig holds only its own token.
import { randomUUID } from "node:crypto";
import type { TransportRequest, TransportResponse } from "./contract.ts";
import { TransportRefusal } from "./kit/http-error.ts";
import { printable } from "./kit/text.ts";
import type { RelayTransportConfig } from "./transports-section.ts";

export const RELAY_PROTOCOL = 1;
const MAX_RELAY_BYTES = 16 * 1024 * 1024;
const MAX_RELAY_TIMEOUT_MS = 120_000;
const MIN_RELAY_TIMEOUT_MS = 1_000;
const CODE = /^[A-Z][A-Z0-9_]{0,63}$/;
const HEADERS = new Set(["accept", "content-type"]);

/** What a relay transport needs: the token, and a `fetch` a test can replace. */
export interface RelayDeps {
    resolve(ref: string, signal?: AbortSignal): Promise<string>;
    fetch?: typeof fetch;
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

function text(value: unknown): string {
    return typeof value === "string" ? value : "";
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
    const message = text(answer.message);
    if (outcome === "refused")
        throw new TransportRefusal(code, message || "the relay refused the request", true, requestId);
    if (outcome === "unknown")
        throw new TransportRefusal(code, message || "the relay does not know whether it was sent", false, requestId);
    throw badAnswer("the relay's outcome is not response, refused or unknown", requestId);
}

/** Sends one request through a relay. Never retries. */
export async function relayRequest(
    name: string,
    config: RelayTransportConfig,
    request: TransportRequest,
    deps: RelayDeps,
    signal?: AbortSignal,
): Promise<TransportResponse> {
    const service =
        config.services[request.system] ?? (Object.keys(config.services).length === 0 ? request.system : undefined);
    if (service === undefined) {
        throw new TransportRefusal(
            "INVALID_REQUEST",
            `transports.${name}.services has no entry for ${printable(request.system)}`,
            true,
        );
    }
    if (config.token === undefined) {
        throw new TransportRefusal(
            "SIGN_IN_REQUIRED",
            `transports.${name}.token is not set; add a secret reference for the relay token`,
            true,
        );
    }
    let token: string;
    try {
        token = await deps.resolve(config.token, signal);
    } catch (error) {
        const why = error instanceof Error ? error.message : String(error);
        throw new TransportRefusal("SIGN_IN_REQUIRED", `transports.${name}.token: ${why}`, true);
    }
    const id = randomUUID();
    const headers: Record<string, string> = {};
    for (const [header, value] of Object.entries(request.headers ?? {})) {
        if (HEADERS.has(header.toLowerCase())) headers[header.toLowerCase()] = value;
    }
    if (request.body !== undefined) headers["content-type"] = headers["content-type"] ?? "application/json";
    const maxBytes = Math.min(request.maxBytes + 1, MAX_RELAY_BYTES);
    const timeoutMs = Math.min(Math.max(request.timeoutMs, MIN_RELAY_TIMEOUT_MS), MAX_RELAY_TIMEOUT_MS);
    const body: RelayBody = {
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
        ...config.fields,
    };
    const send = deps.fetch ?? fetch;
    let reply: Response;
    try {
        reply = await send(`${config.url.replace(/\/$/, "")}/v1/request`, {
            method: "POST",
            headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
            body: JSON.stringify(body),
            redirect: "manual",
            ...(signal === undefined ? {} : { signal }),
        });
    } catch (error) {
        throw new TransportRefusal(
            "UNREACHABLE",
            `the relay at ${config.url} could not be reached: ${error instanceof Error ? error.message : String(error)}`,
            false,
        );
    }
    let textBody: string;
    try {
        textBody = await reply.text();
    } catch (error) {
        throw badAnswer(
            `the relay's answer could not be read: ${error instanceof Error ? error.message : String(error)}`,
            id,
        );
    }
    let value: unknown;
    try {
        value = JSON.parse(textBody);
    } catch {
        throw badAnswer("the relay's answer is not JSON", id);
    }
    if (reply.status !== 200) {
        if (typeof value === "object" && value !== null) {
            const answer = value as Record<string, unknown>;
            if (answer.outcome === "refused") {
                throw new TransportRefusal(
                    codeOf(answer.code),
                    text(answer.message) || "the relay refused the request",
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
    const headers: Record<string, string> = { accept: "application/json" };
    if (options.token === true) {
        if (config.token === undefined) {
            return { protocol: 0, service: "", tokenError: `transports.${name}.token is not set` };
        }
        try {
            headers.authorization = `Bearer ${await deps.resolve(config.token, options.signal)}`;
        } catch (error) {
            return {
                protocol: 0,
                service: "",
                tokenError: `transports.${name}.token: ${error instanceof Error ? error.message : String(error)}`,
            };
        }
    }
    const send = deps.fetch ?? fetch;
    const reply = await send(`${config.url.replace(/\/$/, "")}/v1/health`, {
        headers,
        redirect: "manual",
        ...(options.signal === undefined ? {} : { signal: options.signal }),
    });
    const body = (await reply.json().catch(() => undefined)) as Record<string, unknown> | undefined;
    if (body === undefined) throw new Error(`the relay at ${config.url} did not answer with JSON`);
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
