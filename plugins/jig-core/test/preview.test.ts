// What the user sees when a call asks: the summary, the preview a tool builds, and the page for the browser.
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, utimesSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { after, before, describe, test } from "node:test";
import type { Preview, ToolDeclaration } from "../src/contract.ts";
import { buildPreview, defaultSummary, describeCall, PREVIEW_TIMEOUT_MS } from "../src/preview.ts";
import { browserCommand } from "../src/kit/browser.ts";
import {
    cleanupPreviews,
    escapeHtml,
    openInBrowser,
    openPreview,
    opensInWindows,
    renderPreviewPage,
    runsUnderWsl,
    writePreviewPage,
} from "../src/preview-html.ts";
import type { PreviewServer } from "../src/preview-server.ts";
import { tempState } from "./support/state.ts";

const declared = (preview: ToolDeclaration["preview"]): ToolDeclaration => ({
    tool: "t",
    plugin: "p",
    classify: () => undefined,
    ...(preview === undefined ? {} : { preview }),
});

describe("describing a call", () => {
    test("names the tool, the action, the environment and the effect", () => {
        assert.equal(
            describeCall({ tool: "git", action: "push", environment: "external", effect: "write" }),
            "git · push · external · write",
        );
        assert.equal(describeCall({ tool: "watch", environment: "local", effect: "read" }), "watch · local · read");
    });

    test("the default summary shows the call's arguments on one line, cut short", () => {
        const call = {
            tool: "deploy",
            action: "run",
            environment: "staging",
            effect: "write" as const,
            unknown: false,
        };
        assert.equal(
            defaultSummary(call, { service: "api", version: "1.2" }),
            'deploy run: {"service":"api","version":"1.2"}',
        );
        const long = defaultSummary(call, { text: "x".repeat(1000) });
        assert.ok(long.length < 260 && long.endsWith("…"), long);
    });

    test("an unclassified tool is called out", () => {
        const summary = defaultSummary(
            { tool: "mystery", environment: "external", effect: "write", unknown: true },
            {},
        );
        assert.match(summary, /^mystery \(not classified, so treated as a write outside this machine\)/);
    });

    test("arguments that cannot be written as JSON do not break the question", () => {
        const summary = defaultSummary(
            { tool: "t", environment: "external", effect: "write", unknown: false },
            { big: 10n },
        );
        assert.match(summary, /arguments cannot be shown/);
    });
});

describe("building a preview", () => {
    test("a tool without a preview function gets the summary made from the call", async () => {
        assert.deepEqual(await buildPreview(declared(undefined), {}, "the summary"), { summary: "the summary" });
        assert.deepEqual(await buildPreview(undefined, {}, "no declaration"), { summary: "no declaration" });
    });

    test("uses the tool's preview, which gets the input and a signal", async () => {
        let seen: unknown;
        const preview: Preview = { summary: "Push 3 commits", body: "diff text", format: "diff", fingerprint: "abc" };
        const result = await buildPreview(
            declared(async (input, signal) => {
                seen = [input, signal.aborted];
                return preview;
            }),
            { branch: "x" },
            "fallback",
        );
        assert.deepEqual(result, preview);
        assert.deepEqual(seen, [{ branch: "x" }, false]);
    });

    test("a preview that fails shows `preview unavailable` and the reason", async () => {
        const thrown = await buildPreview(
            declared(async () => {
                throw new Error("git is not installed");
            }),
            {},
            "fallback",
        );
        assert.deepEqual(thrown, { summary: "preview unavailable: git is not installed" });
        const syncThrow = await buildPreview(
            declared(() => {
                throw new Error("broke at once");
            }),
            {},
            "fallback",
        );
        assert.deepEqual(syncThrow, { summary: "preview unavailable: broke at once" });
        const text = await buildPreview(
            declared(async () => Promise.reject("just a string")),
            {},
            "fallback",
        );
        assert.deepEqual(text, { summary: "preview unavailable: just a string" });
    });

    test("a preview that returns something unusable is unavailable too", async () => {
        for (const bad of [
            undefined,
            null,
            "text",
            { body: "no summary" },
            { summary: "" },
            { summary: "ok", body: 5 },
        ]) {
            const result = await buildPreview(
                declared(async () => bad as unknown as Preview),
                {},
                "fallback",
            );
            assert.match(
                (result as Preview).summary,
                /^preview unavailable: the tool returned no summary$/,
                JSON.stringify(bad),
            );
        }
    });

    test("a preview that takes too long is stopped, even if it ignores the signal", async () => {
        let signalSeen: AbortSignal | undefined;
        const started = Date.now();
        const result = await buildPreview(
            declared((_input, signal) => {
                signalSeen = signal;
                return new Promise<Preview>(() => {});
            }),
            {},
            "fallback",
            100,
        );
        assert.deepEqual(result, { summary: "preview unavailable: it took longer than 100 ms" });
        assert.ok(Date.now() - started < 3000);
        assert.equal(signalSeen?.aborted, true, "the tool is told to stop");
    });

    test("the time allowed is 15 seconds", () => {
        assert.equal(PREVIEW_TIMEOUT_MS, 15_000);
    });
});

describe("the page for the browser", () => {
    const page = (preview: Preview, header = "tool · action · external · write") => renderPreviewPage(preview, header);

    test("escapes the summary and the header, and carries a policy that loads nothing from outside", () => {
        const html = page({ summary: "<img src=x onerror=alert(1)> & more" }, "<b>header</b>");
        assert.ok(!html.includes("<img src=x"));
        assert.ok(!html.includes("<b>header"));
        assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt; &amp; more/);
        assert.match(
            html,
            /<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'">/,
        );
        assert.ok(!/<script/i.test(html));
        assert.ok(!/<form/i.test(html));
        assert.match(html, /This is a preview only: answer y or n in Pi, and you can close this page\./);
        assert.doesNotMatch(html, /<p class="note">[^<]*\n/);
    });

    test("markdown is rendered, and raw HTML in it is shown as text", () => {
        const html = page({
            summary: "s",
            format: "markdown",
            body: '# Title\n\nSome **bold** and `code`.\n\n<script>alert(1)</script>\n\n<div onclick="x()">text</div>',
        });
        assert.match(html, /<h1>Title<\/h1>/);
        assert.match(html, /<strong>bold<\/strong>/);
        assert.match(html, /<code>code<\/code>/);
        assert.ok(!html.includes("<script>alert(1)"));
        assert.ok(!html.includes("<div onclick"));
        assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
    });

    test("links keep only http, https and mailto, and images show only their description", () => {
        const html = page({
            summary: "s",
            format: "markdown",
            body: "[ok](https://example.com/a?b=1&c=2) [mail](mailto:a@b.c) [bad](javascript:alert(1)) [data](data:text/html,x) ![alt text](http://tracker.example/pixel.png)",
        });
        assert.match(html, /<a href="https:\/\/example\.com\/a\?b=1&amp;c=2" rel="noreferrer noopener">ok<\/a>/);
        assert.match(html, /<a href="mailto:a@b\.c"/);
        assert.ok(!/javascript:/.test(html));
        assert.ok(!/href="data:/.test(html));
        assert.ok(!/<img/i.test(html));
        assert.ok(!html.includes("tracker.example"));
        assert.match(html, /alt text/);
    });

    test("a diff gets a colour for added and removed lines", () => {
        const html = page({
            summary: "s",
            format: "diff",
            body: "diff --git a/x b/x\n--- a/x\n+++ b/x\n@@ -1 +1 @@\n-old <line>\n+new line\n context",
        });
        assert.match(html, /<span class="d-meta">diff --git a\/x b\/x<\/span>/);
        assert.match(html, /<span class="d-hunk">@@ -1 \+1 @@<\/span>/);
        assert.match(html, /<span class="d-del">-old &lt;line&gt;<\/span>/);
        assert.match(html, /<span class="d-add">\+new line<\/span>/);
        assert.match(html, /<span class="d-ctx"> context<\/span>/);
        assert.doesNotMatch(html, /<\/span>\n<span/, "a block span per line, not a blank line between them");
    });

    test("plain text is shown as it is, in a block", () => {
        const html = page({ summary: "s", format: "text", body: "line one\n<line two>" });
        assert.match(html, /<pre>line one\n&lt;line two&gt;<\/pre>/);
        assert.match(page({ summary: "s", body: "no format" }), /<pre>no format<\/pre>/);
    });

    test("a preview without a body is just the summary", () => {
        const html = page({ summary: "Only a summary" });
        assert.match(html, /<h1>Only a summary<\/h1>/);
        assert.ok(!html.includes("<pre"));
    });

    test("escapeHtml covers the five characters", () => {
        assert.equal(
            escapeHtml(`<a href="x" title='y'>&</a>`),
            "&lt;a href=&quot;x&quot; title=&#39;y&#39;&gt;&amp;&lt;/a&gt;",
        );
    });
});

describe("writing the page and opening it", () => {
    const state = tempState();
    before(() => {
        state.start();
    });
    after(() => state.stop());

    test("a page written as a file is private, under <state>/previews/", () => {
        const file = writePreviewPage(
            { summary: "Comment on PR 7", body: "hello", format: "text" },
            "pr · comment · external · write",
        );
        assert.equal(path.dirname(file), path.join(state.dir, "previews"));
        assert.match(path.basename(file), /^[0-9a-f-]{36}\.html$/);
        assert.equal(statSync(file).mode & 0o777, 0o600);
        assert.equal(statSync(path.dirname(file)).mode & 0o777, 0o700);
        assert.match(readFileSync(file, "utf8"), /Comment on PR 7/);
    });

    test("two previews never share a file", () => {
        const a = writePreviewPage({ summary: "a" }, "h");
        const b = writePreviewPage({ summary: "a" }, "h");
        assert.notEqual(a, b);
    });

    test("old pages are removed", () => {
        const dir = path.join(state.dir, "previews");
        mkdirSync(dir, { recursive: true });
        const old = path.join(dir, "old.html");
        writeFileSync(old, "x");
        const tenDaysAgo = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);
        utimesSync(old, tenDaysAgo, tenDaysAgo);
        assert.ok(cleanupPreviews(7) >= 1);
        assert.equal(existsSync(old), false);
    });

    test("$BROWSER is used when set, with its own arguments and %s for the address", () => {
        assert.deepEqual(browserCommand("file:///x.html", { BROWSER: "firefox" }, "linux"), {
            program: "firefox",
            args: ["file:///x.html"],
        });
        assert.deepEqual(browserCommand("file:///x.html", { BROWSER: "firefox --new-window" }, "linux"), {
            program: "firefox",
            args: ["--new-window", "file:///x.html"],
        });
        assert.deepEqual(browserCommand("file:///x.html", { BROWSER: "chromium --app=%s" }, "linux"), {
            program: "chromium",
            args: ["--app=file:///x.html"],
        });
    });

    test("otherwise xdg-open on Linux and open on macOS", () => {
        assert.equal(browserCommand("u", {}, "linux").program, "xdg-open");
        assert.equal(browserCommand("u", { BROWSER: "  " }, "linux").program, "xdg-open");
        assert.equal(browserCommand("u", {}, "darwin").program, "open");
    });

    test("a file is opened by its file address, and the line says so", async () => {
        const launched: Array<{ program: string; args: string[] }> = [];
        const message = await openInBrowser(
            "/tmp/a b/preview.html",
            async (program, args) => {
                launched.push({ program, args });
            },
            { BROWSER: "my-browser" },
        );
        assert.equal(message, "opened in the browser: file:///tmp/a%20b/preview.html");
        assert.deepEqual(launched, [{ program: "my-browser", args: ["file:///tmp/a%20b/preview.html"] }]);
    });

    test("an http address is passed to the browser as it is", async () => {
        const launched: Array<{ program: string; args: string[] }> = [];
        const url = "http://localhost:4123/preview/0b1f.html";
        const message = await openInBrowser(
            url,
            async (program, args) => {
                launched.push({ program, args });
            },
            { BROWSER: "browser-wrapper --new-tab" },
        );
        assert.equal(message, `opened in the browser: ${url}`);
        assert.deepEqual(launched, [{ program: "browser-wrapper", args: ["--new-tab", url] }]);
    });

    test("a launcher that cannot start is reported, with the address to open by hand", async () => {
        const failed = await openInBrowser(
            "http://localhost:4123/preview/x.html",
            async () => {
                throw new Error("xdg-open is not installed");
            },
            {},
        );
        assert.equal(
            failed,
            "could not open the browser: xdg-open is not installed (the address is http://localhost:4123/preview/x.html)",
        );
    });
});

describe("opening a preview", () => {
    const state = tempState();
    before(() => {
        state.start();
    });
    after(() => state.stop());

    const preview: Preview = { summary: "Comment on PR 7", body: "hello", format: "text" };
    /** A server that keeps what it is given and answers at a fixed address. */
    function fakeServer(): PreviewServer & { pages: string[] } {
        const pages: string[] = [];
        return {
            pages,
            serve: async (html) => {
                pages.push(html);
                return "http://localhost:4123/preview/abc.html";
            },
            close: async () => undefined,
        };
    }
    const launcher = () => {
        const launched: string[][] = [];
        return {
            launched,
            launch: async (_program: string, args: string[]) => {
                launched.push(args);
            },
        };
    };

    test("serves the page over http and opens that address, writing no file", async () => {
        const server = fakeServer();
        const { launched, launch } = launcher();
        const message = await openPreview(preview, "h", { server, launch, env: {} });
        assert.equal(message, "opened in the browser: http://localhost:4123/preview/abc.html");
        assert.deepEqual(launched, [["http://localhost:4123/preview/abc.html"]]);
        assert.equal(server.pages.length, 1);
        assert.match(server.pages[0] ?? "", /Comment on PR 7/);
        assert.equal(
            existsSync(path.join(state.dir, "previews")) && readdirSync(path.join(state.dir, "previews")).length > 0,
            false,
        );
    });

    test("a launcher that cannot start is said, with the address", async () => {
        const message = await openPreview(preview, "h", {
            server: fakeServer(),
            launch: async () => {
                throw new Error("spawn xdg-open ENOENT");
            },
            env: {},
        });
        assert.equal(
            message,
            "could not open the browser: spawn xdg-open ENOENT (the address is http://localhost:4123/preview/abc.html)",
        );
    });

    test("when the server cannot listen, it falls back to a file and says which it used", async () => {
        const { launched, launch } = launcher();
        const server: PreviewServer = {
            serve: async () => {
                throw new Error("listen EADDRNOTAVAIL");
            },
            close: async () => undefined,
        };
        const message = await openPreview(preview, "h", { server, launch, env: {}, wsl: false });
        const files = readdirSync(path.join(state.dir, "previews"));
        assert.equal(files.length, 1);
        const address = pathToFileURL(path.join(state.dir, "previews", files[0] ?? "")).href;
        assert.deepEqual(launched, [[address]]);
        assert.equal(
            message,
            `opened the page as a file, not over http (the local preview server could not start: listen EADDRNOTAVAIL): ${address}`,
        );
    });

    test("with the server down and the launcher too, both reasons are in the line", async () => {
        const server: PreviewServer = {
            serve: async () => {
                throw new Error("listen EADDRNOTAVAIL");
            },
            close: async () => undefined,
        };
        const message = await openPreview(preview, "h", {
            server,
            launch: async () => {
                throw new Error("no browser");
            },
            env: {},
            wsl: false,
        });
        assert.match(
            message,
            /^could not open the browser: no browser \(the local preview server could not start: listen EADDRNOTAVAIL; the file is file:\/\/\/.*\.html\)$/,
        );
    });
});

describe("a file address is never tried for a Windows browser", () => {
    const state = tempState();
    before(() => {
        state.start();
    });
    after(() => state.stop());

    const down: PreviewServer = {
        serve: async () => {
            throw new Error("listen EADDRNOTAVAIL");
        },
        close: async () => undefined,
    };
    const preview: Preview = { summary: "s", body: "b" };

    test("under WSL, a server that cannot start is said, and nothing is launched or written", async () => {
        const launched: string[][] = [];
        const message = await openPreview(preview, "h", {
            server: down,
            launch: async (_program, args) => {
                launched.push(args);
            },
            env: {},
            wsl: true,
        });
        assert.match(
            message,
            /^could not open the browser: the local preview server could not start: listen EADDRNOTAVAIL/,
        );
        assert.ok(!message.includes("file://"));
        assert.deepEqual(launched, []);
        assert.equal(existsSync(path.join(state.dir, "previews")), false);
    });

    test("a Windows program as the opener is the same, off WSL", async () => {
        for (const browser of [
            "/mnt/c/Windows/explorer.exe",
            "msedge.exe",
            "C:\\Windows\\explorer.exe",
            "/mnt/d/tools/open",
        ]) {
            const launched: string[][] = [];
            const message = await openPreview(preview, "h", {
                server: down,
                launch: async (_program, args) => {
                    launched.push(args);
                },
                env: { BROWSER: browser },
                wsl: false,
            });
            assert.match(message, /^could not open the browser: the local preview server could not start/, browser);
            assert.deepEqual(launched, [], browser);
        }
    });

    test("opensInWindows tells the cases apart", () => {
        assert.equal(opensInWindows({}, true), true);
        assert.equal(opensInWindows({}, false), false);
        assert.equal(opensInWindows({ BROWSER: "firefox" }, false), false);
        assert.equal(opensInWindows({ BROWSER: "/usr/bin/chromium --new-window" }, false), false);
        assert.equal(opensInWindows({ BROWSER: "/mnt/c/Program Files/x.exe" }, false), true);
        assert.equal(opensInWindows({ BROWSER: "wslview.exe" }, false), true);
    });

    test("WSL is found by the interop file or the kernel version, not by WSL_DISTRO_NAME", () => {
        const none = () => false;
        const missing = (): string => {
            throw new Error("ENOENT");
        };
        assert.equal(
            runsUnderWsl((file) => file.endsWith("WSLInterop"), missing),
            true,
        );
        assert.equal(
            runsUnderWsl(none, () => "Linux version 6.18.26.1-microsoft-standard-WSL2 (root@x)"),
            true,
        );
        assert.equal(
            runsUnderWsl(none, () => "Linux version 6.8.0-generic (buildd@lcy02)"),
            false,
        );
        assert.equal(runsUnderWsl(none, missing), false);
    });
});

describe("a tool's own rendered page", () => {
    test("replaces the page jig-core would build, without tags that run, load or navigate", async () => {
        const { renderPreviewPage } = await import("../src/preview-html.ts");
        const page = renderPreviewPage(
            {
                summary: "Comment on PROJ-1",
                body: "h1. Title",
                html: '<h1>Title</h1><meta http-equiv="refresh" content="0;url=https://example.com"><script>alert(1)</script><iframe src="https://example.com"></iframe><p>kept</p>',
            },
            "jira · comment · external · write",
        );
        assert.match(page, /<h1>Title<\/h1>/);
        assert.match(page, /<p>kept<\/p>/);
        assert.doesNotMatch(page, /http-equiv="refresh"|<script>|<iframe/);
        assert.match(page, /Content-Security-Policy" content="default-src 'none'/);
    });

    test("a non-string html field is not a preview", async () => {
        const result = await buildPreview(
            declared(async () => ({ summary: "s", html: 42 }) as unknown as Preview),
            {},
            "fallback",
        );
        assert.match((result as Preview).summary, /^preview unavailable/);
    });

    test("a TypeError says the input is invalid", async () => {
        const result = await buildPreview(
            declared(async () => {
                throw new TypeError("bad branch name");
            }),
            {},
            "fallback",
        );
        assert.deepEqual(result, { invalid: "bad branch name" });
    });
});

test("a preview uses the shared palette and pins the configured theme", () => {
    const preview = { summary: "git push", body: "diff", format: "diff" as const, fingerprint: "f" };
    const dark = renderPreviewPage(preview, "git push", "dark");
    assert.match(dark, /<html lang="en" data-theme="dark">/);
    assert.match(dark, /--jig-dark-bg: #111113;/);
    assert.match(dark, /--jig-dark-text: #e7e7ea;/);
    assert.match(dark, /--jig-bg: var\(--jig-dark-bg\)/);
    const system = renderPreviewPage(preview, "git push");
    assert.match(system, /<html lang="en">/);
});
