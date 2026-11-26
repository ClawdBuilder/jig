// The gateway as a child process, and the way to speak to it: one JSON object on each line of its standard input and output, with the envelope of revision
// 2026-07-28 on every request, as Claude Code speaks to it. gateway-process.test.ts starts the gateway from source and the built file with it, and
// gateway-build.test.ts starts the built file in a folder with nothing installed.
import { spawn } from "node:child_process";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import assert from "node:assert/strict";
import path from "node:path";

/** The guard that refuses every Pi package (test/support/refuse-pi.mjs). It is plain JavaScript, so it loads in front of the built file too. */
export const REFUSE_PI = path.resolve(import.meta.dirname, "../../../../test/support/refuse-pi.mjs");

export type Message = Record<string, unknown>;

/** The lines a process wrote to standard output that are not JSON-RPC messages: not JSON, not an object, or not version 2.0 of JSON-RPC. */
export function notJsonRpc(lines: readonly string[]): string[] {
    return lines.filter((line) => {
        try {
            const message = JSON.parse(line) as Message;
            return typeof message !== "object" || message === null || message.jsonrpc !== "2.0";
        } catch {
            return true;
        }
    });
}

export const resultOf = (message: Message) => message.result as Message;
export const textOf = (message: Message) =>
    ((resultOf(message).content as Array<{ text: string }>)[0] as { text: string }).text;

export interface GatewayStart {
    /** The file node starts: `main.ts` from source, or the built `jig-gateway.mjs`. */
    file: string;
    cwd: string;
    env: NodeJS.ProcessEnv;
    args?: string[];
    /** Start with the guard that refuses every Pi package. */
    guard?: boolean;
}

/** The gateway as a child process, and the way to speak to it. */
export class GatewayProcess {
    readonly child: ChildProcessWithoutNullStreams;
    /** Every line written to standard output, as text. */
    readonly lines: string[] = [];
    /** Every message that was not the answer to a request: the notices. */
    readonly notices: Message[] = [];
    stderr = "";
    private readonly waiting = new Map<number, (message: Message) => void>();
    private buffer = "";
    private next = 0;
    readonly exited: Promise<{ code: number | null; signal: NodeJS.Signals | null }>;

    constructor(options: GatewayStart) {
        // Pi must not be findable either, in case the guard were gone.
        const env = { ...options.env };
        delete env.PI_HOST_DIR;
        const guard = options.guard === false ? [] : ["--import", REFUSE_PI];
        this.child = spawn(process.execPath, [...guard, options.file, ...(options.args ?? [])], {
            cwd: options.cwd,
            env,
            stdio: ["pipe", "pipe", "pipe"],
        });
        this.child.stdout.on("data", (chunk: Buffer) => this.read(chunk.toString("utf8")));
        this.child.stderr.on("data", (chunk: Buffer) => {
            this.stderr += chunk.toString("utf8");
        });
        this.exited = new Promise((resolve) => this.child.once("close", (code, signal) => resolve({ code, signal })));
    }

    kill(): void {
        this.child.kill();
    }

    private read(text: string): void {
        this.buffer += text;
        for (let end = this.buffer.indexOf("\n"); end >= 0; end = this.buffer.indexOf("\n")) {
            const line = this.buffer.slice(0, end);
            this.buffer = this.buffer.slice(end + 1);
            if (line === "") continue;
            this.lines.push(line);
            let message: Message;
            try {
                message = JSON.parse(line) as Message;
            } catch {
                continue;
            }
            const answer = typeof message.id === "number" ? this.waiting.get(message.id) : undefined;
            if (answer === undefined) this.notices.push(message);
            else answer(message);
        }
    }

    /** One request, with the envelope of revision 2026-07-28 that names the revision, the client and what it can show. */
    request(method: string, params: Message = {}, meta: Message = {}): Promise<Message> {
        this.next += 1;
        const id = this.next;
        const answered = new Promise<Message>((resolve, reject) => {
            const timer = setTimeout(
                () => reject(new Error(`no answer to ${method}; standard error: ${this.stderr}`)),
                20_000,
            );
            this.waiting.set(id, (message) => {
                clearTimeout(timer);
                resolve(message);
            });
        });
        const envelope = {
            "io.modelcontextprotocol/protocolVersion": "2026-07-28",
            "io.modelcontextprotocol/clientCapabilities": {},
            "io.modelcontextprotocol/clientInfo": { name: "claude-code", version: "2.1.332" },
            ...meta,
        };
        this.child.stdin.write(
            `${JSON.stringify({ jsonrpc: "2.0", id, method, params: { ...params, _meta: envelope } })}\n`,
        );
        return answered;
    }

    call(name: string, args: Message, meta: Message = {}): Promise<Message> {
        return this.request("tools/call", { name, arguments: args }, meta);
    }

    /** Ends the child's standard input, as an agent does when it is done, and waits for the child to leave. */
    async end(): Promise<{ code: number | null; signal: NodeJS.Signals | null }> {
        this.child.stdin.end();
        const timer = setTimeout(() => this.child.kill(), 5000);
        try {
            return await this.exited;
        } finally {
            clearTimeout(timer);
        }
    }
}

/** The child's standard error says nothing that looks like a crash, and nothing about a Pi package. */
export function assertQuietError(gateway: GatewayProcess): void {
    assert.doesNotMatch(gateway.stderr, /was imported in a process that has no Pi/);
    assert.doesNotMatch(gateway.stderr, /\n\s+at /, "no stack trace");
    assert.doesNotMatch(gateway.stderr, /Error/);
}
