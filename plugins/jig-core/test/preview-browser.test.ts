// The browser path end to end: a review screen asks, the real preview server serves the page, and a stand-in for the
// browser (a script named by $BROWSER that only records the address it was given) is the launcher. No real browser opens.
import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { request } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { afterEach, beforeEach, describe, test } from "node:test";
import type { Component } from "@earendil-works/pi-tui";
import type { JigApi } from "../src/contract.ts";
import { fakeTerminal } from "./support/fakes.ts";
import type { FakeUiScript } from "./support/fakes.ts";
import { start } from "./support/harness.ts";
import type { Harness } from "./support/harness.ts";
import { tempState } from "./support/state.ts";

const state = tempState();
let scratch = "";
let log = "";
let harness: Harness | undefined;
beforeEach(() => {
    state.start();
    scratch = mkdtempSync(path.join(tmpdir(), "jig-browser-"));
    log = path.join(scratch, "opened.txt");
    writeFileSync(path.join(scratch, "browser"), `#!/bin/sh\necho "$1" >> "${log}"\n`);
    chmodSync(path.join(scratch, "browser"), 0o755);
});
afterEach(async () => {
    await harness?.shutdown();
    harness = undefined;
    state.stop();
    rmSync(scratch, { recursive: true, force: true });
});

/** The addresses the stand-in browser has been given so far. */
function given(): string[] {
    return existsSync(log) ? readFileSync(log, "utf8").split("\n").filter(Boolean) : [];
}

/** The addresses the stand-in browser was given, once there are `count` of them (or the wait runs out). */
async function opened(count: number): Promise<string[]> {
    for (let waited = 0; waited < 3000 && given().length < count; waited += 25) await sleep(25);
    return given();
}

/** One GET to the server, as a browser on this machine would make it. */
function fetchPage(address: string): Promise<{ status: number; body: string }> {
    const url = new URL(address);
    return new Promise((resolve, reject) => {
        request(
            {
                host: "127.0.0.1",
                port: Number(url.port),
                path: url.pathname,
                headers: { host: url.host },
                agent: false,
            },
            (response) => {
                let body = "";
                response.on("data", (chunk: Buffer) => {
                    body += chunk.toString("utf8");
                });
                response.on("end", () => resolve({ status: response.statusCode ?? 0, body }));
            },
        )
            .on("error", reject)
            .end();
    });
}

/** Whether a server answers a request at the port (a bare connect proves nothing under WSL's localhost relay). */
async function answers(port: string): Promise<boolean> {
    try {
        await fetchPage(`http://localhost:${port}/`);
        return true;
    } catch {
        return false;
    }
}

function declare(api: JigApi): void {
    api.declareTool({
        tool: "fake",
        plugin: "jig-test",
        classify: () => ({ environment: "external", effect: "write" }),
        preview: async () => ({ summary: "Comment on PR 7", body: "The comment text", format: "text" }),
    });
}

/** Runs the screen: `before` gets the component, and the key presses it should make; resolves with what render showed last. */
function screen(
    script: (component: Component, rendered: () => string) => Promise<string[]>,
): NonNullable<FakeUiScript["custom"]> {
    return (factory) =>
        new Promise((resolve) => {
            const terminal = fakeTerminal();
            const component = factory(terminal.tui, terminal.theme, terminal.keybindings, resolve) as Component;
            const rendered = () => component.render(200).join("\n");
            rendered();
            void script(component, rendered).then((keys) => {
                for (const key of keys) component.handleInput?.(key);
            });
        });
}

async function ask(config: unknown, custom: NonNullable<FakeUiScript["custom"]>): Promise<Harness> {
    harness = await start({
        config,
        mode: "tui",
        ui: { custom },
        env: { ...process.env, BROWSER: path.join(scratch, "browser") },
        plugins: declare,
    });
    const outcome = await harness.call({ tool: "fake", input: {} });
    assert.equal(outcome.blocked, false);
    return harness;
}

describe("the o key, with the real server", () => {
    test("opens an address on localhost that serves the page, and the server is gone after the session", async () => {
        let address = "";
        let page = { status: 0, body: "" };
        let shown = "";
        await ask(
            undefined,
            screen(async (component, rendered) => {
                component.handleInput?.("o");
                [address = ""] = await opened(1);
                page = await fetchPage(address);
                await sleep(50);
                shown = rendered();
                return ["y"];
            }),
        );
        assert.match(address, /^http:\/\/localhost:\d+\/preview\/[0-9a-f-]{36}\.html$/);
        assert.equal(page.status, 200);
        assert.match(page.body, /Comment on PR 7/);
        assert.match(shown, /opened in the browser: http:\/\/localhost:\d+\/preview\//);
        const port = new URL(address).port;
        await harness?.shutdown();
        assert.equal(await answers(port), false, "closed with the session");
    });

    test("by default nothing opens until the key is pressed", async () => {
        await ask(
            undefined,
            screen(async () => ["y"]),
        );
        await sleep(200);
        assert.deepEqual(given(), []);
    });
});

describe('the setting approvals.openInBrowser: "always"', () => {
    test("opens the preview once as the screen appears, and the question stays open", async () => {
        let address = "";
        let page = { status: 0, body: "" };
        await ask(
            { approvals: { openInBrowser: "always" } },
            screen(async () => {
                [address = ""] = await opened(1);
                page = await fetchPage(address);
                return ["y"];
            }),
        );
        assert.equal(page.status, 200);
        assert.match(page.body, /Comment on PR 7/);
        await sleep(200);
        assert.equal(given().length, 1, "once");
    });

    test("opens once for each question", async () => {
        harness = await start({
            config: { approvals: { openInBrowser: "always" } },
            mode: "tui",
            ui: { custom: screen(async () => ["y"]) },
            env: { ...process.env, BROWSER: path.join(scratch, "browser") },
            plugins: declare,
        });
        await harness.call({ tool: "fake", input: {} });
        await harness.call({ tool: "fake", input: {} });
        const addresses = await opened(2);
        assert.equal(addresses.length, 2);
        assert.notEqual(addresses[0], addresses[1]);
    });

    test("pressing o as well opens it again, as it always did", async () => {
        await ask(
            { approvals: { openInBrowser: "always" } },
            screen(async (component) => {
                await opened(1);
                component.handleInput?.("o");
                await opened(2);
                return ["y"];
            }),
        );
        assert.equal((await opened(2)).length, 2);
    });
});
