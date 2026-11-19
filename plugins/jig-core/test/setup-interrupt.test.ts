// Ctrl+C in a real terminal while `jig setup` waits for something that is not a question: Pi's install, the relay's
// health check. The screen holds the keyboard in raw mode, so the key reaches Jig as a key and no signal is sent; Jig must
// hand the signal back, so the run ends at once as a plain Ctrl+C always has, and the key is never kept for a question
// that comes later.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import type { ChildProcess, ChildProcessWithoutNullStreams } from "node:child_process";
import { createServer } from "node:http";
import type { Server } from "node:http";
import {
    existsSync,
    mkdirSync,
    mkdtempSync,
    readFileSync,
    realpathSync,
    rmSync,
    symlinkSync,
    writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, test } from "node:test";
import { piHostDir } from "../../../test/support/pi-host-dir.mjs";
import { ptyArgv, ptyAvailable } from "../../../test/support/pty.ts";

const ROOT = path.resolve(import.meta.dirname, "../../..");
const BIN = path.join(ROOT, "bin/jig.mjs");
const ptySkip = ptyAvailable() ? false : "no usable pty on this machine";
const CTRL_C = "\u0003";

let home: string;
let agent: string;
let work: string;
let bin: string;
const children = new Set<ChildProcess>();
const servers = new Set<Server>();

beforeEach(() => {
    home = realpathSync(mkdtempSync(path.join(tmpdir(), "jig-interrupt-")));
    agent = path.join(home, ".jig");
    work = path.join(home, "work");
    bin = path.join(home, "bin");
    mkdirSync(agent, { recursive: true });
    mkdirSync(work, { recursive: true });
    mkdirSync(bin, { recursive: true });
});

afterEach(() => {
    for (const child of children) {
        try {
            if (child.pid !== undefined) process.kill(-child.pid, "SIGKILL");
        } catch {
            // Already gone.
        }
    }
    children.clear();
    for (const server of servers) server.closeAllConnections();
    for (const server of servers) server.close();
    servers.clear();
    rmSync(home, { recursive: true, force: true });
});

/** The home already has Jig (these tests run the checkout, which the home's copy links to) and a token file for a relay. */
function homeWithJig(): { tokenFile: string } {
    mkdirSync(path.join(agent, "npm", "node_modules", "@clawdbuilder"), { recursive: true });
    symlinkSync(ROOT, path.join(agent, "npm", "node_modules", "@clawdbuilder", "jig"), "dir");
    writeFileSync(path.join(agent, "settings.json"), JSON.stringify({ packages: [ROOT] }));
    const tokenFile = path.join(home, "relay-token");
    writeFileSync(tokenFile, "stand-in\n", { mode: 0o600 });
    return { tokenFile };
}

/** A relay on this machine that answers its health check, or accepts the request and never answers. */
async function loopbackRelay(answers: boolean): Promise<string> {
    const relay = createServer((_request, response) => {
        if (!answers) return;
        response.setHeader("content-type", "application/json");
        response.end(JSON.stringify({ ok: true, protocol: 1, service: "orders-api relay", services: { jira: true } }));
    });
    servers.add(relay);
    await new Promise<void>((resolve) => relay.listen(0, "127.0.0.1", resolve));
    const address = relay.address();
    return `http://127.0.0.1:${typeof address === "object" && address !== null ? address.port : 0}`;
}

/** A Pi package whose `install` takes a long time and says which process it is, as a download over a slow line would. */
function slowPi(): { host: string; pidFile: string } {
    const host = path.join(home, "slow-pi");
    const pidFile = path.join(home, "pi-install.pid");
    mkdirSync(path.join(host, "dist", "bundle"), { recursive: true });
    writeFileSync(
        path.join(host, "package.json"),
        JSON.stringify({ name: "@earendil-works/pi-coding-agent", version: "9.9.9", type: "module" }),
    );
    writeFileSync(
        path.join(host, "dist", "bundle", "cli.js"),
        [
            'import { writeFileSync } from "node:fs";',
            "const args = process.argv.slice(2);",
            'if (args[0] === "--version") { console.log("9.9.9"); process.exit(0); }',
            `writeFileSync(${JSON.stringify(pidFile)}, String(process.pid));`,
            'console.log("pi " + args.join(" ") + ": downloading, this takes a while");',
            "setTimeout(() => process.exit(0), 40000);",
            "",
        ].join("\n"),
    );
    // The program's own packages, as a global install lays them out beside it.
    symlinkSync(path.join(piHostDir, "node_modules"), path.join(host, "node_modules"), "dir");
    return { host, pidFile };
}

/** `jig setup` on a pseudo-terminal: the keys go in when their text appears, and Ctrl+C when its text does. */
function setupOnTerminal(
    steps: Array<{ when: string; send: string; after?: number }>,
    env: Record<string, string>,
    args: readonly string[] = [],
) {
    const child: ChildProcessWithoutNullStreams = spawn(
        "script",
        ptyArgv([process.execPath, BIN, "setup", "--bin", bin, ...args]),
        {
            cwd: work,
            detached: true,
            env: {
                ...process.env,
                HOME: home,
                JIG_HOME: agent,
                PI_CODING_AGENT_DIR: agent,
                LANG: "C",
                LC_ALL: "C",
                NO_COLOR: "1",
                TERM: "dumb",
                BROWSER: "true",
                ...env,
            },
        },
    );
    children.add(child);
    let out = "";
    let cursor = 0;
    let index = 0;
    let sentAt: number | undefined;
    return new Promise<{ code: number | null; out: string; afterKey: number }>((resolve, reject) => {
        const timer = setTimeout(() => {
            reject(new Error(`setup did not end; it said:\n${out}`));
        }, 30_000);
        const next = (): void => {
            const step = steps[index];
            if (step === undefined) return;
            const found = out.indexOf(step.when, cursor);
            if (found < 0) return;
            index++;
            cursor = found + step.when.length;
            setTimeout(() => {
                child.stdin.write(step.send === CTRL_C ? CTRL_C : `${step.send}\n`);
                if (step.send === CTRL_C) sentAt = Date.now();
                next();
            }, step.after ?? 50);
        };
        child.stdout.on("data", (chunk: Buffer) => {
            out += chunk.toString();
            next();
        });
        child.on("close", (code) => {
            clearTimeout(timer);
            resolve({ code, out, afterKey: sentAt === undefined ? -1 : Date.now() - sentAt });
        });
    });
}

describe("Ctrl+C while jig setup waits for something that is not a question", () => {
    test("during Pi's install it ends the run at once, and Pi's install with it", {
        timeout: 60_000,
        skip: ptySkip,
    }, async () => {
        const pi = slowPi();
        const result = await setupOnTerminal([{ when: "downloading", send: CTRL_C, after: 500 }], {
            JIG_PI_HOST: pi.host,
        });
        assert.ok(
            result.afterKey >= 0 && result.afterKey < 4000,
            `ended ${result.afterKey} ms after the key\n${result.out}`,
        );
        assert.equal(result.code, 130, "ended by the interrupt, as the shell reports it");
        assert.match(result.out, /\^C/);
        assert.equal(existsSync(path.join(agent, "jig.json")), false, "nothing was written");
        // The install was in the same terminal group: it does not go on downloading behind a finished command.
        const pid = Number(readFileSync(pi.pidFile, "utf8"));
        let alive = true;
        for (let wait = 0; wait < 20 && alive; wait++) {
            try {
                process.kill(pid, 0);
                await new Promise((resolve) => setTimeout(resolve, 100));
            } catch {
                alive = false;
            }
        }
        assert.equal(alive, false, "Pi's install is not left running");
    });

    test("during the relay's health check it ends the run, saying nothing was written, and is not kept for the question after it", {
        timeout: 60_000,
        skip: ptySkip,
    }, async () => {
        const { tokenFile } = homeWithJig();
        // A relay that accepts the request and never answers: the check gives up after about five seconds.
        const url = await loopbackRelay(false);
        const result = await setupOnTerminal(
            [
                { when: "What do you call this relay?", send: "orders-relay" },
                { when: "The relay's address", send: url },
                { when: "Where does the relay's token live?", send: "1" },
                { when: "Turn on files as a place Jig reads from?", send: "y" },
                { when: "Which file?", send: tokenFile },
                { when: "Checking the relay", send: CTRL_C, after: 400 },
            ],
            {},
            ["transports"],
        );
        // A key kept for the next question would wait out the check (five seconds) and then cancel "Relay not answering".
        assert.ok(
            result.afterKey >= 0 && result.afterKey < 2500,
            `ended ${result.afterKey} ms after the key\n${result.out}`,
        );
        assert.equal(result.code, 130);
        assert.doesNotMatch(result.out, /Relay not answering/);
        assert.match(result.out, /\^C\r?\nNothing was written\./);
        assert.equal(existsSync(path.join(agent, "jig.json")), false, "nothing was written");
    });
});

describe("Ctrl+C at the plugin list of a terminal", () => {
    /** The first visit to the list sets a relay up; the next Ctrl+C is what each test presses and answers. */
    async function relayThenCtrlC(after: Array<{ when: string; send: string; after?: number }>) {
        const { tokenFile } = homeWithJig();
        const url = await loopbackRelay(true);
        return setupOnTerminal(
            [
                { when: "which plugin do you want to set up?", send: "transports" },
                { when: "What do you call this relay?", send: "orders-relay" },
                { when: "The relay's address", send: url },
                { when: "Where does the relay's token live?", send: "1" },
                { when: "Turn on files as a place Jig reads from?", send: "y" },
                { when: "Which file?", send: tokenFile },
                { when: "(1 unsaved change)", send: CTRL_C, after: 200 },
                ...after,
            ],
            {},
        );
    }

    test("asks to save with Yes as the default: Enter goes to the review and the save", {
        timeout: 60_000,
        skip: ptySkip,
    }, async () => {
        const result = await relayThenCtrlC([
            { when: "Save the 1 change you made?", send: "" },
            { when: "Review these changes", send: "1" },
            { when: "Save these changes?", send: "y" },
        ]);
        assert.match(result.out, /Save the 1 change you made\?[\s\S]*\(Y\/n\) /);
        assert.equal(result.code, 0, result.out);
        const written = JSON.parse(readFileSync(path.join(agent, "jig.json"), "utf8")) as Record<string, any>;
        assert.equal(written.transports["orders-relay"].kind, "relay");
    });

    test("a second Ctrl+C there leaves without saving, and says so", { timeout: 60_000, skip: ptySkip }, async () => {
        const result = await relayThenCtrlC([{ when: "(Y/n) ", send: CTRL_C, after: 200 }]);
        assert.equal(result.code, 130, result.out);
        assert.match(result.out, /Nothing was written\./);
        assert.equal(existsSync(path.join(agent, "jig.json")), false, "nothing was written");
    });

    test("an n there leaves without saving too", { timeout: 60_000, skip: ptySkip }, async () => {
        const result = await relayThenCtrlC([{ when: "(Y/n) ", send: "n" }]);
        assert.equal(result.code, 130, result.out);
        assert.match(result.out, /Nothing was written\./);
        assert.equal(existsSync(path.join(agent, "jig.json")), false, "nothing was written");
    });
});
