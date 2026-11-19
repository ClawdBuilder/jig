// The doctor's company Jig-range finding: inside says nothing, below and above warn with the package, range and this Jig.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, test } from "node:test";
import { companyRangeChecks } from "../src/doctor-company-range.ts";
import type { DoctorContext, DoctorOptions } from "../src/doctor.ts";

let root: string;
let agentDir: string;
let workingDir: string;

beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), "jig-company-range-"));
    agentDir = path.join(root, "agent");
    workingDir = path.join(root, "work");
    mkdirSync(agentDir);
    mkdirSync(workingDir);
});

afterEach(() => rmSync(root, { recursive: true, force: true }));

function install(companies: Array<{ name: string; range?: string }>): DoctorContext {
    const packages: string[] = [];
    for (const [index, company] of companies.entries()) {
        const folder = path.join(root, `company-${index}`);
        mkdirSync(folder);
        writeFileSync(
            path.join(folder, "package.json"),
            JSON.stringify({
                name: company.name,
                version: "1.0.0",
                ...(company.range === undefined ? {} : { jig: { range: company.range } }),
            }),
        );
        packages.push(folder);
    }
    writeFileSync(path.join(agentDir, "settings.json"), JSON.stringify({ packages }));
    return { agentDir, workingDir } as DoctorContext;
}

const at = (version: string): DoctorOptions => ({ jigVersion: version });

test("inside the range says nothing", () => {
    const context = install([{ name: "@acme/jig-company", range: ">=0.4.0 <0.5.0" }]);
    assert.deepEqual(companyRangeChecks(context, at("0.4.5")), []);
});

test("below the range warns, naming the package, the range and this Jig; in a Pi folder the fix is an install", () => {
    const context = install([{ name: "@acme/jig-company", range: ">=0.4.0 <0.5.0" }]);
    const [line] = companyRangeChecks(context, at("0.3.0"));
    assert.equal(line?.level, "warn");
    assert.match(line?.detail ?? "", /@acme\/jig-company allows >=0\.4\.0 <0\.5\.0; this Jig is 0\.3\.0/);
    assert.match(
        line?.fix ?? "",
        /^Run pi install npm:@clawdbuilder\/jig@<version> with a version inside that range, or ask/,
    );
    assert.doesNotMatch(line?.fix ?? "", /jig update/);
});

test("in the Jig home the fix is jig update", () => {
    const context = install([{ name: "@acme/jig-company", range: ">=0.4.0 <0.5.0" }]);
    const saved = process.env.JIG_HOME;
    process.env.JIG_HOME = agentDir;
    try {
        const [line] = companyRangeChecks(context, at("0.3.0"));
        assert.match(
            line?.fix ?? "",
            /^Run jig update, or ask for a @acme\/jig-company package that fits Jig 0\.3\.0\./,
        );
    } finally {
        if (saved === undefined) delete process.env.JIG_HOME;
        else process.env.JIG_HOME = saved;
    }
});

test("above the range warns too", () => {
    const context = install([{ name: "@acme/jig-company", range: ">=0.4.0 <0.5.0" }]);
    const [line] = companyRangeChecks(context, at("0.5.0"));
    assert.equal(line?.level, "warn");
    assert.match(line?.detail ?? "", /this Jig is 0\.5\.0/);
});

test("a package with no range says nothing", () => {
    const context = install([{ name: "@acme/jig-company" }]);
    assert.deepEqual(companyRangeChecks(context, at("0.9.0")), []);
});

test("two companies each get their own line", () => {
    const context = install([
        { name: "@acme/one", range: ">=0.4.0 <0.5.0" },
        { name: "@acme/two", range: ">=0.3.0 <0.6.0" },
    ]);
    const lines = companyRangeChecks(context, at("0.5.0"));
    assert.deepEqual(
        lines.map((line) => line.title),
        ["Company Jig range — @acme/one"],
    );
    assert.match(lines[0]?.detail ?? "", /@acme\/one/);
});

test("an unreadable range is a warning, not silence", () => {
    const context = install([{ name: "@acme/jig-company", range: "not a range" }]);
    const [line] = companyRangeChecks(context, at("0.4.5"));
    assert.equal(line?.level, "warn");
    assert.match(line?.detail ?? "", /cannot read/);
});
