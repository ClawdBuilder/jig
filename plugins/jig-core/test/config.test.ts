// Configuration: what loads, what is an error, and what can never lower the floor.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import {
    addCompanyClassifyRules,
    addCompanyEnvironments,
    addCompanyRules,
    buildPolicy,
    defaultConfig,
    describeProblem,
    emptyAdditions,
    floorViolation,
    loadConfigFile,
    parseConfig,
} from "../src/config.ts";
import type { LoadedConfig } from "../src/config.ts";
import { buildEnvironments } from "../src/environments.ts";
import type { Rule } from "../src/contract.ts";

const FILE = "/somewhere/jig.json";

/** A loaded personal config, as `loadConfigFile` would return it for a valid file. */
function personal(value: unknown): LoadedConfig {
    return { file: FILE, found: true, ...parseConfig(value, FILE) };
}

describe("loading the file", () => {
    let dir: string;
    before(() => {
        dir = mkdtempSync(path.join(tmpdir(), "jig-config-"));
    });
    after(() => rmSync(dir, { recursive: true, force: true }));

    test("no file means the defaults, and that is not an error", () => {
        const loaded = loadConfigFile(path.join(dir, "missing.json"));
        assert.equal(loaded.found, false);
        assert.deepEqual(loaded.problems, []);
        assert.deepEqual(loaded.config, defaultConfig());
        assert.deepEqual(loaded.config.secrets.backends, ["pass"]);
        assert.equal(loaded.config.records.retentionDays, 90);
        assert.equal(loaded.config.spill.retentionDays, 7);
        assert.equal(loaded.config.approvals.openInBrowser, "on-key");
    });

    test("a valid file loads, with a byte-order mark tolerated", () => {
        const file = path.join(dir, "valid.json");
        writeFileSync(
            file,
            `﻿${JSON.stringify({
                environments: { staging: { kind: "test", mask: true }, prod: { kind: "production" } },
                rules: [{ tool: "git", action: "push", decision: "ask", approval: "review" }],
                classify: [{ tool: "other_db", param: "target", value: "live", environment: "prod", effect: "read" }],
                secrets: { backends: ["pass", "env"] },
                records: { retentionDays: 30 },
                spill: { retentionDays: 3 },
                approvals: { openInBrowser: "always" },
            })}`,
        );
        const loaded = loadConfigFile(file);
        assert.deepEqual(loaded.problems, []);
        assert.equal(loaded.config.environments.staging?.mask, true);
        assert.equal(loaded.config.rules[0]?.approval, "review");
        assert.equal(loaded.config.classify[0]?.value, "live");
        assert.deepEqual(loaded.config.secrets.backends, ["pass", "env"]);
        assert.equal(loaded.config.records.retentionDays, 30);
        assert.equal(loaded.config.spill.retentionDays, 3);
        assert.equal(loaded.config.approvals.openInBrowser, "always");
    });

    test("invalid JSON is an error that names the file and does not quote the text", () => {
        const file = path.join(dir, "broken.json");
        writeFileSync(file, '{ "rules": [ SECRET-LOOKING-TEXT');
        const loaded = loadConfigFile(file);
        assert.equal(loaded.problems.length, 1);
        assert.equal(loaded.problems[0]?.source, file);
        assert.ok(!describeProblem(loaded.problems[0]!).includes("SECRET-LOOKING-TEXT"));
        assert.deepEqual(loaded.config, defaultConfig());
    });
});

describe("an unknown field is an error", () => {
    test("at the top: the problem names the file and the key, and the defaults apply", () => {
        const loaded = personal({ rule: [{ tool: "x", decision: "deny" }], rules: [{ tool: "y", decision: "deny" }] });
        assert.equal(loaded.problems.length, 1);
        assert.deepEqual(loaded.problems[0], { source: FILE, key: "rule", message: "is not a known field" });
        assert.equal(describeProblem(loaded.problems[0]!), `${FILE}: rule: is not a known field`);
        // The defaults, not half of the file: the rules in the file are not used either.
        assert.deepEqual(loaded.config.rules, []);
    });

    test("inside a rule: the key says which rule and which field", () => {
        const loaded = personal({
            rules: [
                { tool: "a", decision: "allow" },
                { tool: "b", decison: "deny" },
            ],
        });
        const keys = loaded.problems.map((problem) => problem.key);
        assert.ok(keys.includes("rules[1].decison"), keys.join());
        assert.ok(keys.includes("rules[1].decision"), "the missing decision is reported as well");
        assert.deepEqual(loaded.config.rules, []);
    });

    test("in every nested section", () => {
        for (const [section, value] of [
            ["environments.qa.colour", { environments: { qa: { kind: "test", colour: "blue" } } }],
            [
                "classify[0].extra",
                { classify: [{ tool: "t", param: "p", value: "v", environment: "e", effect: "read", extra: 1 }] },
            ],
            ["secrets.backend", { secrets: { backend: ["pass"] } }],
            ["records.keepDays", { records: { keepDays: 3 } }],
            ["spill.keepDays", { spill: { keepDays: 3 } }],
            ["approvals.openInBrowser2", { approvals: { openInBrowser2: "always" } }],
        ] as const) {
            const loaded = personal(value);
            assert.ok(
                loaded.problems.some((problem) => problem.key === section),
                `${section}: ${loaded.problems.map((p) => p.key).join()}`,
            );
        }
    });

    test("a plugin's section is unknown until the plugin registers it (see sections.test.ts)", () => {
        const loaded = personal({ git: { anything: true }, rules: [{ tool: "t", decision: "ask" }] });
        assert.deepEqual(loaded.problems, [{ source: FILE, key: "git", message: "is not a known field" }]);
        assert.deepEqual(loaded.config.rules, []);
    });

    test("wrong types and values are errors too", () => {
        const bad = (value: unknown, key: string) =>
            assert.ok(
                personal(value).problems.some((problem) => problem.key === key),
                key,
            );
        bad({ rules: "all" }, "rules");
        bad({ rules: [{ tool: "t", decision: "maybe" }] }, "rules[0].decision");
        bad({ rules: [{ tool: "t", decision: "ask", approval: "popup" }] }, "rules[0].approval");
        bad({ rules: [{ tool: "t", decision: "ask", effect: "delete" }] }, "rules[0].effect");
        bad({ secrets: { backends: ["pass", "vault"] } }, "secrets.backends[1]");
        bad({ secrets: { disabledBackends: ["env", "vault"] } }, "secrets.disabledBackends[1]");
        bad({ secrets: { disabledBackends: "env" } }, "secrets.disabledBackends");
        bad({ secrets: { commands: ["gh"] } }, "secrets.commands");
        bad({ secrets: { commands: { "gh auth": ["gh"] } } }, "secrets.commands.gh auth");
        bad({ secrets: { commands: { gh: "gh auth token" } } }, "secrets.commands.gh");
        bad({ secrets: { commands: { gh: [] } } }, "secrets.commands.gh");
        bad({ secrets: { commands: { gh: ["gh", ""] } } }, "secrets.commands.gh");
        bad({ secrets: { commands: { gh: ["gh", 3] } } }, "secrets.commands.gh");
        bad({ secrets: { commands: { gh: ["gh", "a\nb"] } } }, "secrets.commands.gh");
        bad({ approvals: { openInBrowser: "sometimes" } }, "approvals.openInBrowser");
        bad({ approvals: { openInBrowser: true } }, "approvals.openInBrowser");
        bad({ approvals: { openInBrowser: "Always" } }, "approvals.openInBrowser");
        bad({ approvals: "always" }, "approvals");
        bad({ records: { retentionDays: 0 } }, "records.retentionDays");
        bad({ records: { retentionDays: 1.5 } }, "records.retentionDays");
        bad({ classify: [{ tool: "t", param: "p", environment: "e", effect: "read" }] }, "classify[0]");
        bad(
            { classify: [{ tool: "t", param: "p", value: "v", pattern: "x", environment: "e", effect: "read" }] },
            "classify[0]",
        );
        bad(
            { classify: [{ tool: "t", param: "p", pattern: "(", environment: "e", effect: "read" }] },
            "classify[0].pattern",
        );
        bad({ environments: { qa: { kind: "staging" } } }, "environments.qa.kind");
        bad([], "(file)");
    });

    test("a bad approvals setting leaves the defaults, like every other error in the file", () => {
        const loaded = personal({ approvals: { openInBrowser: "sometimes" } });
        assert.equal(loaded.config.approvals.openInBrowser, "on-key");
        assert.equal(personal({ approvals: {} }).problems.length, 0);
        assert.equal(personal({ approvals: { openInBrowser: "on-key" } }).problems.length, 0);
    });

    test("production masking cannot be turned off, and the built-in environments cannot be redefined", () => {
        const masking = personal({ environments: { prod: { kind: "production", mask: false } } });
        assert.ok(masking.problems.some((problem) => problem.key === "environments.prod.mask"));
        const merged = buildEnvironments([
            {
                source: FILE,
                origin: "personal",
                environments: { production: { kind: "test" }, local: { kind: "production" } },
            },
        ]);
        assert.equal(merged.problems.length, 2);
        assert.equal(merged.environments.kindOf("production"), "production");
        assert.equal(merged.environments.kindOf("local"), "local");
    });
});

describe("secrets.disabledBackends", () => {
    test("is empty by default, and lists the backends the user turns off", () => {
        assert.deepEqual(personal({}).config.secrets.disabledBackends, []);
        const loaded = personal({ secrets: { backends: ["pass", "env"], disabledBackends: ["env", "cmd"] } });
        assert.deepEqual(loaded.problems, []);
        assert.deepEqual(loaded.config.secrets.backends, ["pass", "env"]);
        assert.deepEqual(loaded.config.secrets.disabledBackends, ["env", "cmd"]);
    });
});

describe("secrets.pass: where pass looks", () => {
    const stores = (pass: unknown) => personal({ secrets: { pass } });

    test("is empty by default, and takes a store and a GnuPG home, each absolute or starting with ~/", () => {
        assert.deepEqual(personal({}).config.secrets.pass, {});
        assert.deepEqual(personal({ secrets: { backends: ["pass"] } }).config.secrets.pass, {});
        const loaded = stores({ storeDir: "/srv/vault/pass", gnupgHome: "~/vault/gnupg" });
        assert.deepEqual(loaded.problems, []);
        assert.deepEqual(loaded.config.secrets.pass, { storeDir: "/srv/vault/pass", gnupgHome: "~/vault/gnupg" });
        assert.deepEqual(stores({ storeDir: "~/pass" }).config.secrets.pass, { storeDir: "~/pass" });
        assert.deepEqual(stores({}).config.secrets.pass, {});
    });

    test("a relative path, text that is not a path and an unknown field are errors that name the key", () => {
        const keyOf = (pass: unknown) => stores(pass).problems.map((problem) => problem.key);
        assert.deepEqual(keyOf({ storeDir: "pass" }), ["secrets.pass.storeDir"]);
        assert.deepEqual(keyOf({ storeDir: "./pass" }), ["secrets.pass.storeDir"]);
        assert.deepEqual(keyOf({ gnupgHome: "../gnupg" }), ["secrets.pass.gnupgHome"]);
        assert.deepEqual(keyOf({ gnupgHome: "~other/gnupg" }), ["secrets.pass.gnupgHome"]);
        assert.deepEqual(keyOf({ storeDir: "" }), ["secrets.pass.storeDir"]);
        assert.deepEqual(keyOf({ storeDir: 7 }), ["secrets.pass.storeDir"]);
        assert.deepEqual(keyOf({ storeDir: ["/a"] }), ["secrets.pass.storeDir"]);
        assert.deepEqual(keyOf({ storeDir: `/${"a".repeat(1100)}` }), ["secrets.pass.storeDir"]);
        assert.deepEqual(keyOf({ store: "/srv/pass" }), ["secrets.pass.store"]);
        assert.deepEqual(keyOf("/srv/pass"), ["secrets.pass"]);
        assert.deepEqual(keyOf(["/srv/pass"]), ["secrets.pass"]);
    });

    test("control characters are refused, and the message does not repeat the value", () => {
        const loaded = stores({ storeDir: "/srv/pa\nss", gnupgHome: "/srv/gn\u0000upg" });
        assert.deepEqual(
            loaded.problems.map((problem) => problem.key),
            ["secrets.pass.storeDir", "secrets.pass.gnupgHome"],
        );
        for (const problem of loaded.problems) assert.ok(!problem.message.includes("srv"), problem.message);
    });

    test("the root, the home folder and a folder above it are refused, however they are written", () => {
        const home = homedir();
        for (const value of ["/", "~", "~/", "~/.", "~/sub/..", home, `${home}/`, path.dirname(home)]) {
            assert.deepEqual(
                stores({ storeDir: value }).problems.map((problem) => problem.key),
                ["secrets.pass.storeDir"],
                value,
            );
            assert.deepEqual(
                stores({ gnupgHome: value }).problems.map((problem) => problem.key),
                ["secrets.pass.gnupgHome"],
                value,
            );
        }
        assert.deepEqual(stores({ storeDir: `${home}/pass` }).problems, []);
    });

    test("one wrong field makes the whole file fall back to the defaults, as for every jig-core setting", () => {
        const loaded = stores({ storeDir: "/srv/pass", gnupgHome: "gnupg" });
        assert.equal(loaded.problems.length, 1);
        assert.deepEqual(loaded.config.secrets.pass, {});
    });
});

describe("secrets.pass.unlockAtStart", () => {
    const stores = (pass: unknown) => personal({ secrets: { pass } });

    test("is off unless it is true, and true or false sits beside the folders", () => {
        assert.equal(personal({}).config.secrets.pass.unlockAtStart, undefined);
        assert.equal(stores({}).config.secrets.pass.unlockAtStart, undefined);
        assert.equal(stores({ unlockAtStart: false }).config.secrets.pass.unlockAtStart, false);
        const loaded = stores({ storeDir: "~/pass", unlockAtStart: true });
        assert.deepEqual(loaded.problems, []);
        assert.deepEqual(loaded.config.secrets.pass, { storeDir: "~/pass", unlockAtStart: true });
    });

    test("anything but true or false is an error that names the key and does not repeat the value", () => {
        for (const value of ["yes", "true", 1, 0, null, [true], { on: true }]) {
            const loaded = stores({ unlockAtStart: value });
            assert.deepEqual(
                loaded.problems.map((problem) => [problem.key, problem.message]),
                [["secrets.pass.unlockAtStart", "must be true or false"]],
                JSON.stringify(value),
            );
            assert.deepEqual(loaded.config.secrets.pass, {}, "the file falls back to the defaults");
        }
        assert.deepEqual(
            stores({ unlockAtstart: true }).problems.map((problem) => problem.key),
            ["secrets.pass.unlockAtstart"],
        );
    });
});

describe("startChecks", () => {
    const checks = (value: unknown) => personal({ startChecks: value });

    test("is an empty list by default, and takes checks with a name, a tcp address and a hint", () => {
        assert.deepEqual(personal({}).config.startChecks, []);
        assert.deepEqual(checks([]).config.startChecks, []);
        const loaded = checks([
            { name: "VPN", tcp: "vpn.example.com:443", hint: "connect your VPN client" },
            { name: "Orders API", tcp: "api.staging.example.com:8443" },
        ]);
        assert.deepEqual(loaded.problems, []);
        assert.deepEqual(loaded.config.startChecks, [
            {
                name: "VPN",
                tcp: "vpn.example.com:443",
                host: "vpn.example.com",
                port: 443,
                hint: "connect your VPN client",
            },
            { name: "Orders API", tcp: "api.staging.example.com:8443", host: "api.staging.example.com", port: 8443 },
        ]);
    });

    test("one wrong check makes the whole file fall back to the defaults, as for every jig-core setting", () => {
        const loaded = checks([{ name: "VPN", tcp: "vpn.example.com:443" }, { name: "x" }]);
        assert.deepEqual(
            loaded.problems.map((problem) => problem.key),
            ["startChecks[1].tcp"],
        );
        assert.deepEqual(loaded.config.startChecks, []);
    });
});

describe("secret commands and the cmd and file backends", () => {
    test("`secrets.commands` names a command as a program and its arguments, and the backends list has cmd and file", () => {
        const loaded = personal({
            secrets: {
                backends: ["pass", "cmd", "file"],
                commands: { gh: ["gh", "auth", "token"], "cloud-login": ["/opt/bin/token"] },
            },
        });
        assert.deepEqual(loaded.problems, []);
        assert.deepEqual(loaded.config.secrets.backends, ["pass", "cmd", "file"]);
        assert.deepEqual(loaded.config.secrets.commands, {
            gh: ["gh", "auth", "token"],
            "cloud-login": ["/opt/bin/token"],
        });
    });

    test("there are no commands by default", () => {
        assert.deepEqual(personal({}).config.secrets.commands, {});
        assert.deepEqual(personal({ secrets: { backends: ["env"] } }).config.secrets.commands, {});
    });
});

describe("a rule that would lower the floor is refused, with the file and the key named", () => {
    const rule = (extra: Partial<Rule>): Rule => ({ tool: "deploy", decision: "allow", ...extra });

    function refusals(
        rules: Rule[],
        environments: Record<string, { kind: "test" | "production" }> = {
            prod: { kind: "production" },
            qa: { kind: "test" },
        },
    ) {
        return buildPolicy(personal({ environments, rules }), emptyAdditions());
    }

    test("allow or ask on a write to a production environment", () => {
        for (const decision of ["allow", "ask"] as const) {
            const policy = refusals([rule({ environment: "prod", effect: "write", decision })]);
            assert.deepEqual(policy.rules, [], decision);
            assert.equal(policy.problems.length, 1);
            assert.equal(policy.problems[0]?.source, FILE);
            assert.equal(policy.problems[0]?.key, "rules[0].decision");
            assert.match(
                describeProblem(policy.problems[0]!),
                /jig\.json: rules\[0\]\.decision: .*production writes.*always denied/,
            );
        }
    });

    test("also when the rule does not say read or write, because it would cover writes", () => {
        const policy = refusals([rule({ environment: "prod" })]);
        assert.deepEqual(policy.rules, []);
        assert.match(policy.problems[0]?.message ?? "", /effect "read"/);
    });

    test("also for the built-in production name, and for a name nobody defined (it counts as production)", () => {
        assert.deepEqual(refusals([rule({ environment: "production", effect: "write" })]).rules, []);
        const unknown = refusals([rule({ environment: "nowhere", effect: "write" })]);
        assert.deepEqual(unknown.rules, []);
        assert.match(unknown.problems[0]?.message ?? "", /not a defined environment, so it counts as production/);
    });

    test("what is allowed: deny, a read, a test environment, and a rule that names no environment", () => {
        const kept = [
            rule({ environment: "prod", effect: "write", decision: "deny" }),
            rule({ environment: "prod", effect: "read", decision: "allow" }),
            rule({ environment: "prod", effect: "read", decision: "ask" }),
            rule({ environment: "qa", effect: "write", decision: "allow" }),
            rule({ effect: "write", decision: "allow" }),
        ];
        const policy = refusals(kept);
        assert.deepEqual(policy.problems, []);
        assert.equal(policy.rules.length, kept.length);
    });

    test("one refused rule does not take the others with it", () => {
        const policy = refusals([
            rule({ tool: "a", environment: "qa", decision: "allow" }),
            rule({ tool: "b", environment: "prod", effect: "write" }),
            rule({ tool: "c", decision: "deny" }),
        ]);
        assert.deepEqual(
            policy.rules.map((r) => r.tool),
            ["a", "c"],
        );
        assert.equal(policy.problems[0]?.key, "rules[1].decision");
    });

    test("floorViolation can be asked directly", () => {
        const { environments } = buildEnvironments([
            { source: FILE, origin: "personal", environments: { prod: { kind: "production" } } },
        ]);
        assert.equal(floorViolation(rule({ environment: "local", effect: "write" }), environments), undefined);
        assert.notEqual(floorViolation(rule({ environment: "prod", effect: "write" }), environments), undefined);
    });
});

describe("environments from configuration", () => {
    test("a company environment cannot be lowered by the personal file, and a mask can be added", () => {
        const company = emptyAdditions();
        addCompanyEnvironments(company, { prod: { kind: "production" }, qa: { kind: "test" } });
        const policy = buildPolicy(
            personal({ environments: { prod: { kind: "test" }, qa: { kind: "test", mask: true } } }),
            company,
        );
        assert.equal(policy.environments.kindOf("prod"), "production");
        assert.equal(policy.environments.masks("qa"), true);
        assert.ok(
            policy.problems.some((problem) => problem.source === FILE && problem.key === "environments.prod.kind"),
            JSON.stringify(policy.problems),
        );
    });

    test("a personal file can make a company test environment production", () => {
        const company = emptyAdditions();
        addCompanyEnvironments(company, { qa: { kind: "test" } });
        const policy = buildPolicy(personal({ environments: { qa: { kind: "production" } } }), company);
        assert.equal(policy.environments.kindOf("qa"), "production");
        assert.deepEqual(policy.problems, []);
    });
});

describe("personal over company", () => {
    test("personal rules come first, so they win; the company's follow", () => {
        const company = emptyAdditions();
        addCompanyEnvironments(company, { staging: { kind: "test" } });
        addCompanyRules(company, [
            { tool: "deploy", environment: "staging", decision: "allow" },
            { tool: "other", decision: "ask" },
        ]);
        const policy = buildPolicy(personal({ rules: [{ tool: "deploy", decision: "ask" }] }), company);
        assert.deepEqual(
            policy.rules.map((r) => `${r.tool}:${r.decision}`),
            ["deploy:ask", "deploy:allow", "other:ask"],
        );
    });

    test("classification rules follow the same order", () => {
        const company = emptyAdditions();
        addCompanyClassifyRules(company, [
            { tool: "db", param: "t", value: "x", environment: "from-company", effect: "read" },
        ]);
        const policy = buildPolicy(
            personal({ classify: [{ tool: "db", param: "t", value: "x", environment: "from-me", effect: "read" }] }),
            company,
        );
        assert.deepEqual(
            policy.classify.map((r) => r.environment),
            ["from-me", "from-company"],
        );
    });

    test("a company rule that would lower the floor is refused too, as `company`", () => {
        const company = emptyAdditions();
        addCompanyEnvironments(company, { prod: { kind: "production" } });
        addCompanyRules(company, [{ tool: "t", environment: "prod", effect: "write", decision: "allow" }]);
        const policy = buildPolicy(personal({}), company);
        assert.deepEqual(policy.rules, []);
        assert.equal(policy.problems[0]?.source, "company");
        assert.equal(policy.problems[0]?.key, "rules[0].decision");
    });

    test("invalid company additions are reported, not thrown, and the valid ones stay", () => {
        const company = emptyAdditions();
        addCompanyRules(company, [{ tool: "ok", decision: "ask" }]);
        addCompanyRules(company, [
            { tool: "bad", decision: "sometimes" },
            { tool: "fine", decision: "deny" },
        ]);
        assert.deepEqual(
            company.rules.map((r) => r.tool),
            ["ok", "fine"],
        );
        assert.equal(company.problems.length, 1);
        // The position counts the earlier call, so the key can be found in the plugin's own list.
        assert.equal(company.problems[0]?.key, "rules[1].decision");
        assert.equal(company.problems[0]?.source, "company");
    });
});
