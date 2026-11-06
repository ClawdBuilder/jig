// What npm actually publishes: the CLI, every plugin Pi loads, and the review page's built files, without the tests.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

const ROOT = path.resolve(import.meta.dirname, "..");
const PI_CLI = path.join(ROOT, "node_modules/@earendil-works/pi-coding-agent/dist/bundle/cli.js");
const FIXTURE = path.join(ROOT, "plugins/jig-core/test/fixtures/faux-tools.mjs");

function walk(dir: string): string[] {
    if (!existsSync(dir)) return [];
    const out: string[] = [];
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const file = path.join(dir, entry.name);
        if (entry.isDirectory()) out.push(...walk(file));
        else out.push(file);
    }
    return out;
}

/** Runtime modules: every plugin entry and src file, where relative paths are resolved from. */
function runtimeSources(): string[] {
    const plugins = path.join(ROOT, "plugins");
    return readdirSync(plugins, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .flatMap((entry) => {
            const base = path.join(plugins, entry.name);
            const index = path.join(base, "index.ts");
            return [
                ...(existsSync(index) ? [index] : []),
                ...walk(path.join(base, "src")).filter((file) => file.endsWith(".ts")),
            ];
        });
}

/** Every existing path a runtime module resolves relative to itself, as tarball paths. */
function runtimeFiles(): Array<{ source: string; file: string }> {
    const patterns = [
        /new URL\(\s*["'](\.\.[^"']*)["']\s*,\s*import\.meta\.url\s*\)/g,
        /path\.resolve\(\s*path\.dirname\(fileURLToPath\(import\.meta\.url\)\)\s*,\s*["'](\.\.[^"']*)["']\s*\)/g,
        /path\.resolve\(\s*import\.meta\.dirname\s*,\s*["'](\.\.[^"']*)["']\s*\)/g,
    ];
    const found = new Map<string, { source: string; file: string }>();
    for (const source of runtimeSources()) {
        const text = readFileSync(source, "utf8");
        for (const pattern of patterns) {
            pattern.lastIndex = 0;
            for (let match = pattern.exec(text); match !== null; match = pattern.exec(text)) {
                const resolved = path.resolve(path.dirname(source), match[1] as string);
                const relative = path.relative(ROOT, resolved);
                if (relative.startsWith("..")) continue;
                const files = statSync(resolved).isDirectory()
                    ? walk(resolved).filter((file) => !file.includes(`${path.sep}node_modules${path.sep}`))
                    : [resolved];
                for (const file of files) {
                    const packed = path.relative(ROOT, file).split(path.sep).join("/");
                    found.set(packed, { source: path.relative(ROOT, source), file: packed });
                }
            }
        }
    }
    return [...found.values()];
}

function pack(): Promise<{ name: string; version: string; files: string[] }> {
    return new Promise((resolve, reject) => {
        const child = spawn("npm", ["pack", "--dry-run", "--json"], { cwd: ROOT });
        let out = "";
        child.stdout.on("data", (chunk: Buffer) => (out += chunk.toString()));
        child.on("error", reject);
        child.on("close", (code) => {
            if (code !== 0) {
                reject(new Error(`npm pack exited ${code}: ${out.slice(-500)}`));
                return;
            }
            const parsed = JSON.parse(out) as
                | Array<{ name: string; version: string; files: Array<{ path: string }> }>
                | Record<string, { name: string; version: string; files: Array<{ path: string }> }>;
            const one = (Array.isArray(parsed) ? parsed[0] : Object.values(parsed)[0]) as
                | { name: string; version: string; files: Array<{ path: string }> }
                | undefined;
            if (one === undefined) {
                reject(new Error("npm pack returned nothing"));
                return;
            }
            resolve({ name: one.name, version: one.version, files: one.files.map((file) => file.path) });
        });
    });
}

test("the npm tarball has the command and the plugins, and no tests", { timeout: 60_000 }, async () => {
    const result = await pack();
    assert.equal(result.name, "@clawdbuilder/jig");
    assert.match(result.version, /^\d+\.\d+\.\d+$/);
    const has = (pattern: RegExp): boolean => result.files.some((file) => pattern.test(file));
    assert.ok(has(/^bin\/jig\.mjs$/), "the command");
    assert.ok(has(/^plugins\/jig-core\/index\.ts$/), "the core plugin");
    assert.ok(has(/^plugins\/jig-core\/src\//), "the core sources");
    assert.ok(has(/^plugins\/jig-review\/web\/dist\/index\.html$/), "the review page");
    assert.ok(!result.files.some((file) => /\/test\/|^test\//.test(file)), "no tests");
    assert.ok(!result.files.some((file) => file.startsWith("local/")), "nothing local");
});

test("every path a runtime module resolves beside itself is in the tarball", { timeout: 60_000 }, async () => {
    const packed = new Set((await pack()).files);
    const missing = runtimeFiles().filter((entry) => !packed.has(entry.file));
    assert.deepEqual(
        missing,
        [],
        `missing from the tarball: ${missing.map((entry) => `${entry.file} (from ${entry.source})`).join(", ")}`,
    );
});

function run(
    command: string,
    args: string[],
    options: { cwd: string; env?: NodeJS.ProcessEnv },
): Promise<{
    code: number | null;
    stdout: string;
    stderr: string;
}> {
    return new Promise((resolve, reject) => {
        const child = spawn(command, args, { cwd: options.cwd, env: options.env });
        let stdout = "";
        let stderr = "";
        child.stdout.on("data", (chunk: Buffer) => (stdout += chunk.toString()));
        child.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString()));
        child.on("error", reject);
        child.on("close", (code) => resolve({ code, stdout, stderr }));
    });
}

test("the packed tarball runs bash in stock Pi, from a path with a space", { timeout: 240_000 }, async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "jig-package-e2e-"));
    const prefix = path.join(dir, "prefix with space");
    const home = path.join(dir, "home");
    const agent = path.join(home, ".pi/agent");
    const work = path.join(home, "work");
    mkdirSync(prefix, { recursive: true });
    mkdirSync(agent, { recursive: true });
    mkdirSync(work, { recursive: true });

    const packed = await run("npm", ["pack", "--json", "--pack-destination", dir], { cwd: ROOT });
    assert.equal(packed.code, 0, packed.stderr);
    const packedJson = JSON.parse(packed.stdout) as Array<{ filename: string }> | Record<string, { filename: string }>;
    const packedOne = (Array.isArray(packedJson) ? packedJson[0] : Object.values(packedJson)[0]) as
        | { filename: string }
        | undefined;
    const tarball = path.join(dir, packedOne?.filename ?? "");
    assert.ok(existsSync(tarball), "npm pack wrote a tarball");

    const installed = await run(
        "npm",
        ["install", "-g", "--prefix", prefix, tarball, "--no-audit", "--no-fund", "--ignore-scripts"],
        { cwd: ROOT },
    );
    assert.equal(installed.code, 0, installed.stderr);
    const pkg = path.join(prefix, "lib/node_modules/@clawdbuilder/jig");
    assert.ok(existsSync(path.join(pkg, "package.json")), "the tarball installed under the scoped name");

    writeFileSync(path.join(agent, "trust.json"), JSON.stringify({ [work]: true }));
    writeFileSync(path.join(agent, "settings.json"), JSON.stringify({ packages: [pkg], extensions: [FIXTURE] }));

    const env: NodeJS.ProcessEnv = {
        ...process.env,
        HOME: home,
        PI_CODING_AGENT_DIR: agent,
        PI_OFFLINE: "1",
        PROBE_TOOLS: JSON.stringify([{ tool: "bash", args: { command: "printf ok > ran.txt" } }]),
    };
    delete env.AWS_PROFILE;

    const result = await new Promise<{ code: number | null; output: string }>((resolve, reject) => {
        const child = spawn(process.execPath, [PI_CLI, "--mode", "rpc", "--model", "faux/faux-1"], {
            cwd: work,
            env,
        });
        let buffer = "";
        let output = "";
        const done = (code: number | null): void => {
            child.kill();
            resolve({ code, output });
        };
        child.stdout.on("data", (chunk: Buffer) => {
            buffer += chunk.toString();
            let index = buffer.indexOf("\n");
            while (index >= 0) {
                const line = buffer.slice(0, index).trim();
                buffer = buffer.slice(index + 1);
                index = buffer.indexOf("\n");
                if (line === "") continue;
                try {
                    const event = JSON.parse(line) as {
                        type?: string;
                        message?: { role?: string; content?: Array<{ text?: string }> };
                    };
                    if (event.type === "message_end" && event.message?.role === "toolResult") {
                        output = (event.message.content ?? []).map((part) => part.text ?? "").join("\n");
                        done(0);
                    }
                } catch {
                    // Other JSON lines are not this test's business.
                }
            }
        });
        child.on("error", reject);
        child.on("close", (code) => done(code));
        child.stdin.write(JSON.stringify({ id: "1", type: "prompt", message: "go" }) + "\n");
        setTimeout(() => done(null), 120_000).unref();
    });

    assert.ok(existsSync(path.join(work, "ran.txt")), `bash ran through the sandbox; tool said: ${result.output}`);
    assert.equal(readFileSync(path.join(work, "ran.txt"), "utf8"), "ok");
    assert.doesNotMatch(result.output, /sandbox could not start|Cannot find module/);
});
