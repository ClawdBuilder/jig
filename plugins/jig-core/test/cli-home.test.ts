// The `jig` command, the Jig home and `jig update`: a real child process, a temporary home, a fake Pi on PATH that records
// its argv and environment, and a fake npm that answers the registry. No network, no real Pi, no real agent folder.
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, test } from "node:test";

const ROOT = path.resolve(import.meta.dirname, "../../..");
const BIN = path.join(ROOT, "bin/jig.mjs");
const NAME = "@clawdbuilder/jig";

let root: string;
let home: string;
let jig: string;
let work: string;
let bin: string;
let log: string;
const children = new Set<ChildProcess>();

beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), "jig-home-"));
    home = path.join(root, "home");
    jig = path.join(home, ".jig");
    work = path.join(root, "work");
    bin = path.join(root, "bin");
    log = path.join(root, "calls.log");
    for (const folder of [home, jig, work, bin]) mkdirSync(folder, { recursive: true });
    // A fake Pi laid out as npm installs the real one, so the launcher's and `jig`'s search find it: a package named
    // @earendil-works/pi-coding-agent with its bundled CLI, and a `pi` on PATH that resolves into it.
    const piPackage = path.join(root, "npm", "lib", "node_modules", "@earendil-works", "pi-coding-agent");
    mkdirSync(path.join(piPackage, "dist", "bundle"), { recursive: true });
    writeFileSync(
        path.join(piPackage, "package.json"),
        JSON.stringify({ name: "@earendil-works/pi-coding-agent", version: "1.5.2" }),
    );
    writeFileSync(path.join(piPackage, "dist", "bundle", "cli.js"), fakePi(), { mode: 0o755 });
    symlinkSync(path.join(piPackage, "dist", "bundle", "cli.js"), path.join(bin, "pi"));
    writeFileSync(path.join(bin, "npm"), fakeNpm(), { mode: 0o755 });
});

afterEach(() => {
    for (const child of children) child.kill("SIGKILL");
    children.clear();
    rmSync(root, { recursive: true, force: true });
});

/** A Pi that records what it was asked and, for `install`, puts Jig in the home as a real `pi install` would. */
function fakePi(): string {
    return `#!/usr/bin/env node
const fs = require("node:fs"), path = require("node:path");
const args = process.argv.slice(2);
fs.appendFileSync(process.env.FAKE_LOG, JSON.stringify({ args, home: process.env.PI_CODING_AGENT_DIR ?? null }) + "\\n");
const home = process.env.PI_CODING_AGENT_DIR;
if (args[0] === "install" && home) {
    const folder = path.join(home, "npm", "node_modules", "@clawdbuilder", "jig");
    fs.mkdirSync(path.dirname(folder), { recursive: true });
    fs.rmSync(folder, { recursive: true, force: true });
    fs.symlinkSync(process.env.FAKE_JIG, folder, "dir");
    const file = path.join(home, "settings.json");
    let data = {};
    try { data = JSON.parse(fs.readFileSync(file, "utf8")); } catch {}
    data.packages = [folder];
    fs.writeFileSync(file, JSON.stringify(data));
}
process.stdout.write("fake pi: " + args.join(" ") + "\\n");
`;
}

/** npm's two registry reads, answered from the test's environment. Nothing else ever runs it. */
function fakeNpm(): string {
    return `#!/usr/bin/env node
const args = process.argv.slice(2);
if (args[0] === "view" && args.includes("versions")) {
    process.stdout.write(process.env.FAKE_VERSIONS ?? '["0.5.4","0.6.0"]');
    process.exit(0);
}
if (args[0] === "view" && process.env.FAKE_RELEASE) {
    process.stdout.write(process.env.FAKE_RELEASE);
    process.exit(0);
}
if (args[0] === "view") {
    const version = String(args[1] ?? "").split("@").pop();
    process.stdout.write(JSON.stringify({ version, jig: { agents: { pi: { minimum: "1.4.0", tested: "1.5.0" } } } }));
    process.exit(0);
}
process.exit(0);
`;
}

/** The home has the Jig this test runs from, as `pi install` leaves it: a copy, linked here so one test tree is enough. */
function installedHome(): void {
    const folder = path.join(jig, "npm", "node_modules", "@clawdbuilder", "jig");
    mkdirSync(path.dirname(folder), { recursive: true });
    symlinkSync(ROOT, folder, "dir");
    writeFileSync(path.join(jig, "settings.json"), JSON.stringify({ packages: [folder] }));
}

function env(extra: Record<string, string | undefined> = {}): NodeJS.ProcessEnv {
    const merged: NodeJS.ProcessEnv = {
        ...process.env,
        HOME: home,
        JIG_HOME: jig,
        PATH: `${bin}${path.delimiter}${path.dirname(process.execPath)}${path.delimiter}/usr/bin${path.delimiter}/bin`,
        FAKE_LOG: log,
        FAKE_JIG: ROOT,
        TERM: "dumb",
        NO_COLOR: "1",
        LANG: "C.UTF-8",
        AWS_PROFILE: undefined,
        BROWSER: "true",
        ...extra,
    };
    for (const [key, value] of Object.entries(merged)) if (value === undefined) delete merged[key];
    return merged;
}

function run(
    args: string[],
    options: { env?: Record<string, string | undefined>; cwd?: string; command?: string } = {},
): Promise<{ code: number | null; stdout: string; stderr: string }> {
    return new Promise((resolve, reject) => {
        const child = spawn(options.command ?? process.execPath, [BIN, ...args], {
            cwd: options.cwd ?? work,
            env: env(options.env),
            stdio: "pipe",
        });
        children.add(child);
        let stdout = "";
        let stderr = "";
        child.stdout.on("data", (chunk: Buffer) => (stdout += chunk.toString()));
        child.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString()));
        child.on("error", reject);
        child.on("close", (code) => {
            children.delete(child);
            resolve({ code, stdout, stderr });
        });
    });
}

/** Every call the fake Pi took, newest last, with the home it was given. */
function calls(): Array<{ args: string[]; home: string | null }> {
    if (!existsSync(log)) return [];
    return readFileSync(log, "utf8")
        .split("\n")
        .filter((line) => line !== "")
        .map((line) => JSON.parse(line) as { args: string[]; home: string | null });
}

const piArgs = (): string[] => calls().map((call) => call.args.join(" "));

describe("routing: the first word decides", () => {
    beforeEach(() => installedHome());

    test("a bare `jig` starts Pi, and so do a flag and a message in one word", async () => {
        for (const [args, expected] of [
            [[], ""],
            [["-c"], "-c"],
            [["--model", "x"], "--model x"],
            [["-p", "say hi"], "-p say hi"],
            [["update the readme"], "update the readme"],
            [["fix this;", "keep;it"], "fix this; keep;it"],
        ] as Array<[string[], string]>) {
            rmSync(log, { force: true });
            const result = await run(args);
            assert.equal(result.code, 0, args.join(" ") + result.stderr);
            assert.deepEqual(piArgs(), [expected], args.join(" "));
        }
    });

    test("`--` starts Pi even when what follows names a command", async () => {
        const result = await run(["--", "doctor", "the logs"]);
        assert.equal(result.code, 0, result.stderr);
        assert.deepEqual(piArgs(), ["doctor the logs"]);
    });

    test("every Pi package command is passed through unchanged, in the home", async () => {
        for (const args of [
            ["install", "npm:@scope/name"],
            ["install", "npm:@scope/name", "-l"],
            ["remove", "git:github.com/acme/tools"],
            ["uninstall", "npm:@scope/name"],
            ["list"],
            ["config"],
            ["auth", "check"],
            ["mcp", "list"],
        ]) {
            rmSync(log, { force: true });
            const result = await run(args);
            assert.equal(result.code, 0, args.join(" ") + result.stderr);
            assert.deepEqual(piArgs(), [args.join(" ")]);
            assert.equal(calls()[0]?.home, jig, "Pi runs with the home");
        }
    });

    test("Jig's own commands do not start Pi", async () => {
        for (const args of [
            ["doctor", "--help"],
            ["setup", "--help"],
            ["update", "--help"],
            ["help", "doctor"],
        ]) {
            const result = await run(args);
            assert.equal(result.code, 0, args.join(" "));
            assert.match(result.stdout, /Usage: jig/);
        }
        assert.deepEqual(calls(), []);
    });

    test("-h, --help, -v and --version are Jig's", async () => {
        const version = JSON.parse(readFileSync(path.join(ROOT, "package.json"), "utf8")) as { version: string };
        for (const args of [["-h"], ["--help"]]) {
            const result = await run(args);
            assert.equal(result.code, 0);
            assert.match(result.stdout, /^Usage: jig/);
        }
        for (const args of [["-v"], ["--version"]]) {
            const result = await run(args);
            assert.equal(result.code, 0);
            assert.equal(result.stdout.trim(), version.version);
        }
        assert.deepEqual(calls(), []);
    });

    test("a sub-command refuses words it does not take, and says how to ask Pi", async () => {
        const result = await run(["update", "the", "readme"]);
        assert.equal(result.code, 2);
        assert.equal(
            result.stderr.trim(),
            'jig update takes no words like "the". To ask Pi, run: jig "update the readme"',
        );
        const doctor = await run(["doctor", "the", "logs"]);
        assert.equal(doctor.code, 2);
        assert.match(doctor.stderr, /^jig doctor takes no words like "the"\./);
        const setup = await run(["setup", "jira", "extra"]);
        assert.equal(setup.code, 2);
        assert.match(setup.stderr, /^jig setup takes no words like "extra"\./);
        assert.deepEqual(calls(), [], "nothing ran");
    });
});

describe("one Jig copy", () => {
    test("a copy outside the home hands over to the home's copy, with the same words", async () => {
        installedHome();
        // A second copy of the package, as a global install or a checkout would be, with a version of its own.
        const outside = path.join(root, "outside");
        mkdirSync(outside, { recursive: true });
        for (const name of ["bin", "plugins"]) {
            spawnSync("cp", ["-a", path.join(ROOT, name), path.join(outside, name)], { encoding: "utf8" });
        }
        const manifest = JSON.parse(readFileSync(path.join(ROOT, "package.json"), "utf8")) as { version: string };
        writeFileSync(path.join(outside, "package.json"), JSON.stringify({ ...manifest, version: "9.9.9" }));
        const result = await run(["--version"], { command: process.execPath });
        assert.equal(result.stdout.trim(), manifest.version, "the running copy answers, not the outside one");
        const handed = await new Promise<{ code: number | null; stdout: string }>((resolve, reject) => {
            const child = spawn(process.execPath, [path.join(outside, "bin", "jig.mjs"), "--version"], {
                cwd: work,
                env: env(),
            });
            let stdout = "";
            child.stdout.on("data", (chunk: Buffer) => (stdout += chunk.toString()));
            child.on("error", reject);
            child.on("close", (code) => resolve({ code, stdout }));
        });
        assert.equal(handed.code, 0);
        assert.equal(handed.stdout.trim(), manifest.version, "the outside copy ran the home's copy");
    });

    test("the home's copy does not hand over to itself", async () => {
        installedHome();
        const result = await run(["doctor", "--help"]);
        assert.equal(result.code, 0, result.stderr);
        assert.match(result.stdout, /Usage: jig doctor/);
    });

    test("with no Jig in the home only setup, help and version run, and the rest says what to run", async () => {
        const list = await run(["list"]);
        assert.equal(list.code, 2);
        assert.equal(list.stderr.trim(), `Jig is not installed in ${jig}. Run: npx ${NAME} setup`);
        const bare = await run([]);
        assert.equal(bare.code, 2);
        assert.match(bare.stderr, /^Jig is not installed in /);
        // The three that work: the bootstrap, the help and the version.
        for (const args of [["--version"], ["--help"], ["setup", "--help"]]) {
            const result = await run(args);
            assert.equal(result.code, 0, args.join(" "));
        }
    });
});

describe("a home whose Jig Pi lists from a folder", () => {
    /** The shape `pi install ./packed` leaves: the folder in the settings, nothing under the home's npm folder. */
    function listedFolder(): string {
        const folder = path.join(root, "packed-jig");
        symlinkSync(ROOT, folder, "dir");
        writeFileSync(path.join(jig, "settings.json"), JSON.stringify({ packages: [folder] }));
        return folder;
    }

    test("is the home's copy: commands run, and jig list reaches Pi", async () => {
        listedFolder();
        const version = JSON.parse(readFileSync(path.join(ROOT, "package.json"), "utf8")) as { version: string };
        const result = await run(["--version"]);
        assert.equal(result.code, 0, result.stderr);
        assert.equal(result.stdout.trim(), version.version);
        const list = await run(["list"]);
        assert.equal(list.code, 0, list.stderr);
        assert.deepEqual(piArgs(), ["list"]);
    });

    test("setup's jig command runs that folder's bin/jig.mjs", async () => {
        const folder = listedFolder();
        const result = await run(["setup", "--yes"]);
        assert.equal(result.code, 0, result.stdout + result.stderr);
        assert.match(
            readFileSync(path.join(home, ".local", "bin", "jig"), "utf8"),
            new RegExp(`exec node '${folder}/bin/jig\\.mjs'`),
        );
    });
});

describe("the home", () => {
    test("JIG_HOME wins over an outer PI_CODING_AGENT_DIR, and Pi gets the home", async () => {
        installedHome();
        const outer = path.join(root, "outer-agent");
        mkdirSync(outer, { recursive: true });
        writeFileSync(path.join(outer, "jig.json"), "{ not json");
        const doctor = await run(["doctor", "--json"], { env: { PI_CODING_AGENT_DIR: outer } });
        assert.equal(doctor.code, 0, doctor.stdout + doctor.stderr);
        const report = JSON.parse(doctor.stdout) as {
            lines: Array<{ id: string; title?: string; detail?: string }>;
        };
        const row = report.lines.find((line) => line.id === "machine.agent");
        assert.equal(row?.title, "Jig home");
        assert.match(row?.detail ?? "", /^~\/\.jig, from JIG_HOME$/);
        assert.equal(
            report.lines.some((line) => (line.detail ?? "").includes(outer)),
            false,
            "the outer agent folder was not read",
        );
        const pi = await run(["-p", "hi"], { env: { PI_CODING_AGENT_DIR: outer } });
        assert.equal(calls()[0]?.home, jig);
        assert.equal(pi.code, 0);
    });

    test("doctor names the home it checked, with ~ for the person's own folder", async () => {
        installedHome();
        const result = await run(["doctor", "--json"]);
        assert.equal(result.code, 0, result.stdout + result.stderr);
        const report = JSON.parse(result.stdout) as {
            lines: Array<{ id: string; title: string; detail?: string }>;
        };
        const row = report.lines.find((line) => line.id === "machine.agent");
        assert.equal(row?.title, "Jig home");
        assert.match(row?.detail ?? "", /^~\/\.jig, from JIG_HOME$/);
    });
});

describe("jig update", () => {
    const release = (minimum: string, tested = "1.5.0") =>
        JSON.stringify({ version: "0.6.0", jig: { agents: { pi: { minimum, tested } } } });

    beforeEach(() => installedHome());

    test("bare: Jig first, then every unpinned package, all in the home", async () => {
        const result = await run(["update", "--yes"], { env: { FAKE_RELEASE: release("1.4.0") } });
        assert.equal(result.code, 0, result.stdout + result.stderr);
        assert.deepEqual(piArgs(), [`install npm:${NAME}@0.6.0`, "update --extensions"]);
        assert.equal(
            calls().every((call) => call.home === jig),
            true,
        );
    });

    test("--all and --self: --self is Jig only", async () => {
        rmSync(log, { force: true });
        await run(["update", "--all", "--yes"], { env: { FAKE_RELEASE: release("1.4.0") } });
        assert.deepEqual(piArgs(), [`install npm:${NAME}@0.6.0`, "update --extensions"]);
        rmSync(log, { force: true });
        const self = await run(["update", "--self", "--yes"], { env: { FAKE_RELEASE: release("1.4.0") } });
        assert.equal(self.code, 0, self.stderr);
        assert.deepEqual(piArgs(), [`install npm:${NAME}@0.6.0`]);
        rmSync(log, { force: true });
        await run(["update", "self", "--yes"], { env: { FAKE_RELEASE: release("1.4.0") } });
        assert.deepEqual(piArgs(), [`install npm:${NAME}@0.6.0`], "self is Jig only, never Pi's meaning");
    });

    test("--extensions and --models run Pi's own update and move nothing of Jig's", async () => {
        await run(["update", "--extensions", "--yes"]);
        assert.deepEqual(piArgs(), ["update --extensions"]);
        rmSync(log, { force: true });
        await run(["update", "--models", "--yes"]);
        assert.deepEqual(piArgs(), ["update --models"]);
    });

    test("one package is Pi's --extension, and other packages move on their own", async () => {
        await run(["update", "npm:@scope/tools", "--yes"]);
        assert.deepEqual(piArgs(), ["update --extension npm:@scope/tools"]);
        rmSync(log, { force: true });
        await run(["update", "--extension", "github.com/acme/tools", "--yes"]);
        assert.deepEqual(piArgs(), ["update --extension github.com/acme/tools"]);
    });

    test("the approve flags are passed to Pi", async () => {
        await run(["update", "--extensions", "-a", "--yes"]);
        assert.deepEqual(piArgs(), ["update --extensions --approve"]);
        rmSync(log, { force: true });
        await run(["update", "--models", "--no-approve", "--yes"]);
        assert.deepEqual(piArgs(), ["update --models --no-approve"]);
    });

    test("Pi itself and --force are refused, naming pi update --self", async () => {
        for (const args of [
            ["update", "pi"],
            ["update", "--force"],
            ["update", "--all", "--force"],
        ]) {
            const result = await run(args);
            assert.equal(result.code, 2, args.join(" "));
            assert.match(
                result.stderr,
                /Jig never updates Pi itself \(your pi and others share it\)\. Run: pi update --self/,
            );
        }
        assert.deepEqual(calls(), [], "nothing ran");
    });

    test("a release that needs a newer Pi stops the run before anything moves", async () => {
        const result = await run(["update", "--self", "--yes"], { env: { FAKE_RELEASE: release("2.0.0", "2.1.0") } });
        assert.equal(result.code, 1);
        assert.match(result.stderr, /needs Pi 2\.0\.0 or later; this is 1\.5\.2/);
        assert.match(result.stderr, /pi update --self/);
        assert.deepEqual(calls(), []);
    });

    test("--check says what would run, and runs nothing", async () => {
        const result = await run(["update", "--check", "--json"], { env: { FAKE_RELEASE: release("1.4.0") } });
        assert.equal(result.code, 0, result.stderr);
        const plan = JSON.parse(result.stdout) as { current: string; target: string; commands: string[]; code: number };
        assert.equal(
            plan.current,
            (JSON.parse(readFileSync(path.join(ROOT, "package.json"), "utf8")) as { version: string }).version,
        );
        assert.equal(plan.target, "0.6.0");
        assert.deepEqual(plan.commands, [`pi install npm:${NAME}@0.6.0`, "pi update --extensions"]);
        assert.deepEqual(calls(), [], "nothing ran");
    });

    test("already up to date: --self says so and runs nothing", async () => {
        const result = await run(["update", "--self", "--yes"], { env: { FAKE_VERSIONS: '["0.5.4"]' } });
        assert.equal(result.code, 0, result.stderr);
        assert.match(result.stdout, /is up to date/);
        assert.deepEqual(calls(), []);
    });

    test("without a terminal it refuses before anything runs", async () => {
        const result = await run(["update"]);
        assert.equal(result.code, 2);
        assert.equal(result.stdout, "");
        assert.match(result.stderr, /no terminal to confirm on/);
        assert.match(result.stderr, /--check/);
        assert.deepEqual(calls(), []);
    });
});

describe("jig setup", () => {
    test("on an empty home: makes the home, installs Jig in it, and writes the jig command", async () => {
        const result = await run(["setup", "--yes", "--source", path.join(root, "jig.tgz")]);
        assert.equal(result.code, 0, result.stdout + result.stderr);
        assert.deepEqual(piArgs(), [`install ${path.join(root, "jig.tgz")}`]);
        assert.equal(calls()[0]?.home, jig, "Pi installs with PI_CODING_AGENT_DIR set to the home");
        assert.ok(existsSync(path.join(jig, "settings.json")), "the home holds Pi's settings");
        const shim = path.join(home, ".local", "bin", "jig");
        assert.ok(existsSync(shim), "the jig command is written");
        assert.match(
            readFileSync(shim, "utf8"),
            /exec node "\$home\/npm\/node_modules\/@clawdbuilder\/jig\/bin\/jig\.mjs" "\$@"/,
        );
        assert.match(result.stdout, new RegExp(`${path.dirname(shim)} is not on your PATH`));
        assert.match(result.stdout, new RegExp(`export PATH="${path.dirname(shim)}:\\$PATH"`));
    });

    test("a file in the jig command's place that is not Jig's is left alone, and setup stops", async () => {
        const shim = path.join(home, ".local", "bin", "jig");
        mkdirSync(path.dirname(shim), { recursive: true });
        writeFileSync(shim, "#!/bin/sh\necho mine\n", { mode: 0o755 });
        const result = await run(["setup", "--yes", "--source", path.join(root, "jig.tgz")]);
        assert.equal(result.code, 1);
        assert.equal(readFileSync(shim, "utf8"), "#!/bin/sh\necho mine\n");
        assert.match(result.stdout, /that is not the Jig command, so it was left alone/);
    });

    test("running it again does the questions only, and repairs a missing jig command", async () => {
        installedHome();
        const result = await run(["setup", "--yes"]);
        assert.equal(result.code, 0, result.stdout + result.stderr);
        assert.deepEqual(calls(), [], "no pi install: the home already has Jig");
        assert.ok(existsSync(path.join(home, ".local", "bin", "jig")));
        assert.match(result.stdout, /jig is on your PATH|is not on your PATH/);
    });

    test("--yes copies the old jig.json and never a credential file", async () => {
        const old = path.join(home, ".pi", "jig-agent");
        mkdirSync(old, { recursive: true });
        writeFileSync(path.join(old, "jig.json"), JSON.stringify({ profile: "acme" }));
        writeFileSync(path.join(old, "auth.json"), JSON.stringify({ keep: "not copied" }));
        mkdirSync(path.join(old, "sessions"), { recursive: true });
        writeFileSync(path.join(old, "sessions", "s.jsonl"), "{}");
        const result = await run(["setup", "--yes", "--source", path.join(root, "jig.tgz")]);
        assert.equal(result.code, 0, result.stdout + result.stderr);
        assert.equal(readFileSync(path.join(jig, "jig.json"), "utf8"), JSON.stringify({ profile: "acme" }));
        assert.equal(existsSync(path.join(jig, "auth.json")), false, "a credential file needs its own yes");
        assert.equal(existsSync(path.join(jig, "sessions")), false);
        assert.equal(existsSync(path.join(old, "jig.json")), true, "the old folder is never moved or deleted");
        assert.equal(existsSync(path.join(old, "auth.json")), true);
    });

    test("a real terminal is offered the old folder and copies what it answers yes to", {
        timeout: 90_000,
    }, async (t) => {
        if (spawnSync("script", ["--version"], { encoding: "utf8" }).status !== 0) {
            t.skip("script is not installed");
            return;
        }
        const old = path.join(home, ".pi", "jig-agent");
        mkdirSync(old, { recursive: true });
        writeFileSync(path.join(old, "jig.json"), JSON.stringify({ profile: "acme" }));
        writeFileSync(path.join(old, "auth.json"), JSON.stringify({ keep: "copied after a separate yes" }));
        const child = spawn(
            "script",
            ["-qec", `${process.execPath} ${BIN} setup --source ${path.join(root, "jig.tgz")}`, "/dev/null"],
            {
                cwd: work,
                env: env(),
                stdio: "pipe",
            },
        );
        children.add(child);
        let stdout = "";
        let stderr = "";
        const answers: Array<{ when: string; answer: string }> = [
            { when: "Copy jig.json into the home?", answer: "y" },
            { when: "Copy auth.json into the home too?", answer: "y" },
        ];
        let next = 0;
        const result = await new Promise<{ code: number | null }>((resolve, reject) => {
            child.stdout.on("data", (chunk: Buffer) => {
                stdout += chunk.toString();
                const waiting = answers[next];
                if (waiting !== undefined && stdout.includes(waiting.when)) {
                    next++;
                    setTimeout(() => child.stdin.write(`${waiting.answer}\n`), 20);
                }
            });
            child.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString()));
            child.on("error", reject);
            child.on("close", (code) => resolve({ code }));
        });
        assert.equal(result.code, 0, stdout + stderr);
        assert.equal(readFileSync(path.join(jig, "jig.json"), "utf8"), JSON.stringify({ profile: "acme" }));
        assert.equal(
            readFileSync(path.join(jig, "auth.json"), "utf8"),
            JSON.stringify({ keep: "copied after a separate yes" }),
        );
    });
});
