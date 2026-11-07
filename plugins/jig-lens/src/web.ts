// `/lens web`: a small page over the index, served by this Pi session on 127.0.0.1, so nobody needs Grafana to see the
// figures as charts and tables. It lives as long as the session: `session_shutdown` stops it.
//
// Who may use it. The agent's shell shares this machine's network, and the records may hold what the sandbox hides
// from the agent, so being on 127.0.0.1 is not enough. A request is served only with:
//   - the right Host (`127.0.0.1:<port>` or `localhost:<port>`), so a page on another name cannot reach it by DNS
//     rebinding;
//   - the cookie that the link given to the user sets once (the link carries a secret, swapped for an HttpOnly cookie
//     and then dropped from the address);
//   - the method GET or HEAD: nothing here writes, and the index is opened read only for each request.
// The page runs only the queries in web-queries.ts. No request can send SQL.
import { randomBytes, timingSafeEqual } from "node:crypto";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import type { IncomingMessage, Server, ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { fileURLToPath } from "node:url";
import { themeBootScript, themeChoice, themeControlScript, themeCss } from "../../jig-core/src/kit/theme.ts";
import type { ThemeChoice } from "../../jig-core/src/kit/theme.ts";
import { MAX_DAYS } from "./command.ts";
import { lastDays } from "./period.ts";
import type { Scope } from "./queries.ts";
import { readCallDetail } from "./session-file.ts";
import { readIndex } from "./store.ts";
import type { ModelNames } from "./usage-history.ts";
import { modelLabel } from "./usage-names.ts";
import {
    daysOf,
    lanesOf,
    loopsOf,
    nameModels,
    refusedOf,
    sessionsOf,
    ticketSessionsOf,
    ticketsOf,
    timelineOf,
    toolTableOf,
    totalsOf,
    yourTimeOf,
} from "./web-queries.ts";

/** The page: one file, with its styles and script inside. Read once, when the first server starts. */
const PAGE_FILE = fileURLToPath(new URL("../web/index.html", import.meta.url));

/** Where the script's nonce goes in the page. */
const NONCE_MARK = "__NONCE__";

/** What the server needs: the index to read, and the clock that says what today is. */
export interface WebSource {
    index(): string;
    now(): Date;
    /** The names other plugins gave the models (as for `/lens usage`). Without it, ids are shortened. */
    names?: ModelNames;
    /** Pi's sessions folder, for one call's arguments and result. Without it, the page says it does not know it. */
    sessionsDir?: () => string;
    /** The configured page theme. System when absent. */
    theme?: () => ThemeChoice;
}

/** An answer to a request: a status and a JSON body. */
interface Answer {
    status: number;
    body: unknown;
}

const json = (body: unknown, status = 200): Answer => ({ status, body });

/** `days` from the query, from 1 to 90; 1 when it is missing or wrong. */
function daysParam(query: URLSearchParams): number {
    const value = query.get("days") ?? "";
    const days = /^\d+$/.test(value) ? Number(value) : 1;
    return days >= 1 && days <= MAX_DAYS ? days : 1;
}

/** The JSON endpoints, by path. Each reads the index read only; no index yet is `{ empty: true }`. */
export function answer(source: WebSource, path: string, query: URLSearchParams): Answer {
    const read = <T>(ask: (db: Parameters<Parameters<typeof readIndex>[1]>[0]) => T): Answer => {
        const result = readIndex(source.index(), ask);
        return result === undefined ? json({ empty: true }) : json(result);
    };
    const range = () => {
        const days = daysParam(query);
        const { from, to, first, last } = lastDays(source.now(), days);
        const scope: Scope = { kind: "period", from, to };
        return { days, from, to, first, last, scope };
    };
    switch (path) {
        case "/api/overview": {
            const { scope, ...period } = range();
            return read((db) => ({
                range: period,
                totals: totalsOf(db, scope),
                perDay: daysOf(db, period.from, period.to),
                sessions: sessionsOf(db, scope),
                tickets: ticketsOf(db, scope),
            }));
        }
        case "/api/tickets": {
            const { scope, ...period } = range();
            return read((db) => ({ range: period, tickets: ticketsOf(db, scope) }));
        }
        case "/api/ticket": {
            const key = query.get("key") ?? "";
            if (key === "") return json({ error: "Name a ticket: ?key=PROJ-123" }, 400);
            const scope: Scope = { kind: "ticket", ticket: key };
            return read((db) => ({ ticket: key, totals: totalsOf(db, scope), sessions: ticketSessionsOf(db, key) }));
        }
        case "/api/session": {
            const id = query.get("id") ?? "";
            if (id === "") return json({ error: "Name a session: ?id=..." }, 400);
            return read((db) => ({
                totals: totalsOf(db, { kind: "session", session: id }),
                timeline: (() => {
                    const timeline = timelineOf(db, id);
                    return timeline === undefined
                        ? null
                        : nameModels(timeline, (model) => modelLabel(model, source.names));
                })(),
                lanes: (() => {
                    const timeline = timelineOf(db, id);
                    return timeline === undefined ? null : lanesOf(timeline);
                })(),
            }));
        }
        case "/api/call": {
            const id = query.get("id") ?? "";
            const call = query.get("call") ?? "";
            if (id === "" || call === "") return json({ error: "Name a session and a call: ?id=...&call=..." }, 400);
            return json(readCallDetail(source.sessionsDir?.(), id, call));
        }
        case "/api/tools": {
            const { scope, ...period } = range();
            return read((db) => ({
                range: period,
                tools: toolTableOf(db, scope),
                refused: refusedOf(db, scope) ?? null,
                loops: loopsOf(db, scope),
            }));
        }
        case "/api/time": {
            const { scope, ...period } = range();
            return read((db) => ({ range: period, time: yourTimeOf(db, scope) ?? null }));
        }
        default:
            return json({ error: "Not found" }, 404);
    }
}

/**
 * Sent with every response. The page may load nothing from anywhere, run only its own script (by nonce), and talk
 * only to this server; the rest keep a browser from guessing a type, caching what is private, or sending the link on.
 */
function securityHeaders(nonce: string): Record<string, string> {
    return {
        "Content-Security-Policy":
            `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline'; connect-src 'self'; ` +
            "img-src data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
        "X-Content-Type-Options": "nosniff",
        "Referrer-Policy": "no-referrer",
        "Cache-Control": "no-store",
    };
}

function sameSecret(given: string | undefined, secret: string): boolean {
    if (given === undefined) return false;
    const a = Buffer.from(given);
    const b = Buffer.from(secret);
    return a.length === b.length && timingSafeEqual(a, b);
}

function readCookie(header: string | undefined, name: string): string | undefined {
    for (const part of (header ?? "").split(";")) {
        const [key, ...value] = part.trim().split("=");
        if (key === name) return value.join("=");
    }
    return undefined;
}

/** A response, before the security headers are added. */
interface Reply {
    status: number;
    type: string;
    body: string;
    headers: Record<string, string>;
}

const plain = (status: number, body: string): Reply => ({
    status,
    type: "text/plain; charset=utf-8",
    body,
    headers: {},
});

/** The page server of one Pi session. `start` is safe to call again: a running server is reused. */
export class LensWeb {
    private server: Server | undefined;
    private port = 0;
    private readonly secret = randomBytes(24).toString("base64url");
    private page: string | undefined;
    private readonly source: WebSource;

    constructor(source: WebSource) {
        this.source = source;
    }

    /** The cookie's name has the port in it: cookies do not tell ports apart, and two sessions may each have a page. */
    private get cookie(): string {
        return `jig_lens_${this.port}`;
    }

    /** Whether the server is listening. */
    get running(): boolean {
        return this.server !== undefined;
    }

    /** `http://127.0.0.1:<port>`, or undefined when it is not running. */
    get url(): string | undefined {
        return this.server === undefined ? undefined : `http://127.0.0.1:${this.port}`;
    }

    /** The address to open: it carries the secret once, which the server swaps for a cookie. */
    get link(): string | undefined {
        const url = this.url;
        return url === undefined ? undefined : `${url}/?k=${this.secret}`;
    }

    /** Starts the server on a free port of 127.0.0.1, or reuses the one that runs. Says whether it was already running. */
    async start(): Promise<{ reused: boolean }> {
        if (this.server !== undefined) return { reused: true };
        this.page ??= readFileSync(PAGE_FILE, "utf8");
        const server = createServer((request, response) => this.handle(request, response));
        await new Promise<void>((resolve, reject) => {
            server.once("error", reject);
            server.listen({ host: "127.0.0.1", port: 0 }, () => {
                server.off("error", reject);
                resolve();
            });
        });
        this.port = (server.address() as AddressInfo).port;
        this.server = server;
        return { reused: false };
    }

    /** Stops the server and closes its connections; resolves once the port is closed. Safe when it is not running. */
    stop(): Promise<void> {
        const server = this.server;
        this.server = undefined;
        if (server === undefined) return Promise.resolve();
        const closed = new Promise<void>((resolve) => server.close(() => resolve()));
        server.closeAllConnections();
        return closed;
    }

    private handle(request: IncomingMessage, response: ServerResponse): void {
        const nonce = randomBytes(16).toString("base64");
        const reply = this.reply(request, nonce);
        response.writeHead(reply.status, {
            ...securityHeaders(nonce),
            "Content-Type": reply.type,
            ...reply.headers,
        });
        response.end(request.method === "HEAD" ? undefined : reply.body);
    }

    /** What to answer a request with. Every check comes before anything is read. */
    private reply(request: IncomingMessage, nonce: string): Reply {
        const hosts = [`127.0.0.1:${this.port}`, `localhost:${this.port}`];
        if (!hosts.includes(request.headers.host ?? "")) return plain(403, "Forbidden");
        if (request.method !== "GET" && request.method !== "HEAD") return plain(405, "This page only reads.");

        const url = new URL(request.url ?? "/", `http://127.0.0.1:${this.port}`);
        const key = url.searchParams.get("k");
        if (key !== null) {
            if (!sameSecret(key, this.secret)) return plain(403, "This link has expired: run /lens web in Pi again.");
            // Lax, because Strict is not sent on the first visit, opened from outside the browser.
            return {
                ...plain(302, ""),
                headers: {
                    "Set-Cookie": `${this.cookie}=${this.secret}; HttpOnly; SameSite=Lax; Path=/`,
                    Location: "/",
                },
            };
        }
        if (!sameSecret(readCookie(request.headers.cookie, this.cookie), this.secret)) {
            return plain(403, "Open the page from the link /lens web gave you.");
        }

        if (url.pathname === "/") {
            const theme = themeChoice(this.source.theme?.());
            const page = (this.page ?? "")
                .replaceAll(NONCE_MARK, nonce)
                .replace("/*__JIG_THEME_CSS__*/", themeCss())
                .replace("__JIG_THEME_SCRIPTS__", themeBootScript(theme) + themeControlScript());
            return { status: 200, type: "text/html; charset=utf-8", body: page, headers: {} };
        }
        if (!url.pathname.startsWith("/api/")) return plain(404, "Not found");
        let result: Answer;
        try {
            result = answer(this.source, url.pathname, url.searchParams);
        } catch (error) {
            result = json({ error: `The index could not be read: ${(error as Error).message}` }, 500);
        }
        return {
            status: result.status,
            type: "application/json; charset=utf-8",
            body: JSON.stringify(result.body),
            headers: {},
        };
    }
}
