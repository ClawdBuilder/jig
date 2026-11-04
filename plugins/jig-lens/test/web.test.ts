// The `/lens web` page server: who it answers, what it answers, and its life inside a (fake) Pi session. The server is
// real and listens on 127.0.0.1; the index is made from the sample records; no browser is opened.
import assert from "node:assert/strict";
import { request } from "node:http";
import { networkInterfaces } from "node:os";
import { test } from "node:test";
import type { TestContext } from "node:test";
import { readFileSync } from "node:fs";
import { importRecords } from "../src/import.ts";
import { openIndex } from "../src/store.ts";
import { createModelNames, modelLabel, shortModelId } from "../src/usage-names.ts";
import { lanesOf } from "../src/web-queries.ts";
import { answer, LensWeb } from "../src/web.ts";
import { NOW, paths, rig, sampleIndex, tempState, turn, writeRecords } from "./support.ts";

interface Reply {
    status: number;
    headers: Record<string, string | string[] | undefined>;
    body: string;
}

/** A request with the headers a test chooses, the Host among them, which `fetch` would not let it set. */
function ask(url: string, path: string, headers: Record<string, string> = {}, method = "GET"): Promise<Reply> {
    const { hostname, port } = new URL(url);
    return new Promise((resolve, reject) => {
        const sent = request({ host: hostname, port, path, method, headers }, (response) => {
            const chunks: Buffer[] = [];
            response.on("data", (chunk: Buffer) => chunks.push(chunk));
            response.on("end", () =>
                resolve({
                    status: response.statusCode ?? 0,
                    headers: response.headers,
                    body: Buffer.concat(chunks).toString("utf8"),
                }),
            );
        });
        sent.on("error", reject);
        sent.end();
    });
}

/** A server over the sample index, stopped when the test ends, and the cookie its link gives. */
async function served(t: TestContext, index?: string) {
    const where = index === undefined ? await sampleIndex(tempState(t)) : undefined;
    const web = new LensWeb({ index: () => index ?? where?.index ?? "", now: () => NOW });
    t.after(() => web.stop());
    await web.start();
    const url = web.url ?? "";
    const link = new URL(web.link ?? "");
    const first = await ask(url, `${link.pathname}${link.search}`, { host: link.host });
    const cookie = String(first.headers["set-cookie"] ?? "").split(";")[0] ?? "";
    const host = new URL(url).host;
    const get = (path: string) => ask(url, path, { host, cookie });
    return { web, url, link, first, cookie, host, get };
}

/**
 * Whether nothing answers HTTP at the address. A TCP connect is not enough: with some network setups (WSL's mirrored
 * mode) the connect to a closed port succeeds, and only the request fails.
 */
const isRefused = (url: string) =>
    new Promise<boolean>((resolve) => {
        const { hostname, port } = new URL(url);
        const sent = request({ host: hostname, port, path: "/", timeout: 1500 }, (response) => {
            response.resume();
            resolve(false);
        });
        sent.on("timeout", () => sent.destroy());
        sent.on("error", () => resolve(true));
        sent.end();
    });

test("the server listens on 127.0.0.1 only, on a port of its own", async (t) => {
    const { url } = await served(t);
    assert.match(url, /^http:\/\/127\.0\.0\.1:\d+$/);
    const port = new URL(url).port;
    // Any other address of this machine is refused.
    const others = Object.values(networkInterfaces())
        .flatMap((addresses) => addresses ?? [])
        .filter((address) => address.family === "IPv4" && !address.internal)
        .map((address) => address.address);
    for (const address of others) {
        assert.ok(await isRefused(`http://${address}:${port}`), address);
    }
});

test("the link swaps its secret for a cookie, and nothing is served without it", async (t) => {
    const { url, link, first, cookie, host, get } = await served(t);
    assert.equal(first.status, 302);
    assert.equal(first.headers.location, "/");
    assert.match(cookie, new RegExp(`^jig_lens_${new URL(url).port}=`));
    assert.match(String(first.headers["set-cookie"]), /HttpOnly; SameSite=Lax/);

    assert.equal((await ask(url, "/", { host })).status, 403, "no cookie");
    assert.equal((await ask(url, "/api/overview", { host, cookie: "jig_lens_1=x" })).status, 403, "a wrong cookie");
    assert.equal((await ask(url, "/?k=wrong", { host })).status, 403, "a wrong secret");
    assert.equal((await ask(url, `/${link.search}`, { host: "evil.example.com" })).status, 403, "another host name");
    assert.equal((await ask(url, "/", { host, cookie }, "POST")).status, 405, "nothing writes");
    assert.equal((await get("/")).status, 200);
    assert.equal((await ask(url, "/", { host: `localhost:${new URL(url).port}`, cookie })).status, 200);
});

test("the page is one file that loads nothing from anywhere, and its script runs by nonce", async (t) => {
    const { get } = await served(t);
    const page = await get("/");
    assert.equal(page.status, 200);
    assert.match(String(page.headers["content-type"]), /^text\/html/);
    assert.doesNotMatch(page.body, /https?:\/\//, "no address in the page");
    assert.doesNotMatch(page.body, /<link|<script [^>]*src=|@import|url\(/, "no file is loaded");
    const csp = String(page.headers["content-security-policy"]);
    assert.match(csp, /default-src 'none'/);
    assert.match(csp, /connect-src 'self'/);
    const nonce = /script-src 'nonce-([^']+)'/.exec(csp)?.[1];
    assert.ok(nonce);
    assert.ok(page.body.includes(`<script nonce="${nonce}">`));
    assert.equal(page.headers["cache-control"], "no-store");
    assert.equal(page.headers["referrer-policy"], "no-referrer");
});

test("the endpoints answer with the figures of the index", async (t) => {
    const { get } = await served(t);
    const overview = JSON.parse((await get("/api/overview?days=7")).body);
    assert.equal(overview.range.days, 7);
    assert.equal(overview.totals.calls, 14);
    assert.equal(overview.totals.turns, 6);
    assert.equal(overview.perDay.length, 7);
    assert.deepEqual(
        overview.sessions.map((row: { session: string }) => row.session),
        ["s1", "s2", "s3"],
    );
    assert.equal(overview.tickets[0].ticket, "T-1");

    const ticket = JSON.parse((await get("/api/ticket?key=T-1")).body);
    assert.equal(ticket.sessions[0].session, "s1");
    assert.equal(ticket.totals.calls, 8);

    const session = JSON.parse((await get("/api/session?id=s1")).body);
    assert.equal(session.timeline.session, "s1");
    assert.ok(session.timeline.lines.some((line: { kind: string }) => line.kind === "child"));
    assert.equal(JSON.parse((await get("/api/session?id=nobody")).body).timeline, null);

    const tools = JSON.parse((await get("/api/tools?days=7")).body);
    assert.ok(tools.tools.some((row: { tool: string }) => row.tool === "bash"));
    assert.equal(tools.refused.total, 3);
    assert.deepEqual(tools.loops, []);

    const time = JSON.parse((await get("/api/time?days=7")).body);
    assert.equal(time.time.questions, 4);

    assert.equal((await get("/api/ticket")).status, 400);
    assert.equal((await get("/api/session")).status, 400);
    assert.equal((await get("/api/nothing")).status, 404);
    assert.equal((await get("/elsewhere")).status, 404);
});

test("a range outside 1 to 90 days is one day, and today is the clock's day", async (t) => {
    const where = await sampleIndex(tempState(t));
    const source = { index: () => where.index, now: () => NOW };
    for (const days of ["0", "91", "x", ""]) {
        const result = answer(source, "/api/overview", new URLSearchParams({ days }));
        assert.equal((result.body as { range: { days: number } }).range.days, 1, days);
    }
});

test("with no index yet the endpoints say so, and the page still loads", async (t) => {
    const { get } = await served(t, `${tempState(t)}/lens/index.sqlite`);
    assert.deepEqual(JSON.parse((await get("/api/overview?days=1")).body), { empty: true });
    assert.equal((await get("/")).status, 200);
});

test("starting again reuses the running server, and stopping closes the port", async (t) => {
    const { web, url } = await served(t);
    assert.deepEqual(await web.start(), { reused: true });
    assert.equal(web.url, url);
    await web.stop();
    assert.equal(web.running, false);
    assert.equal(web.url, undefined);
    assert.ok(await isRefused(url));
    await web.stop();
});

// ---- in a fake Pi ---------------------------------------------------------------------------------------------------

test("/lens web imports, starts the page, opens its link, and a second /lens web reuses it", async (t) => {
    const r = rig(t);
    await sampleIndex(r.state);
    t.after(() => r.pi.fire("session_shutdown"));
    const [first] = await r.pi.lens("web");
    const link = r.opened[0] ?? "";
    assert.match(link, /^http:\/\/127\.0\.0\.1:\d+\/\?k=[\w-]+$/);
    const base = new URL(link).origin;
    assert.equal(first?.level, "info");
    assert.match(
        first?.text ?? "",
        new RegExp(`Started the page at ${base}\\.\\nOpened ${link.replace(/\?/, "\\?")} in`),
    );
    assert.deepEqual(r.spawned, [], "no program is started");

    const [second] = await r.pi.lens("web");
    assert.match(second?.text ?? "", new RegExp(`The page is running at ${base}\\.`));
    assert.equal(r.opened[1], link, "the same server, the same link");

    const status = (await r.pi.lens("status"))[0]?.text.split("\n") ?? [];
    assert.equal(status.at(-1), `Page: running at ${base}, for this session (/lens web opens it)`);

    await r.pi.fire("session_shutdown");
    assert.ok(await isRefused(base), "the page stops with the session");
    const after = (await r.pi.lens("status"))[0]?.text.split("\n") ?? [];
    assert.equal(after.at(-1), "Page: not running (/lens web starts it)");
});

test("/lens web says where the page is when no browser can be found", async (t) => {
    const r = rig(t, { opens: false });
    t.after(() => r.pi.fire("session_shutdown"));
    const [notice] = await r.pi.lens("web");
    assert.match(notice?.text ?? "", /\nOpen http:\/\/127\.0\.0\.1:\d+\/\?k=[\w-]+ in your browser\.$/);
});

// ---- model names ----------------------------------------------------------------------------------------------------

const ARN = ["arn", "aws", "llm", "us-east-1", "000000000000", "application-inference-profile/abc123xyz"].join(":");

test("a model id that nobody named is shortened: an ARN to its service and last part, without the account", () => {
    assert.equal(shortModelId(ARN), "llm abc123xyz");
    assert.equal(shortModelId("anthropic/claude-sonnet"), "claude-sonnet");
    assert.equal(shortModelId("model-a"), "model-a");
    assert.equal(modelLabel(ARN), "llm abc123xyz");
    const book = createModelNames();
    book.learn({ models: [{ recorded: ARN, name: "Claude Sonnet", provider: "llm" }] });
    assert.equal(modelLabel(ARN, book.names), "Claude Sonnet");
});

test("the session timeline shows a model's name or short form, and keeps the full id only for the tooltip", async (t) => {
    const state = tempState(t);
    writeRecords(state, [
        turn("t1", "2026-10-30T09:00:00Z", "s1", ARN, 0.1),
        turn(
            "t2",
            "2026-10-30T09:01:00Z",
            "s2",
            ARN,
            0.1,
            {},
            { JIG_AGENT_ROLE: "reviewer", JIG_PARENT_SESSION: "s1" },
        ),
    ]);
    const where = paths(state);
    const db = openIndex(where.index);
    await importRecords(db, { records: where.records, now: NOW });
    db.close();

    const turnsOf = (body: unknown) => {
        const timeline = (body as { timeline: { lines: Array<Record<string, unknown>> } }).timeline;
        const child = timeline.lines.find((line) => line.kind === "child") as { timeline: typeof timeline };
        return [timeline.lines[0], child.timeline.lines[0]];
    };
    const plain = answer(
        { index: () => where.index, now: () => NOW },
        "/api/session",
        new URLSearchParams({ id: "s1" }),
    );
    for (const line of turnsOf(plain.body)) {
        assert.equal(line?.model, "llm abc123xyz");
        assert.equal(line?.modelId, ARN);
    }
    const book = createModelNames();
    book.learn({ models: [{ recorded: ARN, name: "Claude Sonnet" }] });
    const named = answer(
        { index: () => where.index, now: () => NOW, names: book.names },
        "/api/session",
        new URLSearchParams({ id: "s1" }),
    );
    for (const line of turnsOf(named.body)) assert.equal(line?.model, "Claude Sonnet");
});

test("the page shows the model it is given and puts the id in a tooltip only", () => {
    const page = readFileSync(new URL("../web/index.html", import.meta.url), "utf8");
    assert.match(page, /h\("span", \{ title: line\.modelId \}, line\.model\)/);
    assert.equal(page.match(/modelId/g)?.length, 1, "the id is used for nothing else");
});

test("lanes split each turn into model time, tool time and the time waiting for the person", () => {
    const timeline = {
        session: "s1",
        agentRole: "main",
        parentSession: undefined,
        tickets: [],
        first: 0,
        last: 60,
        cost: 0.5,
        cut: false,
        lines: [
            {
                kind: "turn",
                time: 0,
                model: "m",
                modelId: "m",
                input: 0,
                output: 0,
                cacheRead: 0,
                cacheWrite: 0,
                cost: 0.2,
            },
            {
                kind: "call",
                time: 10,
                tool: "bash",
                action: "run",
                environment: "local",
                effect: "read",
                decision: "allow",
                decisionSource: "rule",
                approval: undefined,
                answer: undefined,
                waitedMs: 2000,
                outcome: "ok",
                errorKind: undefined,
                error: undefined,
                durationMs: 5000,
                toolCallId: "c1",
                facts: undefined,
            },
            {
                kind: "call",
                time: 20,
                tool: "git",
                action: "status",
                environment: "local",
                effect: "read",
                decision: "allow",
                decisionSource: "rule",
                approval: undefined,
                answer: undefined,
                waitedMs: undefined,
                outcome: "ok",
                errorKind: undefined,
                error: undefined,
                durationMs: 1000,
                toolCallId: "c2",
                facts: undefined,
            },
            {
                kind: "turn",
                time: 30,
                model: "m",
                modelId: "m",
                input: 0,
                output: 0,
                cacheRead: 0,
                cacheWrite: 0,
                cost: 0.3,
            },
            {
                kind: "call",
                time: 40,
                tool: "bash",
                action: "run",
                environment: "local",
                effect: "read",
                decision: "allow",
                decisionSource: "rule",
                approval: undefined,
                answer: undefined,
                waitedMs: undefined,
                outcome: "ok",
                errorKind: undefined,
                error: undefined,
                durationMs: 2000,
                toolCallId: "c3",
                facts: undefined,
            },
        ],
    } as Parameters<typeof lanesOf>[0];
    const lanes = lanesOf(timeline);
    assert.deepEqual(
        lanes.turns.map((lane) => [lane.modelMs, lane.toolMs, lane.waitedMs]),
        [
            [22_000, 6_000, 2_000],
            [28_000, 2_000, 0],
        ],
    );
    assert.equal(lanes.cut, false);
    assert.equal(lanesOf(timeline, 1).cut, true);
});

test("the call detail endpoint reads only the named session's file, and says when it has no sessions folder", () => {
    const source = { index: () => "", now: () => NOW };
    const missing = answer(source, "/api/call", new URLSearchParams({ id: "s1", call: "c1" }));
    assert.equal(missing.status, 200);
    assert.equal((missing.body as { found: boolean }).found, false);
    const bad = answer(source, "/api/call", new URLSearchParams({ id: "s1" }));
    assert.equal(bad.status, 400);
});

test("the page draws the lanes and asks this server for one call's detail", () => {
    const page = readFileSync(new URL("../web/index.html", import.meta.url), "utf8");
    assert.match(page, /laneChart\(data\.lanes\)/);
    assert.match(page, /\/api\/call\?id=\$/);
    assert.match(page, /show this call|Show this call/);
});
