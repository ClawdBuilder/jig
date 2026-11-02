// The small web server behind the `o` key: it serves the preview pages jig-core wrote, to the browser on this machine.
//
// Why a server and not a file. A file address (`file:///home/...`) only works when the browser can see the same files
// as Pi. A Windows browser started from Linux under WSL cannot, so nothing opens. An address on `localhost` works
// wherever the browser can reach this machine's loopback, which is the same reason `jig-review` serves its page.
//
// What it is. It shows and never answers: it has no route that takes input, nothing in a page can reach Pi's question,
// and the answer stays a key in Pi (see docs/approvals.md). It listens on 127.0.0.1 only, on a random port, and starts
// on the first preview. It serves a page only at its own unguessable path, `/preview/<uuid>.html`; every other path is a
// 404, only GET and HEAD are accepted, and there is no listing. The agent's shell shares this machine's network, so the
// Host header is checked too, which stops a page on another name from reading a preview by DNS rebinding.
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import type { IncomingMessage, Server, ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { PAGE_POLICY } from "./preview-html.ts";

/** The name the page is opened at. Not the IP: some browsers and wrappers treat `localhost` as the trusted local name. */
const PAGE_HOST = "localhost";

/** Pages kept at once. A session that asks for many previews drops the oldest, and its address then answers 404. */
export const MAX_PAGES = 50;

const PATH = /^\/preview\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.html$/;

/** The headers on every answer. The policy repeats the page's own and adds what only a header can say. */
const HEADERS: Readonly<Record<string, string>> = {
    "Cache-Control": "no-store",
    "Content-Security-Policy": `${PAGE_POLICY}; frame-ancestors 'none'`,
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
};

const TEXT = "text/plain; charset=utf-8";

interface Reply {
    status: number;
    type: string;
    body: string;
    extra?: Record<string, string>;
}

export interface PreviewServer {
    /** Serves a page and returns its address. Starts the server when it is not running; rejects when it cannot listen. */
    serve(html: string): Promise<string>;
    /** Stops the server and forgets the pages. Safe to call twice. A later `serve` starts it again. */
    close(): Promise<void>;
}

export function createPreviewServer(): PreviewServer {
    const pages = new Map<string, string>();
    let running: Promise<{ server: Server; port: number }> | undefined;

    /** What to answer: the page, or why not. */
    function answer(request: IncomingMessage, port: number): Reply {
        if (request.method !== "GET" && request.method !== "HEAD")
            return { status: 405, type: TEXT, body: "Method not allowed", extra: { Allow: "GET, HEAD" } };
        const host = request.headers.host ?? "";
        if (host !== `${PAGE_HOST}:${port}` && host !== `127.0.0.1:${port}`)
            return { status: 403, type: TEXT, body: "Forbidden" };
        const id = PATH.exec((request.url ?? "").split("?")[0] ?? "")?.[1];
        const page = id === undefined ? undefined : pages.get(id);
        if (page === undefined) return { status: 404, type: TEXT, body: "Not found" };
        return { status: 200, type: "text/html; charset=utf-8", body: page };
    }

    function handle(request: IncomingMessage, response: ServerResponse, port: number): void {
        const reply = answer(request, port);
        const bytes = Buffer.from(reply.body, "utf8");
        response.writeHead(reply.status, {
            ...HEADERS,
            ...reply.extra,
            "Content-Type": reply.type,
            "Content-Length": String(bytes.length),
        });
        response.end(request.method === "HEAD" ? undefined : bytes);
    }

    function start(): Promise<{ server: Server; port: number }> {
        return new Promise((resolve, reject) => {
            const server = createServer();
            server.once("error", reject);
            server.listen(0, "127.0.0.1", () => {
                server.off("error", reject);
                // A failure after start-up (a reset connection) must not become an uncaught error in Pi.
                server.on("error", () => undefined);
                // The server never keeps Pi from exiting.
                server.unref();
                const port = (server.address() as AddressInfo).port;
                server.on("request", (request, response) => handle(request, response, port));
                resolve({ server, port });
            });
        });
    }

    return {
        async serve(html) {
            if (running === undefined) {
                running = start();
                // A failed start is not remembered: the next preview tries again.
                running.catch(() => {
                    running = undefined;
                });
            }
            const starting = running;
            const { port } = await starting;
            if (running !== starting) throw new Error("the preview server was stopped");
            const id = randomUUID();
            pages.set(id, html);
            while (pages.size > MAX_PAGES) {
                const oldest = pages.keys().next().value;
                if (oldest === undefined) break;
                pages.delete(oldest);
            }
            return `http://${PAGE_HOST}:${port}/preview/${id}.html`;
        },

        async close() {
            const current = running;
            running = undefined;
            pages.clear();
            if (current === undefined) return;
            let started: { server: Server; port: number };
            try {
                started = await current;
            } catch {
                return;
            }
            await new Promise<void>((resolve) => {
                started.server.close(() => resolve());
                started.server.closeAllConnections();
            });
        },
    };
}
