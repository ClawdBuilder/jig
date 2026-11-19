// The doctor's codemode line: the session's answer, and the reason an MCP server gives when the files show one. Without a
// session the line is a skip that sends the person to /jig doctor inside Pi. Every folder is a temporary one.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, test } from "node:test";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { DOCTOR_CHECKS, doctorContext } from "../src/doctor-checks.ts";
import { codemodeChecks, codemodeInSession } from "../src/doctor-codemode.ts";
import { createState } from "../src/state.ts";

const MCP = " (turned on by Pi: an MCP server is configured)";
const DOCS = { url: "https://example.com/mcp" };

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

const user = (name: string) => path.join(agentDir, name);
const project = (name: string) => path.join(workingDir, ".pi", name);

/** Pi's folder trusts every project, as `defaultProjectTrust: "always"` does. */
function trustProjects(): void {
    json(user("settings.json"), { defaultProjectTrust: "always" });
}

/** The line's detail for a session that says codemode is `active`. */
function detail(active: boolean | undefined): string | undefined {
    const [line, ...rest] = codemodeChecks({
        agentDir,
        workingDir,
        ...(active === undefined ? {} : { codemodeActive: active }),
    });
    assert.equal(rest.length, 0);
    assert.deepEqual([line?.id, line?.group, line?.title], ["config.codemode", "config", "Codemode"]);
    return line?.detail;
}

describe("the doctor's codemode line in a session", () => {
    test("it is off when Pi says so, whatever the files hold", () => {
        assert.equal(detail(false), "off");
        json(user("settings.json"), { defaultTools: ["+codemode"] });
        json(user("mcp.json"), { mcpServers: { docs: DOCS } });
        assert.equal(detail(false), "off");
    });

    test("it is on, with no reason, when defaultTools names codemode", () => {
        json(user("settings.json"), { defaultTools: ["+codemode"] });
        assert.equal(detail(true), "on");
        json(user("mcp.json"), { mcpServers: { docs: DOCS } });
        assert.equal(detail(true), "on");
        json(user("settings.json"), { defaultTools: ["read", "codemode"] });
        assert.equal(detail(true), "on");
    });

    test("it is on, with no reason, when nothing in the files explains it (a flag, an extension)", () => {
        assert.equal(detail(true), "on");
    });

    test("an MCP server of the default exposure gives the reason", () => {
        json(user("mcp.json"), { mcpServers: { docs: DOCS } });
        assert.equal(detail(true), `on${MCP}`);
        json(user("mcp.json"), { mcpServers: { docs: { ...DOCS, exposure: "codemode" } } });
        assert.equal(detail(true), `on${MCP}`);
        json(user("mcp.json"), {
            mcpServers: { docs: { ...DOCS, exposure: "direct", toolExposure: { search: "codemode" } } },
        });
        assert.equal(detail(true), `on${MCP}`);
        json(user("mcp.json"), { mcpServers: { local: { command: "docs-server" } } });
        assert.equal(detail(true), `on${MCP}`);
    });

    test("a server that would not turn it on gives no reason", () => {
        for (const server of [
            { ...DOCS, exposure: "direct" },
            { ...DOCS, exposure: "hidden" },
            { ...DOCS, exposure: "deferred" },
            { ...DOCS, enabled: false },
            { description: "no command and no URL" },
        ]) {
            json(user("mcp.json"), { mcpServers: { docs: server } });
            assert.equal(detail(true), "on", JSON.stringify(server));
        }
        json(user("mcp.json"), { autoEnableCodemode: false, mcpServers: { docs: DOCS } });
        assert.equal(detail(true), "on");
        json(user("mcp.json"), { mcpServers: {} });
        assert.equal(detail(true), "on");
        writeFileSync(user("mcp.json"), "{ not json");
        assert.equal(detail(true), "on");
    });

    test("a trusted project's mcp.json adds a server, overrides one and sets autoEnableCodemode", () => {
        trustProjects();
        json(project("mcp.json"), { mcpServers: { docs: DOCS } });
        assert.equal(detail(true), `on${MCP}`);

        json(user("mcp.json"), { mcpServers: { docs: DOCS } });
        json(project("mcp.json"), { autoEnableCodemode: false });
        assert.equal(detail(true), "on");

        json(user("mcp.json"), { autoEnableCodemode: false, mcpServers: { docs: DOCS } });
        json(project("mcp.json"), { autoEnableCodemode: true });
        assert.equal(detail(true), `on${MCP}`);

        json(user("mcp.json"), { mcpServers: { docs: DOCS } });
        json(project("mcp.json"), { mcpServers: { docs: { enabled: false } } });
        assert.equal(detail(true), "on");

        json(user("mcp.json"), { mcpServers: { docs: { ...DOCS, exposure: "direct" } } });
        json(project("mcp.json"), { mcpServers: { docs: { enabled: true } } });
        assert.equal(detail(true), "on");
        json(project("mcp.json"), { mcpServers: { docs: { exposure: "codemode" } } });
        assert.equal(detail(true), `on${MCP}`);
    });

    test("a project's files are not read when Pi would not trust the folder", () => {
        json(project("mcp.json"), { mcpServers: { docs: DOCS } });
        assert.equal(detail(true), "on");
        json(project("settings.json"), { defaultTools: ["+codemode"] });
        json(user("mcp.json"), { mcpServers: { docs: DOCS } });
        assert.equal(detail(true), `on${MCP}`);
        trustProjects();
        assert.equal(detail(true), "on");
    });

    test("with no Pi folder the session's answer stands, with no reason", () => {
        assert.equal(codemodeChecks({ agentDir: "", workingDir, codemodeActive: true })[0]?.detail, "on");
        assert.equal(codemodeChecks({ agentDir: "", workingDir, codemodeActive: false })[0]?.detail, "off");
    });
});

describe("the doctor's codemode line outside a session", () => {
    test("it is a skip that says where to look, and no file is read", () => {
        json(user("settings.json"), { defaultTools: ["+codemode"] });
        json(user("mcp.json"), { mcpServers: { docs: DOCS } });
        const lines = codemodeChecks({ agentDir, workingDir });
        assert.deepEqual(lines, [
            {
                id: "config.codemode",
                group: "config",
                level: "skip",
                title: "Codemode",
                detail: "Pi decides this when a session starts; /jig doctor inside Pi shows it.",
            },
        ]);
        assert.deepEqual(codemodeChecks({ agentDir: "", workingDir: "" }), lines);
    });

    test("a session's line is level ok, on or off", () => {
        assert.equal(codemodeChecks({ agentDir, workingDir, codemodeActive: true })[0]?.level, "ok");
        assert.equal(codemodeChecks({ agentDir, workingDir, codemodeActive: false })[0]?.level, "ok");
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

    test("doctorContext reads it from the state's Pi: a session answers, the headless Pi does not", () => {
        const withTools = (names: string[]) =>
            doctorContext(createState({ getActiveTools: () => names } as unknown as ExtensionAPI, { env: {} }));
        assert.equal(withTools(["read", "codemode"]).codemodeActive, true);
        assert.equal(withTools(["read"]).codemodeActive, false);
        // The `jig` command's Pi answers every unknown method with a function that returns nothing.
        const headless = new Proxy({}, { get: () => () => undefined }) as unknown as ExtensionAPI;
        assert.equal(doctorContext(createState(headless, { env: {} })).codemodeActive, undefined);
        assert.equal(doctorContext(createState({} as ExtensionAPI, { env: {} })).codemodeActive, undefined);
    });

    test("it is in the doctor's check list, in the configuration group", () => {
        assert.ok(DOCTOR_CHECKS.some(([group, check]) => group === "config" && check === codemodeChecks));
    });
});
