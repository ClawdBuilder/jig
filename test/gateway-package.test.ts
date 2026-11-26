// The gateway as a person gets it from npm: pack the package, install the tarball under a prefix of its own with no install scripts, and start the command that
// npm linked into the prefix's bin folder, `jig-gateway`. It answers --version and a server/discover on revision 2026-07-28, and leaves when its input ends. It needs
// the network, as the install case of package.test.ts does: the install fetches the package's own dependencies, which the built gateway does not need and does not use.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

const ROOT = path.resolve(import.meta.dirname, "..");
const VERSION = (JSON.parse(readFileSync(path.join(ROOT, "package.json"), "utf8")) as { version: string }).version;
/** The first request a client of revision 2026-07-28 sends: it asks what the server speaks. */
const DISCOVER = {
    jsonrpc: "2.0",
    id: 1,
    method: "server/discover",
    params: {
        _meta: {
            "io.modelcontextprotocol/protocolVersion": "2026-07-28",
            "io.modelcontextprotocol/clientCapabilities": {},
            "io.modelcontextprotocol/clientInfo": { name: "claude-code", version: "2.1.332" },
        },
    },
};

interface Finished {
    code: number | null;
    stdout: string;
    stderr: string;
}

/** Runs a program with no input and waits for it to leave. */
function run(command: string, args: string[], options: { cwd: string; env?: NodeJS.ProcessEnv }): Promise<Finished> {
    return new Promise((resolve, reject) => {
        const child = spawn(command, args, { cwd: options.cwd, env: options.env, stdio: ["ignore", "pipe", "pipe"] });
        let stdout = "";
        let stderr = "";
        const timer = setTimeout(() => child.kill(), 120_000);
        child.stdout.on("data", (chunk: Buffer) => (stdout += chunk.toString()));
        child.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString()));
        child.on("error", reject);
        child.on("close", (code) => {
            clearTimeout(timer);
            resolve({ code, stdout, stderr });
        });
    });
}

/** Starts a program that speaks MCP, sends one request, waits for its answer, ends the input, and waits for the program to leave. */
function ask(command: string, request: object, options: { cwd: string; env: NodeJS.ProcessEnv }): Promise<Finished> {
    return new Promise((resolve, reject) => {
        const child = spawn(command, [], { cwd: options.cwd, env: options.env, stdio: ["pipe", "pipe", "pipe"] });
        let stdout = "";
        let stderr = "";
        const timer = setTimeout(() => child.kill(), 120_000);
        child.stdout.on("data", (chunk: Buffer) => {
            stdout += chunk.toString();
            // The server aborts a request it is still answering when its input ends, so the input ends after the answer.
            if (stdout.includes("\n")) child.stdin.end();
        });
        child.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString()));
        child.on("error", reject);
        child.on("close", (code) => {
            clearTimeout(timer);
            resolve({ code, stdout, stderr });
        });
        child.stdin.write(`${JSON.stringify(request)}\n`);
    });
}

test("the installed command jig-gateway prints its version and answers server/discover from a bare install", {
    timeout: 240_000,
}, async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "jig-gateway-package-"));
    try {
        const prefix = path.join(dir, "prefix with space");
        const work = path.join(dir, "work");
        mkdirSync(prefix, { recursive: true });
        mkdirSync(work, { recursive: true });

        const packed = await run("npm", ["pack", "--json", "--pack-destination", dir], { cwd: ROOT });
        assert.equal(packed.code, 0, packed.stderr);
        const parsed = JSON.parse(packed.stdout) as Array<{ filename: string }> | Record<string, { filename: string }>;
        const one = (Array.isArray(parsed) ? parsed[0] : Object.values(parsed)[0]) as { filename: string } | undefined;
        const tarball = path.join(dir, one?.filename ?? "");
        assert.ok(existsSync(tarball), "npm pack wrote a tarball");

        const installed = await run(
            "npm",
            ["install", "-g", "--prefix", prefix, tarball, "--no-audit", "--no-fund", "--ignore-scripts"],
            { cwd: ROOT },
        );
        assert.equal(installed.code, 0, installed.stderr);

        const command = path.join(prefix, "bin/jig-gateway");
        assert.ok(existsSync(command), "npm linked the command into the bin folder of the prefix");
        const env: NodeJS.ProcessEnv = { ...process.env, JIG_HOME: "" };
        delete env.PI_HOST_DIR;

        const version = await run(command, ["--version"], { cwd: work, env });
        assert.equal(version.code, 0, version.stderr);
        assert.equal(version.stdout, `${VERSION}\n`);

        const discovered = await ask(command, DISCOVER, { cwd: work, env });
        assert.equal(discovered.code, 0, discovered.stderr);
        const lines = discovered.stdout.split("\n").filter((line) => line !== "");
        assert.equal(lines.length, 1, "one answer, and nothing else on standard output");
        const answer = JSON.parse(lines[0] ?? "") as { id: number; result: { supportedVersions: string[] } };
        assert.equal(answer.id, 1);
        assert.deepEqual(answer.result.supportedVersions, ["2026-07-28"]);
        assert.equal(discovered.stderr, "");
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
});
