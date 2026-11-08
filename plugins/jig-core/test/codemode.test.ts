// Stock Pi with codemode on, a scripted model, and a read-only role: the codemode call itself is a read, a read inside
// the script runs, and a write inside it is refused by the role gate. A second run narrows the child's tools and checks
// that the script cannot reach one that was not given.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, test } from "node:test";
import { writeRolePolicy } from "../src/kit/role-policy.ts";

const ROOT = path.resolve(import.meta.dirname, "../../..");
const PI_CLI = path.join(ROOT, "node_modules/@earendil-works/pi-coding-agent/dist/bundle/cli.js");
const MODEL = path.resolve(import.meta.dirname, "../../jig-agents/test/support/scripted-model.ts");
const PROD = path.resolve(import.meta.dirname, "fixtures/codemode-prod.mjs");

let home: string;
let agent: string;
let work: string;

beforeEach(() => {
    home = mkdtempSync(path.join(tmpdir(), "jig-codemode-"));
    agent = path.join(home, ".pi/agent");
    work = path.join(home, "work");
    mkdirSync(agent, { recursive: true });
    mkdirSync(work, { recursive: true });
    writeFileSync(path.join(work, "note.txt"), "hello from the file\n");
    writeFileSync(
        path.join(agent, "settings.json"),
        JSON.stringify({
            defaultTools: ["+codemode"],
            codemode: { mode: "on" },
            packages: [
                {
                    source: ROOT,
                    extensions: ["plugins/jig-core/index.ts", "plugins/jig-agents/index.ts"],
                    skills: [],
                    prompts: [],
                    themes: [],
                },
            ],
            extensions: [MODEL, PROD],
        }),
    );
    writeFileSync(path.join(agent, "jig.json"), "{}");
});
afterEach(() => rmSync(home, { recursive: true, force: true }));

function run(script: unknown[], extraFlags: string[] = []): Promise<string> {
    const file = path.join(home, "model-script.json");
    writeFileSync(file, JSON.stringify({ steps: script }));
    const child = spawn(
        process.execPath,
        [PI_CLI, "--mode", "rpc", "--model", "faux/faux-1", "--no-approve", ...extraFlags],
        {
            cwd: work,
            env: {
                ...process.env,
                HOME: home,
                PI_CODING_AGENT_DIR: agent,
                PI_FAKE_MODEL_SCRIPT: file,
                PI_OFFLINE: "1",
                JIG_ROLE_POLICY: writeRolePolicy({
                    role: "tester",
                    writes: false,
                    actions: {},
                    ask: {},
                }),
            },
        },
    );
    let buffer = "";
    let settled: (() => void) | undefined;
    const results: string[] = [];
    let stderr = "";
    child.stderr.on("data", (chunk: Buffer) => {
        stderr += chunk.toString();
    });
    const done = new Promise<void>((resolve) => {
        settled = resolve;
    });
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
                if (record.type === "agent_settled") settled?.();
                if (record.type === "message_end" && record.message?.role === "toolResult") {
                    results.push((record.message.content ?? []).map((part) => part.text ?? "").join("\n"));
                }
            } catch {
                // Not a JSON-RPC line.
            }
        }
    });
    child.stdin.write(`${JSON.stringify({ id: "1", type: "prompt", message: "go" })}\n`);
    return Promise.race([
        done.then(() => {
            child.kill();
            return results.join("\n");
        }),
        new Promise<string>((_resolve, reject) =>
            setTimeout(() => {
                child.kill();
                reject(new Error(`no answer. stderr: ${stderr.slice(-400)}`));
            }, 60_000),
        ),
    ]);
}

describe("codemode under Jig", () => {
    test("the codemode call is a read; a nested read runs and a nested write is refused", {
        timeout: 90_000,
    }, async () => {
        const text = await run([
            {
                tool: "codemode",
                args: {
                    code: [
                        'const read = await tools.read({ path: "note.txt" });',
                        "let write;",
                        'try { write = await tools.write({ path: "planted.txt", content: "no" }); }',
                        "catch (error) { write = String(error); }",
                        "return [read, write];",
                    ].join("\n"),
                },
            },
            { text: "done" },
        ]);
        assert.match(text, /hello from the file/);
        assert.match(text, /may not write/);
    });

    test("a production read inside the script is masked before the script sees it", { timeout: 90_000 }, async () => {
        const text = await run([
            {
                tool: "codemode",
                args: {
                    code: "return await tools.prod_read_tool({});",
                },
            },
            { text: "done" },
        ]);
        assert.doesNotMatch(text, /jane@example\.com/);
        assert.doesNotMatch(text, /\+1 415 555 0100/);
        assert.match(text, /email#/);
        assert.match(text, /phone#/);
    });

    test("a tool outside the --tools list is not reachable from the script", { timeout: 90_000 }, async () => {
        const text = await run(
            [
                {
                    tool: "codemode",
                    args: {
                        code: 'return Object.keys(tools).join(",");',
                    },
                },
                { text: "done" },
            ],
            ["--tools", "read,codemode"],
        );
        assert.match(text, /read/);
        assert.doesNotMatch(text, /write/);
    });
});
