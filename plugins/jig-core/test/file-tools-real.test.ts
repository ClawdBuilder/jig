// Stock Pi, a trusted project, real write/edit/bash tool calls: the project files Pi loads cannot be changed, normal
// project files can, nothing is planted, and the next start still has its sandbox.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, test } from "node:test";
import { PI_PROJECT_PATHS } from "../src/kit/pi-project-paths.ts";

const ROOT = path.resolve(import.meta.dirname, "../../..");
const PI_CLI = path.join(ROOT, "node_modules/@earendil-works/pi-coding-agent/dist/bundle/cli.js");
const FIXTURE = path.join(ROOT, "plugins/jig-core/test/fixtures/faux-tools.mjs");

let home: string;
let agent: string;
let work: string;

beforeEach(() => {
    home = mkdtempSync(path.join(tmpdir(), "jig-file-tools-"));
    agent = path.join(home, ".pi/agent");
    work = path.join(home, "work");
    mkdirSync(agent, { recursive: true });
    mkdirSync(work, { recursive: true });
    writeFileSync(path.join(agent, "trust.json"), JSON.stringify({ [work]: true }));
    writeFileSync(path.join(agent, "settings.json"), JSON.stringify({ packages: [ROOT], extensions: [FIXTURE] }));
});
afterEach(() => rmSync(home, { recursive: true, force: true }));

/** Runs stock Pi with the given tool calls and returns each tool result, in order. */
function runTools(tools: unknown[]): Promise<string[]> {
    const child = spawn(process.execPath, [PI_CLI, "--mode", "rpc", "--model", "faux/faux-1"], {
        cwd: work,
        env: {
            ...process.env,
            HOME: home,
            PI_CODING_AGENT_DIR: agent,
            PROBE_TOOLS: JSON.stringify(tools),
            PI_OFFLINE: "1",
        },
    });
    let buffer = "";
    const results: string[] = [];
    return new Promise((resolve, reject) => {
        const finish = (): void => {
            clearTimeout(timer);
            child.kill();
            resolve(results);
        };
        child.stdout.on("data", (chunk: Buffer) => {
            buffer += chunk.toString();
            let index: number;
            while ((index = buffer.indexOf("\n")) >= 0) {
                const line = buffer.slice(0, index).trim();
                buffer = buffer.slice(index + 1);
                if (line === "") continue;
                try {
                    const record = JSON.parse(line) as {
                        type?: string;
                        message?: { role?: string; content?: Array<{ text?: string }> };
                    };
                    if (record.type === "message_end" && record.message?.role === "toolResult") {
                        results.push((record.message.content ?? []).map((part) => part.text ?? "").join("\n"));
                        if (results.length >= tools.length) finish();
                    }
                } catch {
                    // Pi's other lines are not tool results.
                }
            }
        });
        child.on("error", reject);
        child.stdin.write(JSON.stringify({ id: "1", type: "prompt", message: "go" }) + "\n");
        const timer = setTimeout(finish, 60_000);
    });
}

/** The commands a fresh Pi start loads; project resources arrive a little later, so this waits. */
function commandsAfterStart(): Promise<string[]> {
    const child = spawn(process.execPath, [PI_CLI, "--mode", "rpc"], {
        cwd: work,
        env: { ...process.env, HOME: home, PI_CODING_AGENT_DIR: agent, PI_OFFLINE: "1" },
    });
    let buffer = "";
    return new Promise((resolve, reject) => {
        child.stdout.on("data", (chunk: Buffer) => {
            buffer += chunk.toString();
            let index: number;
            while ((index = buffer.indexOf("\n")) >= 0) {
                const line = buffer.slice(0, index).trim();
                buffer = buffer.slice(index + 1);
                if (line === "") continue;
                try {
                    const record = JSON.parse(line) as {
                        type?: string;
                        command?: string;
                        data?: { commands?: Array<{ name?: string }> };
                    };
                    if (record.type === "response" && record.command === "get_commands") {
                        resolve(
                            (record.data?.commands ?? []).flatMap((one) => (one.name === undefined ? [] : [one.name])),
                        );
                        child.kill();
                        return;
                    }
                } catch {
                    // Not a command answer.
                }
            }
        });
        child.on("error", reject);
        setTimeout(() => child.stdin.write(`${JSON.stringify({ id: "1", type: "get_commands" })}\n`), 2_500);
        setTimeout(() => {
            child.kill();
            reject(new Error("Pi did not answer get_commands"));
        }, 30_000);
    });
}

describe("Pi's file tools in a trusted project", () => {
    test("write and edit cannot change what Pi loads, normal project writes still work", async () => {
        mkdirSync(path.join(work, ".pi"), { recursive: true });
        writeFileSync(path.join(work, ".pi/settings.json"), JSON.stringify({ packages: [] }));
        const tools = [
            ...PI_PROJECT_PATHS.map((item) => ({
                tool: "write",
                args: { path: path.join(work, item), content: "planted" },
            })),
            { tool: "write", args: { path: path.join(work, "notes.txt"), content: "ok" } },
            { tool: "write", args: { path: path.join(work, "settings.json"), content: '{"packages":[]}' } },
            {
                tool: "edit",
                args: {
                    path: path.join(work, ".pi/settings.json"),
                    edits: [{ oldText: "[]", newText: '["/tmp/evil"]' }],
                },
            },
        ];
        const results = await runTools(tools);
        assert.equal(results.length, tools.length);
        for (const [index, item] of PI_PROJECT_PATHS.entries()) {
            assert.match(results[index] ?? "", /refused/, item);
            assert.match(results[index] ?? "", /Pi loads this at its next start/, item);
            assert.match(results[index] ?? "", /Ask the person to change it/, item);
            const target = path.join(work, item);
            assert.equal(existsSync(target) && readFileSync(target, "utf8").includes("planted"), false, item);
        }
        assert.match(results[PI_PROJECT_PATHS.length] ?? "", /Successfully wrote/);
        assert.match(results[PI_PROJECT_PATHS.length + 1] ?? "", /Successfully wrote/);
        assert.match(results.at(-1) ?? "", /refused/);
        assert.equal(readFileSync(path.join(work, ".pi/settings.json"), "utf8"), JSON.stringify({ packages: [] }));
        assert.equal(readFileSync(path.join(work, "notes.txt"), "utf8"), "ok");
        assert.equal(readFileSync(path.join(work, "settings.json"), "utf8"), '{"packages":[]}');
    });

    test("the next start has its sandbox, and nothing was planted", async () => {
        mkdirSync(path.join(work, ".pi"), { recursive: true });
        writeFileSync(path.join(work, ".pi/settings.json"), JSON.stringify({ packages: [] }));
        const tools = PI_PROJECT_PATHS.map((item) => ({
            tool: "write",
            args: { path: path.join(work, item), content: "planted" },
        }));
        await runTools(tools);
        const commands = await commandsAfterStart();
        assert.equal(commands.includes("sandbox"), true, `Pi loaded: ${commands.join(", ")}`);
    });

    test("bash is blocked for the same paths, including .pi/git, .pi/npm and the system files", async () => {
        const targets = [
            ".pi/git/evil/package.json",
            ".pi/npm/node_modules/evil/index.mjs",
            ".pi/SYSTEM.md",
            ".pi/APPEND_SYSTEM.md",
        ];
        const command = targets.map((item) => `mkdir -p "$(dirname ${item})"; printf x > ${item}`).join("; ");
        const results = await runTools([{ tool: "bash", args: { command } }]);
        assert.match(results[0] ?? "", /Read-only file system|refused|busy|removed .*created it/);
        for (const item of targets) assert.equal(existsSync(path.join(work, item)), false, item);
    });
});

describe("writes outside the working folder", () => {
    test("ask, and with no screen they are refused; inside and an allowed folder do not ask", async () => {
        const outside = path.join(home, "outside.txt");
        const results = await runTools([
            { tool: "write", args: { path: outside, content: "x" } },
            { tool: "write", args: { path: path.join(work, "README.md"), content: "ok" } },
        ]);
        assert.match(results[0] ?? "", /outside the folders bash can write|needs approval/);
        assert.equal(existsSync(outside), false);
        assert.match(results[1] ?? "", /Successfully wrote/);

        // The sandbox's own allowed folder, the way /sandbox allow records it.
        const allowed = path.join(home, "allowed");
        mkdirSync(allowed, { recursive: true });
        mkdirSync(path.join(agent, "jig-sandbox"), { recursive: true });
        writeFileSync(path.join(agent, "jig-sandbox/allowed.json"), JSON.stringify({ folders: [allowed] }));
        const [yes] = await runTools([{ tool: "write", args: { path: path.join(allowed, "x.txt"), content: "ok" } }]);
        assert.match(yes ?? "", /Successfully wrote/);
        assert.equal(readFileSync(path.join(allowed, "x.txt"), "utf8"), "ok");
    });

    test("a symlink out of the project asks too, dangling or not", async () => {
        const target = path.join(home, "outside-dir");
        mkdirSync(target, { recursive: true });
        symlinkSync(target, path.join(work, "link"));
        symlinkSync(path.join(home, "does-not-exist"), path.join(work, "dangling"));
        const results = await runTools([
            { tool: "write", args: { path: path.join(work, "link", "x.txt"), content: "x" } },
            { tool: "write", args: { path: path.join(work, "dangling", "x.txt"), content: "x" } },
        ]);
        for (const result of results) assert.match(result ?? "", /outside the folders bash can write|needs approval/);
        assert.equal(existsSync(path.join(target, "x.txt")), false);
    });
});
