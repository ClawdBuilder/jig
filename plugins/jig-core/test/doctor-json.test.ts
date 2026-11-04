// The JSON report of `/jig doctor`, schema 1: the fields a reader can rely on, the file it is written to, and the rule
// that no reference and no value is in it.
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, test } from "node:test";
import { defaultConfig, emptyAdditions } from "../src/config.ts";
import type { DoctorContext, DoctorOptions } from "../src/doctor.ts";
import { doctorReportFile, reportJson, writeDoctorReport } from "../src/doctor-json.ts";
import { runDoctor } from "../src/doctor.ts";

let home: string;
let agentDir: string;
let stateDir: string;

beforeEach(() => {
    home = mkdtempSync(path.join(tmpdir(), "jig-json-"));
    agentDir = path.join(home, "agent");
    stateDir = path.join(home, "state");
    mkdirSync(agentDir);
    mkdirSync(stateDir);
    mkdirSync(path.join(home, "pass"), { recursive: true });
});

afterEach(() => {
    rmSync(home, { recursive: true, force: true });
});

function context(): DoctorContext {
    return {
        env: { PATH: "" },
        personal: {
            file: path.join(agentDir, "jig.json"),
            found: true,
            config: defaultConfig(),
            problems: [],
            sections: new Map([["jira", {}]]),
            incomplete: new Map(),
            invalid: new Set(),
        },
        sectionChecks: new Map(),
        company: emptyAdditions(),
        sections: new Map([["jira", { token: "pass:work/jira-token" }]]),
        commands: {},
        protectedPaths: () => [{ path: agentDir, shown: agentDir, kind: "guarded", source: "default" }],
        sandbox: { active: true, mode: "filtered", canWrite: () => false },
        recordsProblem: undefined,
        agentDir,
        configPath: path.join(agentDir, "jig.json"),
        stateDir,
        workingDir: home,
        secrets: { passStoreDir: () => path.join(home, "pass") },
        now: () => new Date("2026-11-04T12:00:00.000Z"),
    };
}

function options(): DoctorOptions {
    return {
        network: false,
        platform: "linux",
        nodeVersion: "24.15.0",
        piVersion: () => "1.5.0",
        jigVersion: "0.3.0",
        jigRepository: "git+https://github.com/example/jig.git",
        home,
        pathLookup: (program) => (program === "pass" ? "/usr/bin/pass" : undefined),
    };
}

function keys(value: unknown, found: string[] = []): string[] {
    if (Array.isArray(value)) {
        for (const item of value) keys(item, found);
    } else if (typeof value === "object" && value !== null) {
        for (const [key, item] of Object.entries(value)) {
            found.push(key);
            keys(item, found);
        }
    }
    return found;
}

describe("the JSON report", () => {
    test("has schema 1, the version facts and a summary a script can read", async () => {
        const report = await runDoctor(context(), options());
        const json = reportJson(report, new Date("2026-11-04T12:00:00.000Z"));

        assert.equal(json.schema, 1);
        assert.equal(json.generated, "2026-11-04T12:00:00.000Z");
        assert.equal(json.jig, "0.3.0");
        assert.equal(json.pi, "1.5.0");
        assert.equal(json.node, "24.15.0");
        assert.equal(json.platform, "linux");
        assert.equal(json.network, false);
        assert.deepEqual({ ...json.summary }, { ...report.counts });
        assert.deepEqual(Object.keys(json.summary).sort(), ["fail", "ok", "skip", "warn"]);
        assert.equal(Date.parse(json.generated), Date.parse("2026-11-04T12:00:00.000Z"));
    });

    test("lists each group that has a check, and each check has the fields the schema names", async () => {
        const report = await runDoctor(context(), options());
        const json = reportJson(report, new Date("2026-11-04T12:00:00.000Z"));
        assert.deepEqual(
            json.groups.map((group) => group.id),
            ["machine", "config", "secrets", "logins", "network", "sandbox", "records"],
        );
        for (const group of json.groups) {
            assert.equal(typeof group.title, "string");
            assert.ok(group.checks.length > 0);
            for (const check of group.checks) {
                assert.equal(typeof check.id, "string");
                assert.ok(["ok", "warn", "fail", "skip"].includes(check.level));
                assert.equal(typeof check.title, "string");
                if (check.detail !== undefined) assert.equal(typeof check.detail, "string");
                if (check.fix !== undefined) assert.equal(typeof check.fix, "string");
                if (check.data !== undefined) {
                    for (const value of Object.values(check.data)) {
                        assert.ok(["string", "number", "boolean"].includes(typeof value));
                    }
                }
            }
        }
    });

    test("holds no reference and no value, only a store name and an entry in the fix", async () => {
        const report = await runDoctor(context(), options());
        const json = reportJson(report, new Date("2026-11-04T12:00:00.000Z"));
        const jira = json.groups
            .flatMap((group) => group.checks)
            .find((check) => check.id === "secrets.ref.jira.token");
        assert.equal(jira?.level, "fail");
        assert.equal(jira?.detail, "Your Jira token is missing from pass.");
        assert.equal(jira?.fix, "pass insert work/jira-token");
        assert.equal(jira?.data, undefined);

        const shown = JSON.stringify(json);
        assert.ok(!shown.includes("pass:work/jira-token"));
        assert.ok(!shown.includes('"reference"'));
        for (const key of keys(json)) {
            assert.ok(!["value", "secret", "reference"].includes(key), `the JSON has a ${key} field`);
        }
    });

    test("is written as one private file, replacing the last report", async () => {
        const report = await runDoctor(context(), options());
        const file = doctorReportFile(path.join(home, "not-there-yet"));
        writeDoctorReport(report, file, new Date("2026-11-04T12:00:00.000Z"));
        assert.ok(existsSync(file));
        assert.equal(JSON.parse(readFileSync(file, "utf8")).schema, 1);
        if (process.platform !== "win32") assert.equal(statSync(file).mode & 0o777, 0o600);

        const second = await runDoctor(context(), options());
        writeDoctorReport(second, file, new Date("2026-11-04T13:00:00.000Z"));
        assert.equal(JSON.parse(readFileSync(file, "utf8")).generated, "2026-11-04T13:00:00.000Z");
    });
});
