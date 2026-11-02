// The local server that shows previews in the browser: what it serves, what it refuses, and when it stops.
import assert from "node:assert/strict";
import { request } from "node:http";
import { connect } from "node:net";
import { networkInterfaces } from "node:os";
import { afterEach, describe, test } from "node:test";
import { PAGE_POLICY, renderPreviewPage } from "../src/preview-html.ts";
import { createPreviewServer, MAX_PAGES } from "../src/preview-server.ts";
import type { PreviewServer } from "../src/preview-server.ts";

interface Answer {
    status: number;
    headers: Record<string, string | string[] | undefined>;
    body: string;
}

/** One request to 127.0.0.1, with the Host header of the address unless another is given. */
function get(url: string, options: { method?: string; host?: string; path?: string } = {}): Promise<Answer> {
    const address = new URL(url);
    return new Promise((resolve, reject) => {
        const headers: Record<string, string> = {};
        headers.host = options.host ?? address.host;
        const req = request(
            {
                host: "127.0.0.1",
                port: Number(address.port),
                path: options.path ?? address.pathname,
                method: options.method ?? "GET",
                headers,
                agent: false,
            },
            (response) => {
                const chunks: Buffer[] = [];
                response.on("data", (chunk: Buffer) => chunks.push(chunk));
                response.on("end", () =>
                    resolve({
                        status: response.statusCode ?? 0,
                        headers: response.headers,
                        body: Buffer.concat(chunks).toString("utf8"),
                    }),
                );
            },
        );
        req.on("error", reject);
        req.end();
    });
}

/** What a raw request gets back, or undefined when the connection ends with no answer. A bare connect proves nothing:
 *  WSL's localhost relay accepts connections to a port nobody listens on, and resets them afterwards. */
function raw(host: string, port: number, text: string): Promise<string | undefined> {
    return new Promise((resolve) => {
        const socket = connect({ host, port });
        let received = "";
        socket.on("connect", () => socket.write(text));
        socket.on("data", (chunk: Buffer) => {
            received += chunk.toString("utf8");
        });
        socket.on("error", () => undefined);
        socket.on("close", () => resolve(received === "" ? undefined : received));
        setTimeout(() => socket.destroy(), 1500).unref();
    });
}

/** Whether a server answers at the address. */
async function listening(host: string, port: number): Promise<boolean> {
    return (await raw(host, port, `GET / HTTP/1.0\r\nHost: localhost:${port}\r\n\r\n`)) !== undefined;
}

describe("the preview server", () => {
    let server: PreviewServer = createPreviewServer();
    afterEach(async () => {
        await server.close();
        server = createPreviewServer();
    });

    test("serves a page it was given at an address on localhost, and starts only then", async () => {
        const url = await server.serve("<p>hello</p>");
        assert.match(url, /^http:\/\/localhost:\d+\/preview\/[0-9a-f-]{36}\.html$/);
        const answer = await get(url);
        assert.equal(answer.status, 200);
        assert.equal(answer.body, "<p>hello</p>");
    });

    test("every page has its own address, and both names of this machine's loopback work", async () => {
        const a = await server.serve("a");
        const b = await server.serve("b");
        assert.notEqual(a, b);
        assert.equal((await get(a)).body, "a");
        assert.equal((await get(b, { host: new URL(b).host.replace("localhost", "127.0.0.1") })).body, "b");
    });

    test("the answer is html with the headers that keep it a plain, uncached, unframed document", async () => {
        const { headers } = await get(await server.serve("x"));
        assert.equal(headers["content-type"], "text/html; charset=utf-8");
        assert.equal(headers["cache-control"], "no-store");
        assert.equal(headers["x-content-type-options"], "nosniff");
        assert.equal(headers["referrer-policy"], "no-referrer");
        assert.equal(headers["content-security-policy"], `${PAGE_POLICY}; frame-ancestors 'none'`);
    });

    test("the policy is the one the page carries, and the page needs nothing more than it allows", () => {
        const page = renderPreviewPage(
            {
                summary: "s",
                body: "+ added\n- removed\n[link](https://example.com) ![alt](https://example.com/i.png)",
                format: "diff",
            },
            "h",
        );
        assert.ok(page.includes(`<meta http-equiv="Content-Security-Policy" content="${PAGE_POLICY}">`));
        // Self-contained: nothing is fetched from outside, so default-src 'none' (with inline style) is enough.
        assert.ok(!/<(?:script|link|img|iframe|form)\b/i.test(page));
        assert.ok(!/url\(|@import|\bsrc=/i.test(page));
    });

    test("anything but a page it wrote is a 404, with the same headers", async () => {
        const url = await server.serve("x");
        const base = new URL(url).origin;
        const other = "/preview/00000000-0000-4000-8000-000000000000.html";
        for (const path of [
            "/",
            "/preview/",
            "/preview",
            other,
            "/preview/../preview-html.ts",
            "/preview/%2e%2e/etc/passwd",
            "/etc/passwd",
            `${new URL(url).pathname}/`,
            `${new URL(url).pathname}x`,
            new URL(url).pathname.replace("/preview/", "/"),
        ]) {
            const answer = await get(base, { path });
            assert.equal(answer.status, 404, path);
            assert.match(String(answer.headers["content-type"]), /^text\/plain/);
            assert.equal(answer.headers["cache-control"], "no-store", path);
            assert.equal(answer.headers["x-content-type-options"], "nosniff", path);
            assert.ok(!answer.body.includes("<"), path);
        }
    });

    test("a query string does not change which page is meant", async () => {
        const url = await server.serve("x");
        assert.equal((await get(url, { path: `${new URL(url).pathname}?a=1` })).status, 200);
    });

    test("only GET and HEAD: another method is a 405, and HEAD has no body", async () => {
        const url = await server.serve("<p>hello</p>");
        for (const method of ["POST", "PUT", "DELETE", "PATCH", "OPTIONS"]) {
            const answer = await get(url, { method });
            assert.equal(answer.status, 405, method);
            assert.equal(answer.headers.allow, "GET, HEAD");
        }
        const head = await get(url, { method: "HEAD" });
        assert.equal(head.status, 200);
        assert.equal(head.body, "");
        assert.equal(head.headers["content-length"], String(Buffer.byteLength("<p>hello</p>")));
    });

    test("a request for another host name is refused, so a page elsewhere cannot read it by DNS rebinding", async () => {
        const url = await server.serve("secret");
        const port = new URL(url).port;
        for (const host of [
            `example.com:${port}`,
            "localhost",
            `localhost:${Number(port) + 1}`,
            `evil.localhost:${port}`,
        ])
            assert.equal((await get(url, { host })).status, 403, host);
        // No Host header at all (HTTP/1.0).
        const bare = await raw("127.0.0.1", Number(port), `GET ${new URL(url).pathname} HTTP/1.0\r\n\r\n`);
        assert.match(bare ?? "", /^HTTP\/1\.1 403/);
    });

    test("listens on 127.0.0.1 only, not on this machine's other addresses", async () => {
        const port = Number(new URL(await server.serve("x")).port);
        assert.equal(await listening("127.0.0.1", port), true);
        const outside = Object.values(networkInterfaces())
            .flat()
            .find((entry) => entry?.family === "IPv4" && !entry.internal);
        if (outside === undefined) return; // no other address here, so there is nothing to try
        assert.equal(await listening(outside.address, port), false, outside.address);
    });

    test("keeps the latest pages only", async () => {
        const first = await server.serve("first");
        let last = first;
        for (let index = 0; index < MAX_PAGES; index += 1) last = await server.serve(`page ${index}`);
        assert.equal((await get(first)).status, 404);
        assert.equal((await get(last)).status, 200);
    });

    test("close stops it and forgets the pages; a later page starts it again", async () => {
        const url = await server.serve("x");
        const port = Number(new URL(url).port);
        await server.close();
        assert.equal(await listening("127.0.0.1", port), false);
        await server.close();
        const again = await server.serve("y");
        assert.equal((await get(again)).body, "y");
        assert.equal((await get(url.replace(String(port), new URL(again).port))).status, 404);
    });

    test("close ends a connection a browser left open", async () => {
        const url = await server.serve("x");
        const socket = connect({ host: "127.0.0.1", port: Number(new URL(url).port) });
        await new Promise((resolve) => socket.once("connect", resolve));
        socket.on("error", () => undefined); // the server ends the connection, which may show as a reset
        const closed = new Promise((resolve) => socket.once("close", resolve));
        await server.close();
        await closed;
    });

    test("close before any page is a no-op", async () => {
        await server.close();
    });

    test("a page asked for while it starts and stops together does not get an address that is gone", async () => {
        const pending = server.serve("x");
        const closing = server.close();
        await assert.rejects(pending, /stopped/);
        await closing;
    });
});
