// `/jig doctor`: the levels, the plain sentences and the fix line for each finding. The checks run against a context
// built by hand, so no test starts a login tool or reads a real store.
import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, test } from "node:test";
import { defaultConfig, emptyAdditions } from "../src/config.ts";
import type { LoadedConfig, SecretBackend, SectionCheck } from "../src/config.ts";
import { doctorMarkers, formatDoctor, runDoctor } from "../src/doctor.ts";
import type { DoctorContext, DoctorLine, DoctorOptions, DoctorReport } from "../src/doctor.ts";
import { countQuickIssues, findOnPath } from "../src/doctor-secrets.ts";

let home: string;
let agentDir: string;
let recordsDir: string;

beforeEach(() => {
    home = mkdtempSync(path.join(tmpdir(), "jig-doctor-"));
    agentDir = path.join(home, "agent");
    recordsDir = path.join(home, "state");
    mkdirSync(agentDir);
    mkdirSync(recordsDir);
    mkdirSync(path.join(home, "pass"));
});

afterEach(() => {
    rmSync(home, { recursive: true, force: true });
});

function loaded(overrides: Partial<LoadedConfig> = {}): LoadedConfig {
    return {
        file: path.join(agentDir, "jig.json"),
        found: true,
        config: defaultConfig(),
        problems: [],
        sections: new Map(),
        incomplete: new Map(),
        invalid: new Set(),
        ...overrides,
    };
}

interface Built {
    sections?: Map<string, unknown>;
    checks?: Array<[string, SectionCheck]>;
    overrides?: Partial<DoctorContext>;
}

function context(built: Built = {}): DoctorContext {
    return {
        env: { PATH: "" },
        personal: loaded(),
        sectionChecks: new Map(built.checks ?? []),
        company: emptyAdditions(),
        sections: built.sections ?? new Map(),
        commands: {},
        protectedPaths: () => [{ path: agentDir, shown: agentDir, kind: "guarded", source: "default" }],
        sandbox: { active: true, mode: "filtered", canWrite: () => false },
        recordsProblem: undefined,
        agentDir,
        configPath: path.join(agentDir, "jig.json"),
        stateDir: recordsDir,
        workingDir: home,
        secrets: { passStoreDir: () => path.join(home, "pass") },
        now: () => new Date("2026-11-04T00:00:00Z"),
        ...built.overrides,
    };
}

/** A loaded configuration whose stores are exactly these. */
function withBackends(...backends: SecretBackend[]): LoadedConfig {
    const config = defaultConfig();
    return loaded({ config: { ...config, secrets: { ...config.secrets, backends } } });
}

function options(overrides: Partial<DoctorOptions> = {}): DoctorOptions {
    return {
        platform: "linux",
        nodeVersion: "24.15.0",
        piVersion: () => "1.5.0",
        jigVersion: "0.3.0",
        home,
        pathLookup: () => "/usr/bin/program",
        run: async () => ({ code: 0, stdout: "", stderr: "", timedOut: false }),
        ...overrides,
    };
}

function text(report: Awaited<ReturnType<typeof runDoctor>>): string {
    return formatDoctor(report).join("\n");
}

describe("/jig doctor checks", () => {
    test("a company's onboarding list becomes a 'you need' line for each field still missing", async () => {
        const report = await runDoctor(
            context({
                checks: [["acme", () => ["acme: must hold a login"]]],
                overrides: {
                    onboarding: {
                        preferredStore: "pass",
                        items: [
                            {
                                kind: "text",
                                section: "acme",
                                path: "bastion.user",
                                label: "Your Acme login",
                                why: "The gateway asks for it.",
                            },
                        ],
                    },
                },
            }),
            options(),
        );
        const line = report.lines.find((entry) => entry.title === "You need: Your Acme login");
        assert.ok(line, text(report));
        assert.equal(line.group, "config");
        assert.equal(line.detail, "The gateway asks for it.");
        assert.equal(line.fix, "Run jig setup and it asks for this.");
    });

    test("a working setup passes, with a summary and the groups a person expects", async () => {
        const report = await runDoctor(context(), options());
        const shown = text(report);
        assert.match(shown, /^Jig doctor · \d+ ok/);
        assert.match(shown, /\nThis machine\n/);
        assert.match(shown, /\nConfiguration\n/);
        assert.match(shown, /\nSecrets\n/);
        assert.match(shown, /\nLogins\n/);
        assert.match(shown, /\nSandbox\n/);
        assert.match(shown, /\nRecords\n/);
        assert.match(shown, /All checks passed/);
        assert.equal(report.counts.fail, 0);
        assert.equal(report.counts.warn, 0);
    });

    test("Node.js below the package's minimum is a failure with an install line", async () => {
        const report = await runDoctor(context(), options({ nodeVersion: "20.0.0" }));
        const node = report.lines.find((line) => line.id === "machine.node");
        assert.equal(node?.level, "fail");
        assert.match(node?.detail ?? "", /Jig needs 22\.19\.0 or later/);
        assert.match(node?.fix ?? "", /Install Node\.js 22\.19\.0 or later/);
    });

    test("quiet keeps only warnings and failures, with the summary of the whole report", async () => {
        const report = await runDoctor(context({ overrides: { sandbox: undefined } }), options());
        const quiet = formatDoctor(report, { quiet: true }).join("\n");
        assert.match(quiet, /^Jig doctor · \d+ ok · \d+ warning · \d+ failure/m);
        assert.match(quiet, /^  warn Sandbox/m);
        assert.doesNotMatch(quiet, /^  ok /m);
        assert.doesNotMatch(quiet, /^  skip /m);
        assert.doesNotMatch(quiet, /This machine/);
        assert.match(quiet, /Nothing is blocked/);
    });

    test("the metadata says what was checked and whether the network was", async () => {
        const report = await runDoctor(context(), options());
        assert.equal(report.meta.jig, "0.3.0");
        assert.equal(report.meta.pi, "1.5.0");
        assert.equal(report.meta.node, "24.15.0");
        assert.equal(report.meta.platform, "linux");
        assert.equal(report.meta.network, false);
    });

    test("the Jig reinstall line follows the package's repository, and is plain without one", async () => {
        const known = await runDoctor(
            context(),
            options({ jigVersion: null, jigRepository: "git+https://github.com/example/jig.git" }),
        );
        assert.equal(
            known.lines.find((line) => line.id === "machine.jig")?.fix,
            "Reinstall Jig: pi install npm:@clawdbuilder/jig",
        );

        const generic = await runDoctor(context(), options({ jigVersion: null, jigRepository: "" }));
        assert.equal(
            generic.lines.find((line) => line.id === "machine.jig")?.fix,
            "Reinstall Jig the way you installed it.",
        );
    });

    test("an unreadable Pi version is a skip, not a warning to fix, and not a crash", async () => {
        const report = await runDoctor(context(), options({ piVersion: () => undefined }));
        const line = report.lines.find((entry) => entry.id === "machine.pi");
        assert.equal(line?.level, "skip");
        assert.equal(line?.fix, undefined, "nothing to run: Pi's version is not the problem");
    });

    test("Pi below the package's minimum warns and points at jig update", async () => {
        const report = await runDoctor(context(), options({ piVersion: () => "1.3.9" }));
        const line = report.lines.find((entry) => entry.id === "machine.pi");
        assert.equal(line?.level, "warn");
        assert.match(line?.detail ?? "", /needs 1\.4\.0 or later/);
        assert.match(line?.fix ?? "", /jig update/);
    });

    test("Pi newer than the tested version warns, and does not block", async () => {
        const report = await runDoctor(context(), options({ piVersion: () => "1.6.0" }));
        const line = report.lines.find((entry) => entry.id === "machine.pi");
        assert.equal(line?.level, "warn");
        assert.match(line?.detail ?? "", /newer than 1\.5\.0/);
        assert.equal(line?.fix, undefined);
    });

    test("a missing settings file is fine; it says the defaults apply", async () => {
        const report = await runDoctor(context({ overrides: { personal: loaded({ found: false }) } }), options());
        const file = report.lines.find((line) => line.id === "config.file");
        assert.equal(file?.level, "ok");
        assert.match(file?.detail ?? "", /the built-in defaults apply/);
    });

    test("each section's state is shown, and an invalid one names its key and the file", async () => {
        const personal = loaded({
            sections: new Map([["jira", {}]]),
            incomplete: new Map([["acme", ["acme.user is required"]]]),
            invalid: new Set(["logs"]),
            problems: [{ source: path.join(agentDir, "jig.json"), key: "logs", message: "logs.port must be a number" }],
        });
        const checks: Array<[string, SectionCheck]> = [
            ["jira", () => []],
            ["acme", () => ["acme.user is required"]],
            ["logs", () => ["logs.port must be a number"]],
            ["memory", () => []],
        ];
        const report = await runDoctor(context({ checks, overrides: { personal } }), options({ jigVersion: "0.3.0" }));
        const lines = report.lines.filter((line) => line.group === "config");
        assert.equal(lines.find((line) => line.title === "jira")?.level, "ok");
        assert.equal(lines.find((line) => line.title === "acme")?.level, "warn");
        assert.match(lines.find((line) => line.title === "acme")?.fix ?? "", /Add the missing value/);
        assert.equal(lines.find((line) => line.title === "logs")?.level, "fail");
        assert.match(lines.find((line) => line.title === "logs")?.detail ?? "", /logs\.port must be a number/);
        assert.match(lines.find((line) => line.title === "Not set")?.detail ?? "", /memory/);
    });

    test("an unreadable file fails once, and does not call each section invalid", async () => {
        const personal = loaded({
            found: true,
            problems: [{ source: path.join(agentDir, "jig.json"), key: "(file)", message: "is not valid JSON" }],
        });
        const report = await runDoctor(context({ checks: [["jira", () => []]], overrides: { personal } }), options());
        assert.equal(report.lines.filter((line) => line.level === "fail" && line.group === "config").length, 1);
        assert.match(report.lines.find((line) => line.id === "config.sections")?.detail ?? "", /unknown/);
    });

    test("a protected folder that is missing from the list is a failure", async () => {
        const report = await runDoctor(context({ overrides: { protectedPaths: () => [] } }), options());
        const line = report.lines.find((entry) => entry.id === "config.protected");
        assert.equal(line?.level, "fail");
        assert.equal(line?.title, "Pi's folder is not protected");
    });

    test("a missing records folder is normal, and a failed write is a failure", async () => {
        const missing = await runDoctor(context({ overrides: { stateDir: path.join(home, "not-there") } }), options());
        assert.equal(missing.lines.find((line) => line.id === "records.writable")?.level, "ok");

        const failed = await runDoctor(context({ overrides: { recordsProblem: "disk full" } }), options());
        const line = failed.lines.find((entry) => entry.id === "records.writable");
        assert.equal(line?.level, "fail");
        assert.equal(line?.detail, "disk full");
    });
});

describe("/jig doctor secrets", () => {
    test("a rule that names an action renamed in 0.4.0 is a warning, not a silent loss", async () => {
        const personal = loaded({
            config: { ...defaultConfig(), rules: [{ tool: "api", action: "run-folder", decision: "ask" }] },
        });
        const report = await runDoctor(context({ overrides: { personal } }), options());
        const line = report.lines.find((entry) => entry.id.startsWith("config.renamed."));
        assert.ok(line, "the rename is named");
        assert.equal(line.level, "warn");
        assert.match(line.title, /Rule action run-folder is now run_folder/);
        assert.match(line.detail ?? "", /still applies through 0\.4\.x/);
    });

    test("a missing pass entry says so plainly and gives the pass command", async () => {
        const report = await runDoctor(
            context({ sections: new Map([["jira", { token: "pass:work/jira-token" }]]) }),
            options(),
        );
        const line = report.lines.find((entry) => entry.id === "secrets.ref.jira.token");
        assert.equal(line?.level, "fail");
        assert.equal(line?.title, "Jira token");
        assert.equal(line?.detail, "Your Jira token is missing from pass.");
        assert.equal(line?.fix, "pass insert work/jira-token");
        assert.match(text(report), /Your Jira token is missing from pass\./);
        assert.match(text(report), /fix: pass insert work\/jira-token/);
    });

    test("a reference whose store is off fails without being echoed", async () => {
        const personal = loaded({
            config: { ...defaultConfig(), secrets: { ...defaultConfig().secrets, backends: [] } },
        });
        const report = await runDoctor(
            context({
                sections: new Map([["jira", { token: "pass:work/jira-token" }]]),
                overrides: { personal },
            }),
            options(),
        );
        const line = report.lines.find((entry) => entry.id === "secrets.ref.jira.token");
        assert.equal(line?.level, "fail");
        assert.match(line?.detail ?? "", /turned off/);
        assert.ok(!text(report).includes("pass:work/jira-token"));
    });

    test("an environment variable that is not set names the variable, never a value", async () => {
        const report = await runDoctor(
            context({
                sections: new Map([["logs", { token: "env:LOGS_TOKEN" }]]),
                overrides: { personal: withBackends("env") },
            }),
            options(),
        );
        const line = report.lines.find((entry) => entry.id === "secrets.ref.logs.token");
        assert.equal(line?.level, "fail");
        assert.match(line?.detail ?? "", /not set/);
        assert.match(line?.fix ?? "", /Set LOGS_TOKEN/);
    });

    test("a file that is not there gives the path to create, and a valid one is found", async () => {
        const missing = await runDoctor(
            context({
                sections: new Map([["api", { key: `file:${path.join(home, "api-key")}` }]]),
                overrides: { personal: withBackends("file") },
            }),
            options(),
        );
        const line = missing.lines.find((entry) => entry.id === "secrets.ref.api.key");
        assert.equal(line?.level, "fail");
        assert.match(line?.fix ?? "", /Create/);

        const file = path.join(home, "api-key");
        writeFileSync(file, "abc\n", { mode: 0o600 });
        chmodSync(file, 0o600);
        const found = await runDoctor(
            context({
                sections: new Map([["api", { key: `file:${file}` }]]),
                overrides: { personal: withBackends("file") },
            }),
            options(),
        );
        assert.equal(found.lines.find((entry) => entry.id === "secrets.ref.api.key")?.level, "ok");

        if (process.platform !== "win32") {
            chmodSync(file, 0o644);
            const readable = await runDoctor(
                context({
                    sections: new Map([["api", { key: `file:${file}` }]]),
                    overrides: { personal: withBackends("file") },
                }),
                options(),
            );
            const line = readable.lines.find((entry) => entry.id === "secrets.ref.api.key");
            assert.equal(line?.level, "warn");
            assert.match(line?.detail ?? "", /other users can read this file/);
        }
    });

    test("a store no reference uses is not checked: no warning about a pass folder that is not there", async () => {
        const report = await runDoctor(context({ overrides: { personal: withBackends("pass") } }), options());
        const line = report.lines.find((entry) => entry.id === "secrets.pass");
        assert.equal(line?.level, "skip");
        assert.match(line?.detail ?? "", /not used by any reference/);
        assert.equal(line?.fix, undefined);
    });

    test("a malformed reference fails, and its text never appears", async () => {
        const report = await runDoctor(
            context({ sections: new Map([["jira", { token: "pass:../secret" }]]) }),
            options(),
        );
        const line = report.lines.find((entry) => entry.id === "secrets.ref.jira.token");
        assert.equal(line?.level, "fail");
        assert.ok(!text(report).includes("pass:../secret"));
    });

    test("a command that is not declared, and one whose program is missing, are failures", async () => {
        const undeclared = await runDoctor(
            context({
                sections: new Map([["acme", { token: "cmd:acme-sso" }]]),
                overrides: { personal: withBackends("cmd") },
            }),
            options(),
        );
        assert.match(
            undeclared.lines.find((entry) => entry.id === "secrets.ref.acme.token")?.detail ?? "",
            /not declared/,
        );

        const missing = await runDoctor(
            context({
                sections: new Map([["acme", { token: "cmd:acme-sso" }]]),
                overrides: { commands: { "acme-sso": ["acme-sso", "token"] }, personal: withBackends("cmd") },
            }),
            options({ pathLookup: () => undefined }),
        );
        assert.match(
            missing.lines.find((entry) => entry.id === "secrets.ref.acme.token")?.detail ?? "",
            /is not installed/,
        );
    });

    test("cmd:gh is found when the login tool is signed in", async () => {
        const calls: string[][] = [];
        const report = await runDoctor(
            context({
                sections: new Map([["orders", { token: "cmd:gh" }]]),
                overrides: { personal: withBackends("cmd"), commands: { gh: ["gh", "auth", "token"] } },
            }),
            options({
                pathLookup: (program) => (program === "gh" ? "/usr/bin/gh" : undefined),
                run: async (file, args) => {
                    calls.push([file, ...args]);
                    return { code: 0, stdout: "", stderr: "", timedOut: false };
                },
            }),
        );
        const line = report.lines.find((entry) => entry.id === "secrets.ref.orders.token");
        assert.equal(line?.level, "ok");
        assert.match(line?.detail ?? "", /signed in/);
        assert.ok(calls.some((call) => call[1] === "auth" && call[2] === "status"));
    });

    test("1Password is asked for an item list, and its field is not verified", async () => {
        const calls: string[][] = [];
        const report = await runDoctor(
            context({
                sections: new Map([["orders", { token: "op://Work/Orders/token" }]]),
                overrides: { personal: withBackends("op") },
            }),
            options({
                run: async (file, args) => {
                    calls.push([file, ...args]);
                    return { code: 0, stdout: '[{"title":"Orders"}]', stderr: "", timedOut: false };
                },
            }),
        );
        const line = report.lines.find((entry) => entry.id === "secrets.ref.orders.token");
        assert.equal(line?.level, "ok");
        assert.match(line?.detail ?? "", /field is not verified/);
        assert.deepEqual(calls[0], ["op", "item", "list", "--vault", "Work", "--format", "json"]);
    });

    test("the nudge counts sections and a missing cheap credential", () => {
        const incomplete = context({
            overrides: { personal: loaded({ incomplete: new Map([["acme", ["acme.user is required"]]]) }) },
        });
        assert.equal(countQuickIssues(incomplete), 1);
        const missingReference = context({
            sections: new Map([["jira", { token: "pass:work/jira-token" }]]),
        });
        assert.equal(countQuickIssues(missingReference), 1);
        assert.equal(countQuickIssues(context()), 0);
    });
});

describe("/jig doctor logins and sandbox", () => {
    test("a login tool is checked only when the settings use it, and is signed in", async () => {
        const report = await runDoctor(
            context({
                sections: new Map([["git", { remote: "https://github.com/example/repo" }]]),
            }),
            options({ pathLookup: (program) => (program === "gh" ? "/usr/bin/gh" : undefined) }),
        );
        const line = report.lines.find((entry) => entry.id === "logins.gh");
        assert.equal(line?.level, "ok");
        assert.equal(line?.detail, "signed in.");
    });

    test("each git.accounts account is checked as signed in, and --network checks one repository", async () => {
        const accountContext = context({
            sections: new Map([
                ["git", { accounts: { "github.com:acme/orders-api": "acme-work", "github.com:acme/*": "acme-home" } }],
            ]),
        });
        const asked: string[][] = [];
        const signedIn = await runDoctor(
            accountContext,
            options({
                pathLookup: (program) => (program === "gh" ? "/usr/bin/gh" : undefined),
                run: async (file, args) => {
                    asked.push([file, ...args]);
                    return { code: 0, stdout: "", stderr: "", timedOut: false };
                },
            }),
        );
        const line = signedIn.lines.find((entry) => entry.id === "logins.gh-account.acme-work");
        assert.equal(line?.level, "ok");
        assert.equal(line?.detail, "Signed in, for github.com:acme/orders-api.");
        assert.deepEqual(
            asked.find((call) => call.includes("acme-work")),
            ["gh", "auth", "token", "--hostname", "github.com", "--user", "acme-work"],
        );
        let repoCredential: unknown;
        const network = await runDoctor(
            accountContext,
            options({
                network: true,
                pathLookup: (program) => (program === "gh" ? "/usr/bin/gh" : undefined),
                run: async (_file, args, runOptions) => {
                    if (args[0] === "repo") repoCredential = runOptions?.credential;
                    return { code: 0, stdout: "", stderr: "", timedOut: false };
                },
            }),
        );
        assert.equal(network.lines.find((entry) => entry.id === "logins.gh-account.acme-work.repo")?.level, "ok");
        assert.deepEqual(repoCredential, { program: "gh", account: "acme-work", host: "github.com" });

        const missing = await runDoctor(
            context({ sections: new Map([["git", { accounts: { "github.com:acme/*": "acme-work" } }]]) }),
            options({
                pathLookup: (program) => (program === "gh" ? "/usr/bin/gh" : undefined),
                run: async () => ({ code: 1, stdout: "", stderr: "", timedOut: false }),
            }),
        );
        assert.equal(missing.lines.find((entry) => entry.id === "logins.gh-account.acme-work")?.level, "fail");
    });

    test("a login tool that is not signed in warns with the login command", async () => {
        const report = await runDoctor(
            context({
                sections: new Map([["git", { remote: "git@github.com:example/repo" }]]),
            }),
            options({
                pathLookup: (program) => (program === "gh" ? "/usr/bin/gh" : undefined),
                run: async () => ({ code: 1, stdout: "", stderr: "", timedOut: false }),
            }),
        );
        const line = report.lines.find((entry) => entry.id === "logins.gh");
        assert.equal(line?.level, "warn");
        assert.equal(line?.fix, "gh auth login");
    });

    test("gh is asked without --no-refresh, and a signed-in account with another failing is not 'not signed in'", async () => {
        let asked: readonly string[] | undefined;
        const report = await runDoctor(
            context({
                sections: new Map([["git", { remote: "git@github.com:example/repo" }]]),
            }),
            options({
                pathLookup: (program) => (program === "gh" ? "/usr/bin/gh" : undefined),
                run: async (_file, args) => {
                    asked = args;
                    return {
                        code: 1,
                        stdout: "github.com\n  ✓ Logged in to github.com account acme (keyring)\n  X Failed to log in to github.com account old\n",
                        stderr: "",
                        timedOut: false,
                    };
                },
            }),
        );
        assert.deepEqual(asked, ["auth", "status"]);
        const line = report.lines.find((entry) => entry.id === "logins.gh");
        assert.equal(line?.level, "warn");
        assert.match(line?.detail ?? "", /signed in/);
        assert.doesNotMatch(line?.detail ?? "", /^not signed in\.$/);
    });

    test("a tool nobody uses is skipped, not warned about", async () => {
        const report = await runDoctor(context(), options({ pathLookup: () => undefined }));
        assert.equal(report.lines.find((entry) => entry.id === "logins.gh")?.level, "skip");
        assert.equal(report.lines.find((entry) => entry.id === "logins.glab")?.level, "skip");
    });

    test("no sandbox is a warning, a broken one is a failure, and missing programs give one install line", async () => {
        const absent = await runDoctor(context({ overrides: { sandbox: undefined } }), options());
        assert.equal(absent.lines.find((line) => line.id === "sandbox.provider")?.level, "warn");

        const broken = await runDoctor(
            context({ overrides: { sandbox: { active: false, note: "bwrap is missing", canWrite: () => false } } }),
            options(),
        );
        assert.equal(broken.lines.find((line) => line.id === "sandbox.provider")?.level, "fail");

        const programs = await runDoctor(
            context({ overrides: { sandbox: { active: true, mode: "off", canWrite: () => false } } }),
            options({ pathLookup: (program) => (program === "bwrap" ? "/usr/bin/bwrap" : undefined) }),
        );
        const line = programs.lines.find((entry) => entry.id === "sandbox.programs");
        assert.equal(line?.level, "fail");
        assert.equal(line?.fix, "sudo apt install bubblewrap socat ripgrep");
    });
});

describe("the doctor sees a broken install", () => {
    test("a missing sandbox broker is a failure, even though the programs and namespace work", async () => {
        const report = await runDoctor(
            context({
                sections: new Map([["sandbox", {}]]),
                overrides: { standalone: true, sandbox: { active: false, canWrite: () => false }, env: { PATH: "" } },
            }),
            options({ brokerScript: path.join(home, "missing-broker.mjs") }),
        );
        const line = report.lines.find((entry) => entry.id === "sandbox.broker");
        assert.ok(line, text(report));
        assert.equal(line.level, "fail");
        assert.match(line.detail ?? "", /broker script is not there/);
        assert.match(line.fix ?? "", /Reinstall Jig/);
    });

    test("a missing built-in roles folder is a failure", async () => {
        const report = await runDoctor(
            context({ sections: new Map([["agents", {}]]) }),
            options({ rolesFolder: path.join(home, "missing-roles") }),
        );
        const line = report.lines.find((entry) => entry.id === "machine.roles");
        assert.ok(line, text(report));
        assert.equal(line.level, "fail");
        assert.match(line.detail ?? "", /child agents lose reviewer, scout and worker/);
    });
});

describe("two copies of Jig", () => {
    test("every copy is named, even at the same version", async () => {
        for (const versions of [
            ["0.4.1", "0.4.1"],
            ["0.4.0", "0.4.1"],
        ]) {
            const report = await runDoctor(
                context({
                    overrides: {
                        standalone: true,
                        jigCopies: [
                            { source: "git:github.com/example/jig", version: versions[0] },
                            { source: "npm:@clawdbuilder/jig@0.4.1", version: versions[1] },
                        ],
                        jigInPiVersion: versions[1],
                    },
                }),
                options(),
            );
            const line = report.lines.find((entry) => entry.id === "machine.jig.copies");
            assert.ok(line, text(report));
            assert.equal(line.level, "warn");
            assert.match(line.detail ?? "", new RegExp(`${versions[0]} \\(git:`));
            assert.match(line.detail ?? "", new RegExp(`${versions[1]} \\(npm:`));
        }
    });
});

test("an absolute program is checked as a path, not looked up on PATH", () => {
    assert.equal(findOnPath(process.execPath, { PATH: "" }), process.execPath);
    assert.equal(findOnPath(path.join(home, "missing-program"), { PATH: "" }), undefined);
});

test("coloured doctor output wraps the plain text and colours only the label", () => {
    const lines = formatDoctor(
        {
            lines: [
                {
                    id: "x",
                    group: "machine",
                    level: "warn",
                    title: "T",
                    detail: "abcdefghij klmnopqrstuvwxyz0123456789",
                },
            ],
            counts: { ok: 0, warn: 1, fail: 0, skip: 0 },
            meta: { jig: "0.5.1", pi: "1.5.0", node: "24", platform: "linux", network: false },
        },
        { width: 30, color: true },
    ).join("\n");
    assert.match(lines, /\u001b\[33mwarn\u001b\[0m T — abcdefghij/);
    assert.doesNotMatch(lines, /warn T — j /);
});

describe("the human marks", () => {
    function report(): DoctorReport {
        const lines: DoctorLine[] = [
            { id: "a", group: "machine", level: "ok", title: "System", detail: "fine" },
            { id: "b", group: "machine", level: "warn", title: "Pi", detail: "old" },
            { id: "c", group: "machine", level: "fail", title: "Jig", detail: "missing" },
            { id: "d", group: "machine", level: "skip", title: "Project", detail: "untrusted" },
        ];
        return {
            lines,
            counts: { ok: 1, warn: 1, fail: 1, skip: 1 },
            meta: { jig: null, pi: null, node: "24", platform: "linux", network: false },
        };
    }

    test("markers replace the level words when the terminal can show them", () => {
        const shown = formatDoctor(report(), { markers: true }).join("\n");
        assert.match(shown, /^ {2}✓ System/m);
        assert.match(shown, /^ {2}! Pi/m);
        assert.match(shown, /^ {2}✗ Jig/m);
        assert.match(shown, /^ {2}– Project/m);
        assert.match(shown, /Jig doctor · 1 ok · 1 warning · 1 failure · 1 skipped/);
    });

    test("the words come back for NO_COLOR, TERM=dumb or a non-UTF-8 locale", () => {
        assert.equal(doctorMarkers({}), false);
        assert.equal(doctorMarkers({ LANG: "en_US.UTF-8" }), true);
        assert.equal(doctorMarkers({ LANG: "en_US.UTF-8", NO_COLOR: "1" }), false);
        assert.equal(doctorMarkers({ LANG: "en_US.UTF-8", TERM: "dumb" }), false);
        assert.equal(doctorMarkers({ LANG: "C" }), false);
        const plain = formatDoctor(report(), { markers: false }).join("\n");
        assert.match(plain, /^ {2}ok System/m);
    });

    test("equal references collapse into one counted row; a fail keeps its own row", () => {
        const lines: DoctorLine[] = [
            {
                id: "1",
                group: "secrets",
                level: "skip",
                title: "Ops services orders-api environments staging job auth token",
                detail: "Your Ops services orders-api environments staging job auth token is in a command; Jig does not read it to check it.",
            },
            {
                id: "2",
                group: "secrets",
                level: "skip",
                title: "Ops services billing-api environments qa job auth token",
                detail: "Your Ops services billing-api environments qa job auth token is in a command; Jig does not read it to check it.",
            },
            {
                id: "3",
                group: "secrets",
                level: "fail",
                title: "Jira token",
                detail: "Your Jira token is missing.",
                fix: "Add it.",
            },
        ];
        const report2: DoctorReport = { lines, counts: { ok: 0, warn: 0, fail: 1, skip: 2 }, meta: report().meta };
        const shown = formatDoctor(report2, { markers: true }).join("\n");
        assert.match(shown, /– Ops services — 2 references come from a command, not read:/);
        assert.match(shown, /orders-api environments staging job/);
        assert.match(shown, /✗ Jira token/);
    });

    test("the machine line names the folder source and the fallback", async () => {
        const withEnv = await runDoctor(
            context({
                overrides: { env: { PATH: "", PI_CODING_AGENT_DIR: agentDir }, standalone: true, jigInPi: false },
            }),
            options(),
        );
        const line = withEnv.lines.find((entry) => entry.id === "machine.agent");
        assert.match(line?.detail ?? "", /from PI_CODING_AGENT_DIR/);
        assert.doesNotMatch(line?.detail ?? "", /If your Pi runs/);
        const jigLine = withEnv.lines.find((entry) => entry.id === "machine.jig");
        assert.match(jigLine?.detail ?? "", /not installed in .*from PI_CODING_AGENT_DIR/);
        assert.match(jigLine?.detail ?? "", /If your Pi runs with PI_CODING_AGENT_DIR/);
        const byDefault = await runDoctor(context({ overrides: { standalone: true, jigInPi: false } }), options());
        assert.match(byDefault.lines.find((entry) => entry.id === "machine.agent")?.detail ?? "", /the default/);
        assert.match(byDefault.lines.find((entry) => entry.id === "machine.jig")?.detail ?? "", /the default folder/);
    });

    test("repeated references with path axes collapse to a grid", () => {
        const ops = ["orders-api", "billing-api", "payments-api", "catalog-api", "users-api"].flatMap(
            (service, index) =>
                ["staging", "qa"].map((environment, envIndex) => ({
                    id: `ops-${index}-${envIndex}`,
                    group: "secrets" as const,
                    level: "skip" as const,
                    title: `Ops services ${service} environments ${environment} job auth token`,
                    detail: `Your Ops services ${service} environments ${environment} job auth token is in a command; Jig does not read it to check it.`,
                    refPath: `ops.services.${service}.environments.${environment}.job.auth.token`,
                })),
        );
        const opsReport: DoctorReport = {
            lines: ops,
            counts: { ok: 0, warn: 0, fail: 0, skip: 10 },
            meta: report().meta,
        };
        const opsShown = formatDoctor(opsReport, { markers: true }).join("\n");
        assert.match(
            opsShown,
            /– Ops job tokens — 10 references come from a command, not read: 5 services \(orders-api,/,
        );
        assert.match(opsShown, /billing-api, payments-api, …\) × staging, qa/);

        const mongo = ["staging", "qa"].flatMap((environment) =>
            ["app", "reports"].flatMap((connection) =>
                ["user", "password"].map((field) => ({
                    id: `${environment}-${connection}-${field}`,
                    group: "secrets" as const,
                    level: "ok" as const,
                    title: `Mongo connections ${environment} ${connection} ${field}`,
                    detail: `Found in pass.`,
                    refPath: `mongo.connections.${environment}.${connection}.${field}`,
                })),
            ),
        );
        const mongoReport: DoctorReport = {
            lines: mongo,
            counts: { ok: 8, warn: 0, fail: 0, skip: 0 },
            meta: report().meta,
        };
        const mongoShown = formatDoctor(mongoReport, { markers: true }).join("\n");
        assert.match(mongoShown, /✓ Mongo connections — 8 references found in pass: staging, qa × app, reports/);
        assert.match(mongoShown, /\(user and/);
    });

    test("a skipped GitHub accounts row has no fix line", async () => {
        const result = await runDoctor(context(), options());
        const line = result.lines.find((entry) => entry.id === "logins.gh-accounts");
        assert.equal(line?.level, "skip");
        assert.equal(line?.fix, undefined);
        assert.doesNotMatch(text(result), /fix:.*git.accounts/);
    });
});
