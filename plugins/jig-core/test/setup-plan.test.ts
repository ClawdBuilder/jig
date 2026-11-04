// The setup plan: what is missing, the plain labels, the validator round trip, the plain summary and the write gate.
import assert from "node:assert/strict";
import {
    chmodSync,
    existsSync,
    lstatSync,
    mkdirSync,
    mkdtempSync,
    readFileSync,
    readdirSync,
    realpathSync,
    rmSync,
    statSync,
    symlinkSync,
    writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, test } from "node:test";
import { loadConfigFile } from "../src/config.ts";
import type { SectionCheck } from "../src/config.ts";
import { applyAnswer, buildSetupPlan, messagePaths, safePath } from "../src/setup-plan.ts";
import { exactChangeLines, SetupRefused, summaryLines, writeSetup } from "../src/setup-write.ts";
import type { SetupPlan, SetupState } from "../src/setup-plan.ts";

let home: string;
let file: string;
let before: string;

const checks = new Map<string, SectionCheck>([
    [
        "acme",
        (raw) => {
            const value = raw as { bastion?: { user?: unknown }; sso?: { token?: unknown } };
            const errors: string[] = [];
            if (typeof value?.bastion?.user !== "string" || value.bastion.user === "") {
                errors.push("acme.bastion.user is required");
            }
            if (value?.sso !== undefined && typeof value.sso.token !== "string") {
                errors.push("acme.sso.token is required");
            }
            return errors;
        },
    ],
    [
        "lens",
        (raw) => {
            const port = (raw as { port?: unknown })?.port;
            return typeof port === "number" ? [] : ["lens.port must be a number"];
        },
    ],
]);

const defaults = new Map<string, unknown>([["acme", { bastion: {} }]]);

const rawConfig = {
    rules: [{ tool: "read", decision: "deny" }],
    environments: { prod: { kind: "production" } },
    protectedPaths: { secret: ["/tmp/keys"] },
    secrets: { disabledBackends: ["op"] },
    lens: { port: "high" },
};

function stateFor(raw: unknown, path = file): SetupState {
    return {
        personal: loadConfigFile(path, checks, {
            defaults,
            replace: new Map(),
            oneOf: new Map(),
            union: new Map(),
        }),
        sectionChecks: checks,
        defaults,
        replace: new Map(),
        oneOf: new Map(),
        union: new Map(),
        configPath: path,
    };
}

function planFor(raw: unknown = rawConfig, path = file): SetupPlan {
    const built = buildSetupPlan(stateFor(raw, path));
    if ("problem" in built) throw new Error(`expected a plan, got: ${built.problem}`);
    return built.plan;
}

function build(raw: unknown = rawConfig, path = file): SetupPlan {
    before = JSON.stringify(raw, null, 4);
    writeFileSync(path, before);
    return planFor(raw, path);
}

beforeEach(() => {
    home = mkdtempSync(path.join(tmpdir(), "jig-setup-"));
    const agent = path.join(home, "agent");
    mkdirSync(agent);
    file = path.join(agent, "jig.json");
});

afterEach(() => {
    rmSync(home, { recursive: true, force: true });
});

describe("the plan", () => {
    test("asks about the company's missing section first, then the invalid one", () => {
        const plan = build();
        assert.deepEqual(
            plan.sections.map((section) => section.name),
            ["acme", "lens"],
        );
        assert.equal(plan.sections[0]?.fields[0]?.path, "bastion.user");
        assert.equal(plan.sections[0]?.fields[0]?.label, "Acme bastion login");
        assert.equal(plan.sections[0]?.fields[0]?.kind, "text");
        assert.equal(plan.sections[0]?.fields[0]?.reason, "This is still needed.");
        assert.equal(plan.sections[1]?.fields[0]?.path, "port");
        assert.equal(plan.sections[1]?.fields[0]?.label, "Lens port");
        assert.equal(plan.sections[1]?.fields[0]?.kind, "number");
        assert.match(plan.sections[1]?.fields[0]?.placeholder ?? "", /Now: high/);
    });

    test("skips a credential, and says when it will be asked for", () => {
        const secretDefaults = new Map<string, unknown>([["acme", { sso: {}, bastion: {} }]]);
        const secretChecks = new Map<string, SectionCheck>([
            [
                "acme",
                (raw) => {
                    const value = raw as { bastion?: { user?: unknown }; sso?: { token?: unknown } };
                    const errors: string[] = [];
                    if (typeof value?.bastion?.user !== "string" || value.bastion.user === "") {
                        errors.push("acme.bastion.user is required");
                    }
                    if (typeof value?.sso?.token !== "string") errors.push("acme.sso.token is required");
                    return errors;
                },
            ],
        ]);
        const path = file;
        writeFileSync(path, JSON.stringify({}, null, 4));
        const state: SetupState = {
            personal: loadConfigFile(path, secretChecks, {
                defaults: secretDefaults,
                replace: new Map(),
                oneOf: new Map(),
                union: new Map(),
            }),
            sectionChecks: secretChecks,
            defaults: secretDefaults,
            replace: new Map(),
            oneOf: new Map(),
            union: new Map(),
            configPath: path,
        };
        const built = buildSetupPlan(state);
        assert.ok("plan" in built);
        const section = built.plan.sections.find((entry) => entry.name === "acme");
        assert.deepEqual(
            section?.fields.map((field) => field.path),
            ["bastion.user"],
        );
        assert.match(section?.notes.join(" ") ?? "", /Acme SSO token: credentials come in a later step/);
    });

    test("does not ask about a section nothing set up", () => {
        const path = file;
        writeFileSync(path, JSON.stringify({}, null, 4));
        const emptyChecks = new Map<string, SectionCheck>([["optional", () => []]]);
        const state: SetupState = {
            personal: loadConfigFile(path, emptyChecks, {
                defaults: new Map(),
                replace: new Map(),
                oneOf: new Map(),
                union: new Map(),
            }),
            sectionChecks: emptyChecks,
            defaults: new Map(),
            replace: new Map(),
            oneOf: new Map(),
            union: new Map(),
            configPath: path,
        };
        const built = buildSetupPlan(state);
        assert.ok("plan" in built);
        assert.deepEqual(built.plan.sections, []);
    });

    test("refuses a file that is not valid JSON, without repeating its text", () => {
        writeFileSync(file, "{ not json");
        const built = buildSetupPlan(stateFor(rawConfig));
        assert.ok("problem" in built);
        assert.match(built.problem, /not valid JSON/);
        assert.ok(!built.problem.includes("{ not json"));
    });

    test("reads a file that is not there yet, ready to create it", () => {
        const missing = path.join(home, "agent", "new.json");
        const plan = planFor({}, missing);
        assert.equal(plan.exists, false);
        assert.equal(plan.before, "");
        assert.ok(plan.sections.length > 0);
    });
});

describe("one answer", () => {
    test("rejects a value the plugin's check names, in plain words, and keeps the draft", () => {
        const plan = build();
        const draft = structuredClone(plan.raw);
        const field = plan.sections[1]?.fields[0];
        assert.ok(field);
        const rejected = applyAnswer(plan, draft, field, "high");
        assert.ok("problem" in rejected);
        assert.equal(rejected.problem, "Lens port must be a number.");
        assert.equal((draft.lens as { port?: unknown }).port, "high");
    });

    test("accepts a number for a number field, and a login for a text field", () => {
        const plan = build();
        const draft = structuredClone(plan.raw);
        const lens = plan.sections[1]?.fields[0];
        const acme = plan.sections[0]?.fields[0];
        assert.ok(lens && acme);
        const port = applyAnswer(plan, draft, lens, "8080");
        assert.ok("change" in port);
        assert.equal(port.change.value, 8080);
        assert.equal(port.change.oldValue, "high");
        const login = applyAnswer(plan, draft, acme, "jdoe");
        assert.ok("change" in login);
        assert.equal(login.change.value, "jdoe");
        assert.equal((draft.lens as { port?: unknown }).port, 8080);
        assert.equal((draft.acme as { bastion: { user: string } }).bastion.user, "jdoe");
    });

    test("rejects an empty answer and a value that cannot be a number", () => {
        const plan = build();
        const draft = structuredClone(plan.raw);
        const lens = plan.sections[1]?.fields[0];
        assert.ok(lens);
        assert.match((applyAnswer(plan, draft, lens, "  ") as { problem: string }).problem, /Please enter a value/);
        assert.match((applyAnswer(plan, draft, lens, "many") as { problem: string }).problem, /must be a number/);
    });
});

describe("the plain summary and the exact change", () => {
    test("one line per change, no JSON, no reference syntax", () => {
        const plan = build();
        const draft = structuredClone(plan.raw);
        const lens = plan.sections[1]?.fields[0];
        const acme = plan.sections[0]?.fields[0];
        assert.ok(lens && acme);
        const changes = [];
        const port = applyAnswer(plan, draft, lens, "8080");
        assert.ok("change" in port);
        changes.push(port.change);
        const login = applyAnswer(plan, draft, acme, "jdoe");
        assert.ok("change" in login);
        changes.push(login.change);
        const summary = summaryLines(plan, changes).join("\n");
        assert.match(summary, /^Lens port: 8080 \(changed\)$/m);
        assert.match(summary, /^Acme bastion login: jdoe \(new\)$/m);
        assert.ok(!summary.includes("{"));
        assert.ok(!summary.includes("}"));
        assert.doesNotMatch(summary, /\b(pass|env|cmd|file|keychain):|op:\/\//);
        assert.doesNotMatch(summary, /"[A-Za-z0-9_.-]+":/);
    });

    test("the exact change is the JSON of only those fields", () => {
        const plan = build();
        const draft = structuredClone(plan.raw);
        const lens = plan.sections[1]?.fields[0];
        const acme = plan.sections[0]?.fields[0];
        assert.ok(lens && acme);
        const changes = [];
        const port = applyAnswer(plan, draft, lens, "8080");
        assert.ok("change" in port);
        changes.push(port.change);
        const login = applyAnswer(plan, draft, acme, "jdoe");
        assert.ok("change" in login);
        changes.push(login.change);
        const exact = JSON.parse(exactChangeLines(changes).join("\n")) as Record<string, any>;
        assert.deepEqual(exact, { lens: { port: 8080 }, acme: { bastion: { user: "jdoe" } } });
    });
});

describe("the write gate", () => {
    test("writes only the answered fields, keeps the floor, and backs the file up beside itself", () => {
        const plan = build();
        const draft = structuredClone(plan.raw);
        const changes = [];
        for (const field of [plan.sections[1]?.fields[0], plan.sections[0]?.fields[0]]) {
            assert.ok(field);
            const answer = applyAnswer(plan, draft, field, field.kind === "number" ? "8080" : "jdoe");
            assert.ok("change" in answer);
            changes.push(answer.change);
        }
        chmodSync(file, 0o640);
        // The plan was read before the chmod; its mode is the one to keep.
        const rewritten = planFor(rawConfig);
        const draft2 = structuredClone(rewritten.raw);
        const changes2 = [];
        for (const field of [rewritten.sections[1]?.fields[0], rewritten.sections[0]?.fields[0]]) {
            assert.ok(field);
            const answer = applyAnswer(rewritten, draft2, field, field.kind === "number" ? "8080" : "jdoe");
            assert.ok("change" in answer);
            changes2.push(answer.change);
        }
        const result = writeSetup(rewritten, changes2, new Date("2026-11-04T17:00:00.000Z"));
        assert.ok(result.backup);
        assert.equal(readFileSync(result.backup, "utf8"), before);
        assert.equal(statSync(file).mode & 0o777, 0o640);

        const after = JSON.parse(readFileSync(file, "utf8"));
        assert.deepEqual(after.rules, rawConfig.rules);
        assert.deepEqual(after.environments, rawConfig.environments);
        assert.deepEqual(after.protectedPaths, rawConfig.protectedPaths);
        assert.deepEqual(after.secrets, rawConfig.secrets);
        assert.equal(after.acme.bastion.user, "jdoe");
        assert.equal(after.lens.port, 8080);
        assert.deepEqual(changes, changes2);
    });

    test("refuses when the file changed while setup was open, and writes nothing", () => {
        const plan = build();
        const draft = structuredClone(plan.raw);
        const field = plan.sections[1]?.fields[0];
        assert.ok(field);
        const answer = applyAnswer(plan, draft, field, "8080");
        assert.ok("change" in answer);
        writeFileSync(file, `${before} `);
        const changed = readFileSync(file, "utf8");
        assert.throws(
            () => writeSetup(plan, [answer.change], new Date("2026-11-04T17:00:00.000Z")),
            (error: unknown) => error instanceof SetupRefused && /changed while setup was open/.test(error.message),
        );
        assert.equal(readFileSync(file, "utf8"), changed);
        assert.deepEqual(
            readdirSync(home).filter((name) => name.endsWith(".bak")),
            [],
        );
    });

    test("creates a new file without a backup", () => {
        const missing = path.join(home, "agent", "new.json");
        const plan = planFor({}, missing);
        const draft = structuredClone(plan.raw);
        const field = plan.sections[0]?.fields[0];
        assert.ok(field);
        const answer = applyAnswer(plan, draft, field, "jdoe");
        assert.ok("change" in answer);
        const result = writeSetup(plan, [answer.change], new Date("2026-11-04T17:00:00.000Z"));
        assert.equal(result.backup, undefined);
        assert.ok(existsSync(missing));
        assert.equal(JSON.parse(readFileSync(missing, "utf8")).acme.bastion.user, "jdoe");
    });
});

describe("a linked settings file", () => {
    const skip = process.platform === "win32" ? "symlinks need a privilege on Windows" : false;

    test("is followed: the link stays a link and the target is written", { skip }, () => {
        const targetDir = path.join(home, "dotfiles", "pi");
        mkdirSync(targetDir, { recursive: true });
        const target = path.join(targetDir, "jig.json");
        const text = JSON.stringify(rawConfig, null, 4);
        writeFileSync(target, text);
        const link = path.join(home, "agent", "jig.json");
        symlinkSync(target, link);

        const plan = planFor(rawConfig, link);
        assert.equal(plan.link, true);
        assert.equal(plan.target, realpathSync(target));
        assert.equal(plan.before, text);
        assert.match(plan.notes[0] ?? "", /is a link to .*jig\.json; that file will be changed\./);

        const draft = structuredClone(plan.raw);
        const changes = [];
        for (const field of [plan.sections[1]?.fields[0], plan.sections[0]?.fields[0]]) {
            assert.ok(field);
            const answer = applyAnswer(plan, draft, field, field.kind === "number" ? "8080" : "jdoe");
            assert.ok("change" in answer);
            changes.push(answer.change);
        }
        const summary = summaryLines(plan, changes).join("\n");
        assert.match(summary, /Your settings file is a link to .* that file will be changed\./);
        assert.ok(!summary.includes("{"));

        const result = writeSetup(plan, changes, new Date("2026-11-04T17:00:00.000Z"));
        assert.equal(result.file, realpathSync(target));
        assert.ok(result.backup);
        assert.equal(lstatSync(link).isSymbolicLink(), true);
        assert.equal(realpathSync(link), realpathSync(target));
        assert.equal(JSON.parse(readFileSync(target, "utf8")).acme.bastion.user, "jdoe");
        assert.equal(JSON.parse(readFileSync(link, "utf8")).lens.port, 8080);
        assert.deepEqual(readdirSync(targetDir).filter((name) => name.endsWith(".bak")).length, 1);
        assert.deepEqual(
            readdirSync(path.dirname(link)).filter((name) => name.endsWith(".bak")),
            [],
        );
    });

    test("a broken link refuses, and changes nothing", { skip }, () => {
        const link = path.join(home, "agent", "jig.json");
        symlinkSync(path.join(home, "missing.json"), link);
        const built = buildSetupPlan(stateFor({}, link));
        assert.ok("problem" in built);
        assert.match(built.problem, /is a link to/);
        assert.match(built.problem, /does not exist/);
        assert.equal(lstatSync(link).isSymbolicLink(), true);
        assert.equal(existsSync(path.join(home, "missing.json")), false);
    });

    test("a link to a folder refuses", { skip }, () => {
        const folder = path.join(home, "dotfiles", "folder");
        mkdirSync(folder, { recursive: true });
        const link = path.join(home, "agent", "jig.json");
        symlinkSync(folder, link);
        const built = buildSetupPlan(stateFor({}, link));
        assert.ok("problem" in built);
        assert.match(built.problem, /which is not a file/);
    });
});

describe("path helpers", () => {
    test("a message names its fields, and only plain dotted paths are safe", () => {
        assert.deepEqual(messagePaths("acme.bastion.user is required", "acme"), ["bastion.user"]);
        assert.deepEqual(messagePaths("acme.sso.token: must be a secret reference", "acme"), ["sso.token"]);
        assert.deepEqual(messagePaths("acme: must be an object", "acme"), []);
        assert.equal(safePath("bastion.user"), true);
        assert.equal(safePath("services.0.host"), false);
        assert.equal(safePath("__proto__.x"), false);
        assert.equal(safePath("a..b"), false);
    });
});
