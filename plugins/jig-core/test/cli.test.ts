// The `jig` command end to end, in a temporary home: a real child process, its own agent folder and settings, no Pi.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, test } from "node:test";

const ROOT = path.resolve(import.meta.dirname, "../../..");
const BIN = path.join(ROOT, "bin/jig.mjs");
const FIXTURE = path.join(ROOT, "plugins/jig-core/test/fixtures/cli-company");

let home: string;
let agent: string;
let work: string;

beforeEach(() => {
    home = mkdtempSync(path.join(tmpdir(), "jig-cli-"));
    agent = path.join(home, ".pi/agent");
    work = path.join(home, "work");
    mkdirSync(agent, { recursive: true });
    mkdirSync(work, { recursive: true });
});
afterEach(() => rmSync(home, { recursive: true, force: true }));

function env(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
    return { ...process.env, HOME: home, PI_CODING_AGENT_DIR: agent, ...extra };
}

function run(args: string[], options: { input?: string; tty?: boolean; env?: Record<string, string> } = {}) {
    const command = options.tty === true ? "script" : process.execPath;
    const argv =
        options.tty === true ? ["-qec", `${process.execPath} ${BIN} ${args.join(" ")}`, "/dev/null"] : [BIN, ...args];
    return new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve, reject) => {
        const child = spawn(command, argv, { cwd: work, env: env(options.env) });
        let stdout = "";
        let stderr = "";
        child.stdout.on("data", (chunk: Buffer) => (stdout += chunk.toString()));
        child.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString()));
        child.on("error", reject);
        child.on("close", (code) => resolve({ code, stdout, stderr }));
        if (options.input !== undefined) child.stdin.end(options.input);
    });
}

/** The setup prompts, answered when each one appears on the (pseudo-)terminal. */
function runSetup(expectations: Array<{ when: string; answer: string }>) {
    const child = spawn("script", ["-qec", `${process.execPath} ${BIN} setup`, "/dev/null"], {
        cwd: work,
        env: env(),
    });
    let stdout = "";
    let stderr = "";
    let index = 0;
    return new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve, reject) => {
        const next = (): void => {
            const expectationsAt = expectations[index];
            if (expectationsAt !== undefined && stdout.includes(expectationsAt.when)) {
                index++;
                setTimeout(() => child.stdin.write(`${expectationsAt.answer}\n`), 20);
            }
        };
        child.stdout.on("data", (chunk: Buffer) => {
            stdout += chunk.toString();
            next();
        });
        child.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString()));
        child.on("error", reject);
        child.on("close", (code) => resolve({ code, stdout, stderr }));
        const timeout = setTimeout(() => {
            child.kill();
            reject(new Error(`setup did not finish; it said:\n${stdout}\n${stderr}`));
        }, 30_000);
        child.on("close", () => clearTimeout(timeout));
    });
}

const settingsWith = (...packages: string[]): void =>
    writeFileSync(path.join(agent, "settings.json"), JSON.stringify({ packages }));

describe("jig doctor", () => {
    test("runs without Pi and exits 0 when nothing failed", async () => {
        const result = await run(["doctor", "--quiet"]);
        assert.equal(result.code, 0, result.stdout + result.stderr);
        assert.match(result.stdout, /Jig doctor/);
        assert.match(result.stdout, /All checks passed|Nothing is blocked/);
    });

    test("an invalid jig.json is a FAIL line in a report, not a crash", async () => {
        writeFileSync(path.join(agent, "jig.json"), "{ not json");
        const result = await run(["doctor", "--quiet"]);
        assert.equal(result.code, 1);
        assert.match(result.stdout, /fail The settings file cannot be read/);
        assert.match(result.stdout, /jig doctor again/);
    });

    test("a plugin that throws at load is a FAIL line naming it", async () => {
        const broken = path.join(home, "broken-package");
        mkdirSync(broken, { recursive: true });
        writeFileSync(
            path.join(broken, "package.json"),
            JSON.stringify({
                name: "jig-broken",
                version: "1.0.0",
                type: "module",
                pi: { extensions: ["./index.mjs"] },
            }),
        );
        writeFileSync(path.join(broken, "index.mjs"), 'throw new Error("boom at load");\n');
        settingsWith(broken);
        const result = await run(["doctor", "--quiet"]);
        assert.equal(result.code, 1);
        assert.match(result.stdout, /fail jig-broken|fail .*broken-package/);
        assert.match(result.stdout, /boom at load/);
    });

    test("--json prints the report and keeps the exit code", async () => {
        writeFileSync(path.join(agent, "jig.json"), "{ not json");
        const result = await run(["doctor", "--json"]);
        assert.equal(result.code, 1);
        const report = JSON.parse(result.stdout) as { lines: Array<{ level: string }>; counts: { fail: number } };
        assert.ok(report.lines.some((line) => line.level === "fail"));
        assert.equal(report.counts.fail >= 1, true);
    });
});

describe("jig setup", () => {
    test("without a terminal it refuses in one line", async () => {
        const result = await run(["setup"], { input: "" });
        assert.equal(result.code, 1);
        assert.match(result.stderr, /^Setup needs a terminal with a screen\. Run jig setup from a terminal\./);
        assert.equal(existsSync(path.join(agent, "jig.json")), false, "nothing was written");
    });

    test("starts with the company, writes the profile, then asks the onboarding field", async () => {
        settingsWith(FIXTURE);
        const result = await runSetup([
            { when: "Which company setup do you use?", answer: "1" },
            { when: "Use Fixture Co's setup in:", answer: "1" },
            { when: "Save this company choice?", answer: "y" },
            { when: "needs 1 thing", answer: "1" },
            { when: "Your Fixture login", answer: "jdoe" },
            { when: "Review these changes", answer: "1" },
            { when: "Save these changes?", answer: "y" },
        ]);
        assert.equal(result.code, 0, result.stdout + result.stderr);
        const written = JSON.parse(readFileSync(path.join(agent, "jig.json"), "utf8")) as Record<string, any>;
        assert.equal(written.profile, "fixture-co");
        assert.equal(written.profiles["fixture-co"].plugin, "fixture-co");
        assert.equal(written.fixture.login, "jdoe");
        assert.match(result.stdout, /Start Pi again, or run \/reload in it, to apply\./);
    });
});
