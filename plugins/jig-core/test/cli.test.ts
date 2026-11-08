// The `jig` command end to end, in a temporary home: a real child process, its own agent folder and settings, no Pi.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import type { ChildProcess, ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, test } from "node:test";
import { piHostDir } from "../../../test/support/pi-host-dir.mjs";

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
const children = new Set<ChildProcess>();

function spawnTest(
    command: string,
    args: string[],
    options: Parameters<typeof spawn>[2],
): ChildProcessWithoutNullStreams {
    const child = spawn(command, args, {
        ...options,
        detached: process.platform !== "win32",
    }) as ChildProcessWithoutNullStreams;
    children.add(child);
    child.once("close", () => children.delete(child));
    return child;
}

/** A test's child may have its own children (script, npm, Pi): kill the group, then the child if it escaped. */
function killTree(child: ChildProcess): void {
    if (child.pid === undefined) return;
    try {
        process.kill(-child.pid, "SIGKILL");
    } catch {
        try {
            child.kill("SIGKILL");
        } catch {
            // Already gone.
        }
    }
}

afterEach(() => {
    for (const child of children) killTree(child);
    children.clear();
    rmSync(home, { recursive: true, force: true });
});

function env(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
    return { ...process.env, HOME: home, PI_CODING_AGENT_DIR: agent, ...extra };
}

function run(
    args: string[],
    options: { input?: string; tty?: boolean; env?: Record<string, string>; cwd?: string } = {},
) {
    const command = options.tty === true ? "script" : process.execPath;
    const argv =
        options.tty === true ? ["-qec", `${process.execPath} ${BIN} ${args.join(" ")}`, "/dev/null"] : [BIN, ...args];
    return new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve, reject) => {
        const child = spawnTest(command, argv, { cwd: options.cwd ?? work, env: env(options.env) });
        let stdout = "";
        let stderr = "";
        let timedOut = false;
        const timeout = setTimeout(() => {
            timedOut = true;
            killTree(child);
            reject(new Error(`jig ${args.join(" ")} did not finish`));
        }, 60_000);
        child.stdout.on("data", (chunk: Buffer) => (stdout += chunk.toString()));
        child.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString()));
        child.on("error", (error) => {
            clearTimeout(timeout);
            reject(error);
        });
        child.on("close", (code) => {
            clearTimeout(timeout);
            if (!timedOut) resolve({ code, stdout, stderr });
        });
        child.stdin.end(options.input ?? "");
    });
}

/** The setup prompts, answered when each one appears on the (pseudo-)terminal. */
function runSetup(expectations: Array<{ when: string; answer: string }>, cwd = work) {
    const child = spawnTest("script", ["-qec", `${process.execPath} ${BIN} setup`, "/dev/null"], {
        cwd,
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
            killTree(child);
            reject(new Error(`setup did not finish; it said:\n${stdout}\n${stderr}`));
        }, 45_000);
        child.on("close", () => clearTimeout(timeout));
    });
}

/** Pi's settings with the Jig package this test runs from, as a real install lists it, and any others. */
const settingsWith = (...packages: string[]): void =>
    writeFileSync(path.join(agent, "settings.json"), JSON.stringify({ packages: [ROOT, ...packages] }));

/** The command names stock Pi loads, from a real Pi process; the same filters the doctor reads decide them. */
function piCommands(cwd: string = work): Promise<string[]> {
    const cli = path.join(piHostDir, "dist/bundle/cli.js");
    return new Promise((resolve, reject) => {
        const child = spawnTest(process.execPath, [cli, "--mode", "rpc"], { cwd, env: env() });
        let buffer = "";
        let stderr = "";
        let settled = false;
        const finish = (names: string[]): void => {
            if (settled) return;
            settled = true;
            killTree(child);
            resolve(names);
        };
        const fail = (error: Error): void => {
            if (settled) return;
            settled = true;
            killTree(child);
            reject(error);
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
                        command?: string;
                        data?: { commands?: Array<{ name?: string }> };
                    };
                    if (record.type === "response" && record.command === "get_commands") {
                        finish(
                            (record.data?.commands ?? []).flatMap((one) => (one.name === undefined ? [] : [one.name])),
                        );
                        return;
                    }
                } catch {
                    // Pi's other output is not a command answer.
                }
            }
        });
        child.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString()));
        child.on("error", fail);
        const timeout = setTimeout(() => {
            fail(new Error("Pi did not answer get_commands"));
        }, 45_000);
        child.on("close", (code) => {
            clearTimeout(timeout);
            fail(
                new Error(
                    `Pi exited ${code ?? "without a code"} before answering get_commands${stderr === "" ? "" : `:\n${stderr.slice(0, 500)}`}`,
                ),
            );
        });
        child.stdin.write(`${JSON.stringify({ id: "1", type: "get_commands" })}\n`);
    });
}

/** Settings with the Jig package this test runs from, filtered by an object entry. */
function settingsFiltered(extensions: string[], skills?: string[]): void {
    writeFileSync(
        path.join(agent, "settings.json"),
        JSON.stringify({ packages: [{ source: ROOT, extensions, ...(skills === undefined ? {} : { skills }) }] }),
    );
}

describe("jig doctor", () => {
    test("runs without a Pi session and exits 0 when nothing failed", { timeout: 60_000 }, async () => {
        settingsWith();
        const result = await run(["doctor", "--quiet"]);
        assert.equal(result.code, 0, result.stdout + result.stderr);
        assert.match(result.stdout, /Jig doctor/);
        assert.match(result.stdout, /All checks passed|Nothing is blocked/);
    });

    test("a filter that leaves out Jig's core is a failure, not an all-clear", { timeout: 60_000 }, async () => {
        settingsFiltered(["!plugins/jig-core/index.ts"]);
        const result = await run(["doctor", "--quiet"]);
        assert.equal(result.code, 1, result.stdout);
        assert.match(result.stdout, /fail Jig's core is filtered out/);
        assert.match(result.stdout, /rules, approvals and protected paths would not run/);
        assert.match(result.stdout, /plugins\/jig-core\/index\.ts/);
    });

    test("a filter that leaves out the sandbox is a failure, not an all-clear", { timeout: 60_000 }, async () => {
        settingsFiltered(["!plugins/jig-sandbox/index.ts"]);
        const result = await run(["doctor", "--quiet"]);
        assert.equal(result.code, 1, result.stdout);
        assert.match(result.stdout, /fail Jig's sandbox is filtered out/);
        assert.match(result.stdout, /bash would run without it/);
    });

    test("extensions: [] leaves out core too, and says so", { timeout: 60_000 }, async () => {
        settingsFiltered([]);
        const result = await run(["doctor", "--quiet"]);
        assert.equal(result.code, 1, result.stdout);
        assert.match(result.stdout, /Jig's core is filtered out/);
        assert.match(result.stdout, /Jig's sandbox is filtered out/);
    });

    test("the sandbox is checked for real, not skipped", { timeout: 60_000 }, async () => {
        settingsWith();
        const empty = path.join(work, "no-programs");
        mkdirSync(empty);
        const result = await run(["doctor"], { env: { PATH: empty } });
        assert.equal(result.code, 1, result.stdout);
        assert.match(result.stdout, /fail Sandbox program bwrap/);
        assert.match(result.stdout, /fix: sudo (apt|dnf|pacman|zypper) install /);
        assert.doesNotMatch(result.stdout, /the sandbox starts with Pi/);
    });

    test("an always-on plugin that is off is one plain warning, and its section is kept", {
        timeout: 60_000,
    }, async () => {
        settingsFiltered(["!plugins/jig-git/index.ts"]);
        writeFileSync(path.join(agent, "jig.json"), JSON.stringify({ git: { base: "develop" } }));
        const result = await run(["doctor"]);
        assert.equal(result.code, 0, result.stdout);
        assert.match(result.stdout, /warn Jig's git tools are off in Pi's settings/);
        assert.match(result.stdout, /remove the filter that leaves out plugins\/jig-git\/index\.ts/);
        assert.doesNotMatch(result.stdout, /is not a known field/);
    });

    test("a choosable plugin that is off is a calm skip, and its section is not a problem", {
        timeout: 60_000,
    }, async () => {
        settingsFiltered(["!plugins/jig-jira/index.ts"]);
        writeFileSync(
            path.join(agent, "jig.json"),
            JSON.stringify({ jira: { site: "https://example.atlassian.net" } }),
        );
        const result = await run(["doctor"]);
        assert.equal(result.code, 0, result.stdout + result.stderr);
        assert.match(result.stdout, /skip Feature jira — off in Pi's settings; its section in jig\.json is kept/);
        assert.doesNotMatch(result.stdout, /is not a known field/);
        assert.doesNotMatch(result.stdout, /warn .*jira/i);
    });

    test("stock Pi and the doctor agree on the effective entry: plain, project, delta, untrusted, and two refs", {
        timeout: 60_000,
    }, async () => {
        const settings = (file: string, packages: unknown[]): void => writeFileSync(file, JSON.stringify({ packages }));
        const agentSettings = path.join(agent, "settings.json");
        const projectSettings = path.join(work, ".pi", "settings.json");
        mkdirSync(path.join(work, ".pi"), { recursive: true });

        // Plain: the user entry, no project entry.
        settings(agentSettings, [ROOT]);
        let commands = await piCommands();
        assert.equal(commands.includes("sandbox"), true);
        let doctor = await run(["doctor"]);
        assert.equal(doctor.code, 0, doctor.stdout);

        // Project replace: Pi keeps the project entry, so the sandbox command goes, and the doctor must fail.
        settings(agentSettings, [ROOT]);
        settings(projectSettings, [{ source: ROOT, extensions: ["!plugins/jig-sandbox/index.ts"] }]);
        writeFileSync(path.join(agent, "trust.json"), JSON.stringify({ [work]: true }));
        commands = await piCommands();
        assert.equal(commands.includes("sandbox"), false, `Pi loaded: ${commands.join(", ")}`);
        doctor = await run(["doctor"]);
        assert.equal(doctor.code, 1, doctor.stdout);
        assert.match(doctor.stdout, /Jig's sandbox is filtered out/);
        assert.match(doctor.stdout, new RegExp(`In ${projectSettings.replaceAll(".", "\\.")}`));

        // Project delta: autoload:false subtracts the same file, and the doctor must fail the same way.
        settings(projectSettings, [{ source: ROOT, autoload: false, extensions: ["-plugins/jig-sandbox/index.ts"] }]);
        commands = await piCommands();
        assert.equal(commands.includes("sandbox"), false, `Pi loaded: ${commands.join(", ")}`);
        doctor = await run(["doctor"]);
        assert.equal(doctor.code, 1, doctor.stdout);
        assert.match(doctor.stdout, /Jig's sandbox is filtered out/);

        // Untrusted project: Pi ignores the project entry, so the same filter must not change the result.
        rmSync(path.join(agent, "trust.json"), { force: true });
        commands = await piCommands();
        assert.equal(commands.includes("sandbox"), true, `Pi loaded: ${commands.join(", ")}`);
        doctor = await run(["doctor"]);
        assert.equal(doctor.code, 0, doctor.stdout);
        assert.doesNotMatch(doctor.stdout, /sandbox is filtered out/);

        // Same git identity, different refs: the project ref wins, and the doctor names the project file.
        const userGit = path.join(agent, "git", "github.com", "example", "jig");
        const projectGit = path.join(work, ".pi", "git", "github.com", "example", "jig");
        mkdirSync(path.dirname(userGit), { recursive: true });
        mkdirSync(path.dirname(projectGit), { recursive: true });
        rmSync(userGit, { force: true });
        rmSync(projectGit, { force: true });
        symlinkSync(ROOT, userGit);
        symlinkSync(ROOT, projectGit);
        settings(agentSettings, ["git:github.com/example/jig@v1"]);
        settings(projectSettings, [
            { source: "git:github.com/example/jig@v2", extensions: ["!plugins/jig-sandbox/index.ts"] },
        ]);
        writeFileSync(path.join(agent, "trust.json"), JSON.stringify({ [work]: true }));
        commands = await piCommands();
        assert.equal(commands.includes("sandbox"), false, `Pi loaded: ${commands.join(", ")}`);
        doctor = await run(["doctor"]);
        assert.equal(doctor.code, 1, doctor.stdout);
        assert.match(doctor.stdout, /Jig's sandbox is filtered out/);
        assert.match(doctor.stdout, new RegExp(`In ${projectSettings.replaceAll(".", "\\.")}`));
    });

    test("an invalid jig.json is a FAIL line in a report, not a crash", { timeout: 60_000 }, async () => {
        writeFileSync(path.join(agent, "jig.json"), "{ not json");
        const result = await run(["doctor", "--quiet"]);
        assert.equal(result.code, 1);
        assert.match(result.stdout, /fail The settings file cannot be read/);
        assert.match(result.stdout, /jig doctor again/);
    });

    test("a plugin that throws at load is a FAIL line naming it", { timeout: 60_000 }, async () => {
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

    test("Jig is a failure when Pi's settings do not list it, not an all-clear", { timeout: 60_000 }, async () => {
        writeFileSync(path.join(agent, "settings.json"), JSON.stringify({ packages: [] }));
        const result = await run(["doctor", "--quiet"]);
        assert.equal(result.code, 1);
        assert.match(result.stdout, /fail Jig/);
        assert.match(result.stdout, /not installed in Pi yet/);
        assert.match(result.stdout, /Install it: pi install npm:@clawdbuilder\/jig/);
    });

    test("two copies of Jig with different versions are a warning", { timeout: 60_000 }, async () => {
        const folder = path.join(agent, "git", "github.com", "example", "jig");
        mkdirSync(folder, { recursive: true });
        writeFileSync(
            path.join(folder, "package.json"),
            JSON.stringify({ name: "jig", version: "9.9.9", type: "module", pi: { extensions: ["./index.mjs"] } }),
        );
        writeFileSync(path.join(folder, "index.mjs"), "export default function () {}\n");
        writeFileSync(path.join(agent, "settings.json"), JSON.stringify({ packages: ["git:github.com/example/jig"] }));
        const result = await run(["doctor"]);
        assert.match(result.stdout, /Two copies of Jig/);
        const own = JSON.parse(readFileSync(path.join(ROOT, "package.json"), "utf8")) as { version?: string };
        assert.match(result.stdout, new RegExp(`this command is ${own.version?.replaceAll(".", "\\.")}`));
        assert.match(result.stdout, /copy Pi loads is 9\.9\.9/);
    });

    test("a rule that still names an old action is a warning in the terminal doctor too", {
        timeout: 60_000,
    }, async () => {
        settingsWith();
        writeFileSync(
            path.join(agent, "jig.json"),
            JSON.stringify({ rules: [{ tool: "api", action: "run-folder", decision: "ask" }] }),
        );
        const result = await run(["doctor"]);
        assert.match(result.stdout, /Rule action run-folder is now run_folder/);
        assert.match(result.stdout, /still applies through 0\.4\.x/);
        assert.match(result.stdout, /stop applying in 0\.5\.0/);
    });

    test("--json prints the report and keeps the exit code", { timeout: 60_000 }, async () => {
        writeFileSync(path.join(agent, "jig.json"), "{ not json");
        const result = await run(["doctor", "--json"]);
        assert.equal(result.code, 1);
        const report = JSON.parse(result.stdout) as { lines: Array<{ level: string }>; counts: { fail: number } };
        assert.ok(report.lines.some((line) => line.level === "fail"));
        assert.equal(report.counts.fail >= 1, true);
    });
});

/** A package laid out where Pi clones a git install: <agent>/git/<host>/<path> or <cwd>/.pi/git/<host>/<path>. */
function gitInstall(
    scope: "user" | "project",
    repo: string,
    name: string,
    version: string,
    extension?: string,
): string {
    const folder =
        scope === "user"
            ? path.join(agent, "git", ...repo.split("/"))
            : path.join(work, ".pi", "git", ...repo.split("/"));
    mkdirSync(folder, { recursive: true });
    writeFileSync(
        path.join(folder, "package.json"),
        JSON.stringify({
            name,
            version,
            type: "module",
            ...(extension === undefined ? {} : { pi: { extensions: ["./index.mjs"] } }),
        }),
    );
    if (extension !== undefined) writeFileSync(path.join(folder, "index.mjs"), extension);
    return folder;
}

/** A company plugin that registers a profile, a section and one onboarding item, from wherever it is installed. */
function companyExtension(): string {
    return `import { withJig } from ${JSON.stringify(path.join(ROOT, "plugins/jig-core/src/client.ts"))};
export default function () {
    withJig((api) => {
        const scoped = api.profiles.register("git-co", { displayName: "Git Co" });
        scoped.config.registerSection("gitco", (raw) =>
            typeof raw?.login === "string" && raw.login !== "" ? [] : ["gitco.login is required"],
        );
        scoped.onboarding.register({
            items: [{ kind: "text", section: "gitco", path: "login", label: "Your Git Co login" }],
        });
    });
}
`;
}

describe("a package installed from git", () => {
    test("user scope: Jig cloned under git/<host>/<path> is installed, not missing", { timeout: 60_000 }, async () => {
        gitInstall("user", "github.com/example/jig", "jig", "0.3.0", "export default function () {}\n");
        writeFileSync(path.join(agent, "settings.json"), JSON.stringify({ packages: ["git:github.com/example/jig"] }));
        const result = await run(["doctor", "--quiet"]);
        assert.equal(result.code, 0, result.stdout + result.stderr);
        assert.doesNotMatch(result.stdout, /not installed in Pi yet/);
    });

    test("a listed clone whose folder is gone is a failure naming the folder, not an all-clear", {
        timeout: 60_000,
    }, async () => {
        writeFileSync(
            path.join(agent, "settings.json"),
            JSON.stringify({ packages: ["git:github.com/ClawdBuilder/jig"] }),
        );
        const result = await run(["doctor", "--quiet"]);
        assert.equal(result.code, 1);
        assert.match(result.stdout, /Pi lists it, but its files are not there/);
        assert.match(result.stdout, /git\/github\.com\/ClawdBuilder\/jig/);
    });

    test("project scope: a company under <cwd>/.pi/git is loaded and offered by setup", {
        timeout: 60_000,
    }, async () => {
        gitInstall("user", "github.com/example/jig", "jig", "0.3.0", "export default function () {}\n");
        writeFileSync(path.join(agent, "settings.json"), JSON.stringify({ packages: ["git:github.com/example/jig"] }));
        gitInstall("project", "github.com/example/git-co", "git-co", "1.0.0", companyExtension());
        writeFileSync(
            path.join(work, ".pi", "settings.json"),
            JSON.stringify({ packages: ["git:github.com/example/git-co"] }),
        );
        writeFileSync(path.join(agent, "trust.json"), JSON.stringify({ [work]: true }));
        const doctor = await run(["doctor", "--quiet"]);
        assert.doesNotMatch(doctor.stdout, /git-co.*could not be loaded/);
        const result = await runSetup([
            { when: "Git Co (git-co)", answer: "1" },
            { when: "Use Git Co's setup in:", answer: "1" },
            { when: "Save this company choice?", answer: "y" },
            { when: "needs 1 thing", answer: "1" },
            { when: "Your Git Co login", answer: "gdev" },
            { when: "Review these changes", answer: "1" },
            { when: "Save these changes?", answer: "y" },
        ]);
        assert.equal(result.code, 0, result.stdout + result.stderr);
        const written = JSON.parse(readFileSync(path.join(agent, "jig.json"), "utf8")) as Record<string, any>;
        assert.equal(written.profile, "git-co");
        assert.equal(written.gitco.login, "gdev");
    });
});

describe("jig setup", () => {
    test("without a terminal it refuses in one line", { timeout: 60_000 }, async () => {
        const result = await run(["setup"], { input: "" });
        assert.equal(result.code, 1);
        assert.match(result.stderr, /^Setup needs a terminal with a screen\. Run jig setup from a terminal\./);
        assert.equal(existsSync(path.join(agent, "jig.json")), false, "nothing was written");
    });

    test("stops before the questions when Pi does not load Jig", { timeout: 60_000 }, async () => {
        writeFileSync(path.join(agent, "settings.json"), JSON.stringify({ packages: [] }));
        const result = await runSetup([]);
        assert.equal(result.code, 1);
        assert.match(result.stdout, /Jig is not installed in Pi yet/);
        assert.match(result.stdout, /Install it with: pi install npm:@clawdbuilder\/jig/);
        assert.doesNotMatch(result.stdout, /Which company setup do you use/);
    });

    test("Show the exact change prints plain JSON and never asks which line to pick", { timeout: 60_000 }, async () => {
        settingsWith(FIXTURE);
        const result = await runSetup([
            { when: "Which company setup do you use?", answer: "1" },
            { when: "Use Fixture Co's setup in:", answer: "1" },
            { when: "Save this company choice?", answer: "y" },
            { when: "needs 1 thing", answer: "1" },
            { when: "Your Fixture login", answer: "jdev" },
            { when: "Review these changes", answer: "2" },
            { when: "Save these changes?", answer: "y" },
        ]);
        assert.equal(result.code, 0, result.stdout + result.stderr);
        const shown = result.stdout.replace(/\r/g, "");
        assert.match(shown, /Only these fields change:/);
        assert.match(shown, /^\{$/m, "the change is printed as JSON text");
        assert.doesNotMatch(shown, /^\s*\d+\) \{$/m, "no JSON line is a numbered option");
        assert.doesNotMatch(shown, /\d+\) Only these fields change:/);
        // It went straight to the one save question, and the answer was written.
        const written = JSON.parse(readFileSync(path.join(agent, "jig.json"), "utf8")) as Record<string, any>;
        assert.equal(written.fixture.login, "jdev");
    });

    test("starts with the company, writes the profile, then asks the onboarding field", {
        timeout: 60_000,
    }, async () => {
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

/** A project-scope package whose extension writes `marker` as soon as it is imported. */
function markerPackage(marker: string, cwd = work, name = "tool"): void {
    const folder = path.join(cwd, ".pi", "git", "github.com", "acme", name);
    mkdirSync(folder, { recursive: true });
    writeFileSync(
        path.join(folder, "package.json"),
        JSON.stringify({ name, version: "1.0.0", type: "module", pi: { extensions: ["./index.mjs"] } }),
    );
    writeFileSync(
        path.join(folder, "index.mjs"),
        `import { writeFileSync } from "node:fs";\nwriteFileSync(${JSON.stringify(marker)}, "ran");\nexport default function () {}\n`,
    );
    mkdirSync(path.join(cwd, ".pi"), { recursive: true });
    writeFileSync(
        path.join(cwd, ".pi", "settings.json"),
        JSON.stringify({ packages: [`git:github.com/acme/${name}`] }),
    );
}

describe("project packages follow Pi's trust, and import nothing before it", () => {
    test("the marker appears only in the cases Pi would load", { timeout: 60_000 }, async () => {
        const cases: Array<{
            name: string;
            trust?: Record<string, unknown>;
            agentAlways?: boolean;
            projectAlways?: boolean;
            agentSettingsRaw?: string;
            agentDefault?: string;
            run: boolean;
            says?: RegExp;
        }> = [
            { name: "no trust.json", run: false },
            { name: "false", trust: { WORK: false }, run: false },
            { name: "parent true, closer false", trust: { PARENT: true, WORK: false }, run: false },
            { name: "parent true", trust: { PARENT: true }, run: true },
            { name: "exact true", trust: { WORK: true }, run: true },
            { name: "default always in the agent settings", agentAlways: true, run: true },
            { name: "default always in the project settings only", projectAlways: true, run: false },
            { name: "malformed trust.json", trust: { WORK: "yes" }, run: false },
            {
                name: "damaged settings.json",
                agentSettingsRaw: "{ not json",
                run: false,
                says: /settings file needs repairing/,
            },
            {
                name: "unknown defaultProjectTrust",
                agentDefault: "sometimes",
                run: false,
                says: /defaultProjectTrust is "sometimes"; Jig reads only always, never or ask/,
            },
        ];
        for (const scenario of cases) {
            const cwd = path.join(work, scenario.name.replace(/[^a-z]+/gi, "-"));
            mkdirSync(cwd, { recursive: true });
            const marker = path.join(cwd, "marker.txt");
            markerPackage(marker, cwd);
            writeFileSync(path.join(agent, "trust.json"), "{}");
            rmSync(path.join(agent, "trust.json"), { force: true });
            if (scenario.trust !== undefined) {
                const entries = Object.fromEntries(
                    Object.entries(scenario.trust).map(([key, value]) => [
                        key === "WORK" ? cwd : path.dirname(cwd),
                        value,
                    ]),
                );
                writeFileSync(path.join(agent, "trust.json"), JSON.stringify(entries));
            }
            settingsWith();
            if (scenario.agentSettingsRaw !== undefined) {
                writeFileSync(path.join(agent, "settings.json"), scenario.agentSettingsRaw);
            }
            if (scenario.agentDefault !== undefined) {
                writeFileSync(
                    path.join(agent, "settings.json"),
                    JSON.stringify({ packages: [ROOT], defaultProjectTrust: scenario.agentDefault }),
                );
            }
            if (scenario.agentAlways === true) {
                writeFileSync(
                    path.join(agent, "settings.json"),
                    JSON.stringify({ packages: [ROOT], defaultProjectTrust: "always" }),
                );
            }
            if (scenario.projectAlways === true) {
                writeFileSync(
                    path.join(cwd, ".pi", "settings.json"),
                    JSON.stringify({ packages: ["git:github.com/acme/tool"], defaultProjectTrust: "always" }),
                );
            }
            const result = await run(["doctor"], { cwd });
            assert.equal(existsSync(marker), scenario.run, `${scenario.name}: ${result.stdout}`);
            assert.match(result.stdout, scenario.run ? /Jig doctor/ : /This folder's Pi packages/, scenario.name);
            if (scenario.says !== undefined) assert.match(result.stdout, scenario.says, scenario.name);
        }
    });

    test("a user-scope package still runs without any trust", { timeout: 60_000 }, async () => {
        const marker = path.join(work, "user-marker.txt");
        const folder = path.join(agent, "git", "github.com", "acme", "usertool");
        mkdirSync(folder, { recursive: true });
        writeFileSync(
            path.join(folder, "package.json"),
            JSON.stringify({ name: "usertool", version: "1.0.0", type: "module", pi: { extensions: ["./index.mjs"] } }),
        );
        writeFileSync(
            path.join(folder, "index.mjs"),
            `import { writeFileSync } from "node:fs";\nwriteFileSync(${JSON.stringify(marker)}, "ran");\nexport default function () {}\n`,
        );
        writeFileSync(
            path.join(agent, "settings.json"),
            JSON.stringify({ packages: [ROOT, "git:github.com/acme/usertool"] }),
        );
        const result = await run(["doctor", "--quiet"]);
        assert.equal(existsSync(marker), true, result.stdout);
    });

    test("Jig listed only in an untrusted project is a skip, not a failure, and setup stops with the reason", {
        timeout: 60_000,
    }, async () => {
        const cwd = path.join(work, "jig-project");
        mkdirSync(cwd, { recursive: true });
        markerPackage(path.join(cwd, "marker.txt"), cwd, "jig");
        writeFileSync(path.join(agent, "settings.json"), JSON.stringify({ packages: [] }));
        const doctor = await run(["doctor"], { cwd });
        assert.match(doctor.stdout, /skip Jig/);
        assert.match(doctor.stdout, /not trusted this folder in Pi/);
        assert.doesNotMatch(doctor.stdout, /fail Jig/);
        assert.equal(doctor.code, 0, doctor.stdout + doctor.stderr);
        assert.equal(existsSync(path.join(cwd, "marker.txt")), false, "the project extension was not imported");
        const setup = await runSetup([], cwd);
        assert.equal(setup.code, 1);
        assert.match(setup.stdout, /Open Pi here and choose Trust, or run jig setup from another folder/);
        assert.doesNotMatch(setup.stdout, /jig doctor again/);
        assert.doesNotMatch(setup.stdout, /Which company setup do you use/);
    });

    test("a company only at project scope in an untrusted folder is named, not treated as no company", {
        timeout: 60_000,
    }, async () => {
        const cwd = path.join(work, "company-project");
        mkdirSync(cwd, { recursive: true });
        const folder = path.join(cwd, ".pi", "git", "github.com", "acme", "git-co");
        mkdirSync(folder, { recursive: true });
        writeFileSync(
            path.join(folder, "package.json"),
            JSON.stringify({ name: "git-co", version: "1.0.0", type: "module", pi: { extensions: ["./index.mjs"] } }),
        );
        writeFileSync(
            path.join(folder, "index.mjs"),
            `import { withJig } from ${JSON.stringify(path.join(ROOT, "plugins/jig-core/src/client.ts"))};\nexport default function () { withJig((api) => api.profiles.register("git-co", { displayName: "Git Co" })); }\n`,
        );
        writeFileSync(
            path.join(cwd, ".pi", "settings.json"),
            JSON.stringify({ packages: ["git:github.com/acme/git-co"] }),
        );
        settingsWith();
        const setup = await runSetup([], cwd);
        assert.equal(setup.code, 1);
        assert.match(setup.stdout, /git:github\.com\/acme\/git-co/);
        assert.match(setup.stdout, /run jig setup from another folder/);
        assert.equal((setup.stdout.match(/were not loaded/g) ?? []).length, 1, "the line is printed once");
        assert.doesNotMatch(setup.stdout, /No company plugin is installed/);
    });
});

describe("a real global install", () => {
    test("npm install -g --prefix ... --install-links, then that jig doctor runs and exits 0", {
        timeout: 240_000,
    }, async () => {
        const prefix = path.join(home, "prefix");
        const install = spawnTest(
            "npm",
            [
                "install",
                "-g",
                "--prefix",
                prefix,
                "--install-links",
                ROOT,
                "--no-audit",
                "--no-fund",
                "--ignore-scripts",
                "--prefer-offline",
            ],
            { env: env(), cwd: work },
        );
        let log = "";
        install.stdout.on("data", (chunk: Buffer) => (log += chunk.toString()));
        install.stderr.on("data", (chunk: Buffer) => (log += chunk.toString()));
        const installed = await new Promise<number | null>((resolve, reject) => {
            install.on("error", reject);
            install.on("close", resolve);
        });
        assert.equal(installed, 0, log.slice(-1500));
        const jig = path.join(prefix, "bin", "jig");
        assert.ok(existsSync(jig), "the install links the command");
        // The copy npm installed is what Pi would load, so settings name it.
        const installedPackage = path.join(prefix, "lib/node_modules/@clawdbuilder/jig");
        writeFileSync(path.join(agent, "settings.json"), JSON.stringify({ packages: [installedPackage] }));
        const doctor = await new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve, reject) => {
            const child = spawnTest(jig, ["doctor", "--quiet"], { env: env(), cwd: work });
            let stdout = "";
            let stderr = "";
            child.stdout.on("data", (chunk: Buffer) => (stdout += chunk.toString()));
            child.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString()));
            child.on("error", reject);
            child.on("close", (code) => resolve({ code, stdout, stderr }));
        });
        assert.equal(doctor.code, 0, doctor.stdout + doctor.stderr);
        assert.match(doctor.stdout, /Jig doctor/);
        assert.doesNotMatch(doctor.stderr, /ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING/);
    });
});

test("a package the command's loader cannot strip is not checked, not failed", { timeout: 60_000 }, async () => {
    const folder = path.join(agent, "npm/node_modules/@acme/param");
    mkdirSync(folder, { recursive: true });
    writeFileSync(
        path.join(folder, "package.json"),
        JSON.stringify({ name: "@acme/param", version: "1.0.0", type: "module", pi: { extensions: ["./index.ts"] } }),
    );
    writeFileSync(
        path.join(folder, "index.ts"),
        "class Holder { constructor(private value: string) {} }\nexport default function () { return Holder; }\n",
    );
    writeFileSync(path.join(agent, "settings.json"), JSON.stringify({ packages: [ROOT, "npm:@acme/param@1.0.0"] }));
    const result = await run(["doctor"]);
    assert.equal(result.code, 0, result.stdout + result.stderr);
    assert.match(result.stdout, /skip .*@acme\/param/);
    assert.match(result.stdout, /not checked: Pi can load this package/);
    assert.doesNotMatch(result.stdout, /fail .*@acme\/param/);
});
