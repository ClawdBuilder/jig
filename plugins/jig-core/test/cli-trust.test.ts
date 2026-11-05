// Pi's project trust, read the way Pi 1.5 reads it: the closest saved decision in trust.json, null does not decide, and
// without one only the agent folder's defaultProjectTrust ("always" is the only yes outside Pi's screen). Failing closed.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, test } from "node:test";
import { projectTrust, untrustedDetail, untrustedSetupLine } from "../src/cli/trust.ts";

let root: string;
let agent: string;
let parent: string;
let work: string;

beforeEach(() => {
    root = realpathSync(mkdtempSync(path.join(tmpdir(), "jig-trust-")));
    agent = path.join(root, "agent");
    parent = path.join(root, "parent");
    work = path.join(parent, "work");
    mkdirSync(agent, { recursive: true });
    mkdirSync(work, { recursive: true });
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

const trust = (entries: Record<string, unknown>): void =>
    writeFileSync(path.join(agent, "trust.json"), JSON.stringify(entries));
const agentSettings = (defaultProjectTrust: unknown): void =>
    writeFileSync(path.join(agent, "settings.json"), JSON.stringify({ defaultProjectTrust }));

describe("Pi's trust for one folder", () => {
    test("no trust.json and no default: not trusted, with the plain reason", () => {
        const read = projectTrust(agent, work);
        assert.equal(read.trusted, false);
        assert.equal(read.source, "default");
        assert.match(read.reason ?? "", /not trusted this folder in Pi/);
    });

    test("the exact folder marked false is not trusted", () => {
        trust({ [work]: false });
        const read = projectTrust(agent, work);
        assert.equal(read.trusted, false);
        assert.equal(read.source, "saved");
    });

    test("the exact folder marked true is trusted", () => {
        trust({ [work]: true });
        assert.equal(projectTrust(agent, work).trusted, true);
    });

    test("a parent's true trusts the folder", () => {
        trust({ [parent]: true });
        assert.equal(projectTrust(agent, work).trusted, true);
    });

    test("a closer false beats a parent's true", () => {
        trust({ [parent]: true, [work]: false });
        assert.equal(projectTrust(agent, work).trusted, false);
    });

    test("null does not decide: the parent's true wins", () => {
        trust({ [work]: null, [parent]: true });
        assert.equal(projectTrust(agent, work).trusted, true);
    });

    test("defaultProjectTrust always in the agent settings loads", () => {
        agentSettings("always");
        assert.equal(projectTrust(agent, work).trusted, true);
    });

    test("defaultProjectTrust always in the project's settings only does not load", () => {
        mkdirSync(path.join(work, ".pi"), { recursive: true });
        writeFileSync(path.join(work, ".pi/settings.json"), JSON.stringify({ defaultProjectTrust: "always" }));
        assert.equal(projectTrust(agent, work).trusted, false);
    });

    test("ask and never do not load, and neither does an unknown value", () => {
        for (const value of ["ask", "never", "sometimes"]) {
            agentSettings(value);
            const read = projectTrust(agent, work);
            assert.equal(read.trusted, false, value);
        }
    });

    test("a malformed trust.json fails closed with a plain line and no parser text", () => {
        writeFileSync(path.join(agent, "trust.json"), "{ not json");
        const read = projectTrust(agent, work);
        assert.equal(read.trusted, false);
        assert.match(read.reason ?? "", /trust file is damaged/);
        assert.doesNotMatch(read.reason ?? "", /Unexpected token|JSON|not json/);
        assert.match(read.fix ?? "", /repair it/);
        const detail = untrustedDetail(["git:github.com/acme/tool"], read);
        assert.match(detail, /not loaded \(git:github\.com\/acme\/tool\): Pi's trust file is damaged/);
        assert.doesNotMatch(detail, /Open Pi here|then run jig/);
        assert.match(
            untrustedSetupLine(["git:github.com/acme/tool"], read),
            /Repair or delete that file, then run jig setup again/,
        );
    });

    test("a value Pi would reject fails closed, quietly", () => {
        trust({ [work]: "yes" });
        const read = projectTrust(agent, work);
        assert.equal(read.trusted, false);
        assert.match(read.reason ?? "", /trust file is damaged/);
    });

    test("a folder marked not trusted says so, and /trust is the way out", () => {
        trust({ [work]: false });
        const read = projectTrust(agent, work);
        assert.match(read.reason ?? "", /marked not trusted in Pi/);
        assert.match(read.fix ?? "", /\/trust/);
        assert.match(
            untrustedSetupLine(["git:github.com/acme/tool"], read),
            /Run \/trust in Pi to change it, or run jig setup from another folder/,
        );
    });

    test("the detail names what was skipped, and the setup line names setup and the way out", () => {
        const read = projectTrust(agent, parent);
        assert.match(untrustedDetail(["git:github.com/acme/tool"], read), /not loaded \(git:github\.com\/acme\/tool\)/);
        const setup = untrustedSetupLine(["git:github.com/acme/tool"], read);
        assert.match(setup, /Open Pi here and choose Trust, or run jig setup from another folder/);
    });
});
