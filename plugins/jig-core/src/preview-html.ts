// A preview rendered as a web page, for reading in the browser (the `o` key on the review screen).
//
// The browser only shows. The page has no script and no form, and nothing in it can answer the question. It is served
// to the browser by a small local server (src/preview-server.ts) at an address on `localhost`, which works wherever the
// browser can reach this machine, a Windows browser under WSL included. Only when that server cannot start is the page
// written as a file under `<state>/previews/` and opened by its file address. Approval stays in Pi.
//
// The text in a preview can come from the model (a pull request description it wrote), so it is treated as untrusted:
// raw HTML in it is shown as text, links are kept only for http, https and mailto, images are shown as their
// description, and the page tells the browser to load nothing from outside.
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { Marked } from "@earendil-works/pi-tui";
import type { Tokens } from "@earendil-works/pi-tui";
import type { Preview } from "./contract.ts";
import { browserCommand } from "./kit/browser.ts";
import { themeAttribute, themeCss } from "./kit/theme.ts";
import type { ThemeChoice } from "./kit/theme.ts";
import { errorMessage } from "./errors.ts";
import { resolveProgram } from "./exec.ts";
import { createPrivateFile, privateDir, removeOldFiles, stateDir } from "./paths.ts";
import type { PreviewServer } from "./preview-server.ts";

/** What the page may load: nothing from outside, only its own inline style. The server sends it as a header too. */
export const PAGE_POLICY = "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'";

export function escapeHtml(text: string): string {
    return text
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

const markdown = new Marked({
    renderer: {
        html: (token: Tokens.HTML | Tokens.Tag) => escapeHtml(token.text),
        image: (token: Tokens.Image) => escapeHtml(token.text),
        link(token: Tokens.Link) {
            const inner = this.parser.parseInline(token.tokens);
            if (!/^(?:https?:|mailto:)/i.test(token.href)) return inner;
            return `<a href="${escapeHtml(token.href)}" rel="noreferrer noopener">${inner}</a>`;
        },
    },
});

/** A diff with a colour for added and removed lines. */
function renderDiff(text: string): string {
    const lines = text.split("\n").map((line) => {
        const kind =
            line.startsWith("+++") || line.startsWith("---") || line.startsWith("diff ") || line.startsWith("index ")
                ? "d-meta"
                : line.startsWith("@@")
                  ? "d-hunk"
                  : line.startsWith("+")
                    ? "d-add"
                    : line.startsWith("-")
                      ? "d-del"
                      : "d-ctx";
        return `<span class="${kind}">${escapeHtml(line)}</span>`;
    });
    return `<pre class="diff">${lines.join("\n")}</pre>`;
}

const STYLE = `
body { margin: 0; background: var(--jig-bg); color: var(--jig-text); font: 16px/1.5 system-ui, sans-serif; }
main { max-width: 56rem; margin: 0 auto; padding: 1.5rem 16px 4rem; }
.note { color: var(--jig-muted); border-bottom: 1px solid var(--jig-border); padding-bottom: .75rem; margin: 0 0 1rem; }
.meta { color: var(--jig-muted); font-size: .875rem; margin: 0 0 .25rem; }
h1 { font-size: 1.25rem; margin: 0 0 1.25rem; }
pre, code { background: var(--jig-code); border-radius: 6px; font: 14px/1.45 ui-monospace, monospace; }
pre { padding: .75rem 1rem; overflow-x: auto; white-space: pre-wrap; overflow-wrap: anywhere; }
code { padding: .1rem .3rem; }
pre code { padding: 0; background: none; }
.diff span { display: block; }
.d-add { background: var(--jig-add-bg); }
.d-del { background: var(--jig-del-bg); }
.d-hunk { background: var(--jig-hunk-bg); }
.d-meta { color: var(--jig-muted); }
blockquote { margin: 0; padding-left: 1rem; border-left: 3px solid var(--jig-border); color: var(--jig-muted); }
table { border-collapse: collapse; } td, th { border: 1px solid var(--jig-border); padding: .25rem .5rem; }
`;
/** The page for a preview. `header` is the line that names the tool, the action, the environment and the effect. */
/** Tags that could run, load or navigate. The page's policy already blocks scripts and requests; removing these is
 *  the second lock, for a tool whose renderer lets one through: a `<meta http-equiv="refresh">`, for one, navigates. */
const ACTIVE_TAGS =
    /<\/?(?:script|iframe|frame|frameset|object|embed|applet|meta|link|base|form|input|button|textarea|select|svg|math)\b[^>]*>/gi;

export function withoutActiveTags(html: string): string {
    return html.replace(ACTIVE_TAGS, "");
}

export function renderPreviewPage(preview: Preview, header: string, theme: ThemeChoice = "system"): string {
    let body = "";
    if (preview.html !== undefined) {
        body = withoutActiveTags(preview.html);
    } else if (preview.body !== undefined) {
        if (preview.format === "markdown") body = markdown.parse(preview.body, { async: false });
        else if (preview.format === "diff") body = renderDiff(preview.body);
        else body = `<pre>${escapeHtml(preview.body)}</pre>`;
    }
    return `<!doctype html>
<html lang="en"${themeAttribute(theme)}>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="${PAGE_POLICY}">
<title>${escapeHtml(preview.summary)}</title>
<style>${themeCss()}${STYLE}</style>
</head>
<body>
<main>
<p class="note">This page only shows the preview. Approve or decline in Pi.</p>
<p class="meta">${escapeHtml(header)}</p>
<h1>${escapeHtml(preview.summary)}</h1>
${body}
</main>
</body>
</html>
`;
}

/** Writes the page under `<state>/previews/` (0600) and returns its path. */
export function writePreviewPage(preview: Preview, header: string, theme: ThemeChoice = "system"): string {
    const dir = privateDir("previews");
    const file = join(dir, `${randomUUID()}.html`);
    createPrivateFile(file, renderPreviewPage(preview, header, theme));
    return file;
}

/** Deletes preview pages older than `maxAgeDays`. */
export function cleanupPreviews(maxAgeDays: number, now: number = Date.now()): number {
    return removeOldFiles(join(stateDir(), "previews"), maxAgeDays, now);
}

/** Starts a program and forgets it. Resolves once it has started, rejects when it cannot. */
export type Launch = (program: string, args: string[]) => Promise<void>;

const launchDetached: Launch = (program, args) =>
    new Promise((resolve, reject) => {
        const child = spawn(resolveProgram(program, undefined), args, { detached: true, stdio: "ignore" });
        child.once("error", reject);
        child.once("spawn", () => {
            child.unref();
            resolve();
        });
    });

/** The launcher's error message when it cannot start, else undefined. */
async function launchBrowser(target: string, launch: Launch, env: NodeJS.ProcessEnv): Promise<string | undefined> {
    const { program, args } = browserCommand(target, env);
    try {
        await launch(program, args);
        return undefined;
    } catch (error) {
        return errorMessage(error);
    }
}

const isWebAddress = (target: string): boolean => /^https?:\/\//i.test(target);

/**
 * Opens a page in the browser and says how it went, in a line the review screen can show. `target` is an http address,
 * or the path of a file (opened by its file address). The launcher starting is all that can be known: the line says the
 * browser was asked, and gives the address so the user can open it by hand.
 */
export async function openInBrowser(
    target: string,
    launch: Launch = launchDetached,
    env: NodeJS.ProcessEnv = process.env,
): Promise<string> {
    const address = isWebAddress(target) ? target : pathToFileURL(target).href;
    const failure = await launchBrowser(address, launch, env);
    return failure === undefined
        ? `opened in the browser: ${address}`
        : `could not open the browser: ${failure} (the address is ${address})`;
}

/** Whether Pi runs under WSL. The interop file or "microsoft" in the kernel's version say so; `WSL_DISTRO_NAME` is not
 *  used, because a shell started over SSH does not have it. */
export function runsUnderWsl(
    exists: (file: string) => boolean = existsSync,
    read: (file: string) => string = (file) => readFileSync(file, "utf8"),
): boolean {
    if (exists("/proc/sys/fs/binfmt_misc/WSLInterop")) return true;
    try {
        return /microsoft/i.test(read("/proc/version"));
    } catch {
        return false;
    }
}

/** Whether the browser is started by a Windows program, which cannot open a file of this system's: its program is an
 *  `.exe`, `.cmd` or `.bat`, or is under `/mnt/<drive>/`, or Pi runs under WSL (a wrapper script hides what it calls). */
export function opensInWindows(env: NodeJS.ProcessEnv, wsl: boolean): boolean {
    if (wsl) return true;
    const { program } = browserCommand("", env);
    return /\.(?:exe|cmd|bat|com)$/i.test(program) || /^\/mnt\/[a-z]\//i.test(program) || program.includes("\\");
}

export interface OpenPreviewDeps {
    server: PreviewServer;
    /** The configured theme for this page; system when absent. */
    theme?: ThemeChoice;
    launch?: Launch;
    env?: NodeJS.ProcessEnv;
    /** Whether Pi runs under WSL. Default: looked up. */
    wsl?: boolean;
}

/**
 * The `o` key: serves the preview over http and opens it. When the server cannot listen, it falls back to a file under
 * the state folder, and the line says so. That fallback is never used when a Windows browser would open it (under WSL, or
 * with a Windows program as the opener): Windows cannot open the file, or raises a network-file security warning each
 * time. The line then says the server could not start, and nothing is launched.
 */
export async function openPreview(preview: Preview, header: string, deps: OpenPreviewDeps): Promise<string> {
    const launch = deps.launch ?? launchDetached;
    const env = deps.env ?? process.env;
    let address: string;
    try {
        address = await deps.server.serve(renderPreviewPage(preview, header, deps.theme ?? "system"));
    } catch (serverError) {
        const why = `the local preview server could not start: ${errorMessage(serverError)}`;
        if (opensInWindows(env, deps.wsl ?? runsUnderWsl()))
            return `could not open the browser: ${why} (a file address is not tried here: a Windows browser cannot open it)`;
        const file = pathToFileURL(writePreviewPage(preview, header, deps.theme ?? "system")).href;
        const failure = await launchBrowser(file, launch, env);
        return failure === undefined
            ? `opened the page as a file, not over http (${why}): ${file}`
            : `could not open the browser: ${failure} (${why}; the file is ${file})`;
    }
    return openInBrowser(address, launch, env);
}
