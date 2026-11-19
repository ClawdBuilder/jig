// The doctor's codemode line in its states: off, on through Pi's defaultTools, on because an MCP server is configured (with
// the reason), and the session's own answer winning over the files. Every folder is a temporary one; nothing real is read.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, test } from "node:test";
import { DOCTOR_CHECKS } from "../src/doctor-checks.ts";
import { codemodeChecks, codemodeInSession, layerCodemode } from "../src/doctor-codemode.ts";

const MCP = " (turned on by Pi: an MCP server is configured)";

let home: string;
let agentDir: string;
let workingDir: string;

beforeEach(() => {
    home = mkdtempSync(path.join(tmpdir(), "jig-doctor-codemode-"));
    agentDir = path.join(home, "agent");
    workingDir = path.join(home, "work");
    mkdirSync(agentDir);
    mkdirSync(path.join(workingDir, ".pi"), { recursive: true });
});

afterEach(() => rmSync(home, { recursive: true, force: true }));

function json(file: string, value: unknown): void {
    writeFileSync(file, JSON.stringify(value));
}

/** The line's detail: what comes after "Codemode — ". */
function detail(codemodeActive?: boolean): string | undefined {
    const [line, ...rest] = codemodeChecks({
        agentDir,
        workingDir,
        ...(codemodeActive === undefined ? {} : { codemodeActive }),
    });
    assert.equal(rest.length, 0);
    if (line === undefined) return undefined;
    assert.deepEqual([line.id, line.group, line.level, line.title], ["config.codemode", "config", "ok", "Codemode"]);
    return line.detail;
}

describe("the doctor's codemode line", () => {
    test("it is off when nothing turns it on", () => {
        assert.equal(detail(), "off");
        json(path.join(agentDir, "settings.json"), { defaultTools: ["read", "bash"] });
        assert.equal(detail(), "off");
    });

    test("it is on when defaultTools adds it, with no reason", () => {
        json(path.join(agentDir, "settings.json"), { defaultTools: ["+codemode"] });
        assert.equal(detail(), "on");
        json(path.join(agentDir, "settings.json"), { defaultTools: ["read", "codemode"] });
        assert.equal(detail(), "on");
    });

    test("it is on, with the reason, when an MCP server is configured", () => {
        json(path.join(agentDir, "mcp.json"), { mcpServers: { docs: { url: "https://example.com/mcp" } } });
        assert.equal(detail(), `on${MCP}`);
    });

    test("an MCP server does not turn it on when autoEnableCodemode is false or every server is off", () => {
        const docs = { url: "https://example.com/mcp" };
        json(path.join(agentDir, "mcp.json"), { autoEnableCodemode: false, mcpServers: { docs } });
        assert.equal(detail(), "off");
        json(path.join(agentDir, "mcp.json"), { mcpServers: { docs: { ...docs, enabled: false } } });
        assert.equal(detail(), "off");
        json(path.join(agentDir, "mcp.json"), { mcpServers: {} });
        assert.equal(detail(), "off");
        writeFileSync(path.join(agentDir, "mcp.json"), "{ not json");
        assert.equal(detail(), "off");
    });

    test("defaultTools and an MCP server together give no reason: the setting is what turned it on", () => {
        json(path.join(agentDir, "settings.json"), { defaultTools: ["+codemode"] });
        json(path.join(agentDir, "mcp.json"), { mcpServers: { docs: { url: "https://example.com/mcp" } } });
        assert.equal(detail(), "on");
    });

    test("the session's answer wins over the files, and the reason still comes from the files", () => {
        assert.equal(detail(true), "on");
        json(path.join(agentDir, "mcp.json"), { mcpServers: { docs: { url: "https://example.com/mcp" } } });
        assert.equal(detail(true), `on${MCP}`);
        assert.equal(detail(false), "off");
        json(path.join(agentDir, "settings.json"), { defaultTools: ["+codemode"] });
        assert.equal(detail(false), "off");
    });

    test("with no folder it says nothing, unless the session answers", () => {
        assert.deepEqual(codemodeChecks({ agentDir: "", workingDir }), []);
        assert.equal(codemodeChecks({ agentDir: "", workingDir, codemodeActive: true })[0]?.detail, "on");
    });

    test("a trusted project's defaultTools lays over the folder's; an untrusted one is not read", () => {
        json(path.join(workingDir, ".pi", "settings.json"), { defaultTools: ["+codemode"] });
        assert.equal(detail(), "off");
        json(path.join(agentDir, "settings.json"), { defaultProjectTrust: "always" });
        assert.equal(detail(), "on");
        json(path.join(agentDir, "settings.json"), { defaultProjectTrust: "always", defaultTools: ["+codemode"] });
        json(path.join(workingDir, ".pi", "settings.json"), { defaultTools: ["-codemode"] });
        assert.equal(detail(), "off");
    });

    test("Pi's defaultTools rule: plain names replace, + and - apply in order, an empty list replaces", () => {
        const cases: Array<[boolean, unknown, boolean]> = [
            [false, ["+codemode"], true],
            [true, ["+grep"], true],
            [true, ["-codemode"], false],
            [true, ["read", "bash"], false],
            [true, [], false],
            [false, ["codemode", "-codemode"], false],
            [false, ["read", "+codemode"], true],
            [true, undefined, true],
            [true, "codemode", true],
        ];
        for (const [before, list, expected] of cases) {
            assert.equal(layerCodemode(before, list), expected, JSON.stringify([before, list]));
        }
    });

    test("it is in the doctor's check list, in the configuration group", () => {
        assert.ok(DOCTOR_CHECKS.some(([group, check]) => group === "config" && check === codemodeChecks));
    });
});

describe("the session's tool list", () => {
    test("codemode among the active tools is on; its absence is off", () => {
        assert.equal(codemodeInSession({ getActiveTools: () => ["read", "codemode"] }), true);
        assert.equal(codemodeInSession({ getActiveTools: () => ["read"] }), false);
    });

    test("no tool list to ask, or one that fails, is no answer", () => {
        assert.equal(codemodeInSession({}), undefined);
        assert.equal(codemodeInSession({ getActiveTools: () => undefined }), undefined);
        assert.equal(
            codemodeInSession({
                getActiveTools: () => {
                    throw new Error("not in a session");
                },
            }),
            undefined,
        );
    });
});
