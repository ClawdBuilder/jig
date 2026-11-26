// A gateway for the tests that need one: a runtime over a state folder and a settings folder of its own, a clock moved by hand and the lines it wrote to
// standard error, with no Pi. `useGateways` closes every gateway a test file opened. The tools are declared in the test: `echoTool` works on a folder and says where it
// ran, `slowTool` shows whether calls to it run one at a time, and `stampTool` (test/support/test-tool.ts) reads, writes and fails.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { afterEach } from "node:test";
import type { ConnectorModule, EngineTool } from "../../src/engine-tool.ts";
import { createGatewayRuntime } from "../../src/gateway/runtime.ts";
import type { CallOrigin, CallResult, GatewayRuntime, RuntimeOptions } from "../../src/gateway/runtime.ts";
import { fakeClock } from "../support/clock.ts";
import { readRecords, tempState } from "../support/state.ts";
import { SIGNAL } from "./harness.ts";

export interface Gateway {
    runtime: GatewayRuntime;
    stateDir: string;
    /** The folder that holds jig.json. */
    settings: string;
    /** The folder the gateway was started in. */
    cwd: string;
    /** What was written to standard error. */
    lines: string[];
    call(name: string, args: Record<string, unknown>, id?: string, extra?: Partial<CallOrigin>): Promise<CallResult>;
    records(): Array<Record<string, unknown>>;
    /** A new empty folder, removed when the test ends. */
    folder(prefix: string): string;
}

export interface GatewayOptions {
    connectors: ConnectorModule[];
    /** What jig.json holds. Without it no file is written. */
    config?: unknown;
    /** False: no settings folder was found. */
    settings?: boolean;
    startup?: string[];
    env?: NodeJS.ProcessEnv;
    engine?: RuntimeOptions["engine"];
}

/** Opens a gateway over a state folder and a settings folder of its own, and closes every one a test file opened after each test. Call it once at the top of the file. */
export function useGateways(): (options: GatewayOptions) => Gateway {
    const closers: Array<() => Promise<void>> = [];
    afterEach(async () => {
        // The last one opened is closed first, so that each puts back the state folder it found.
        for (const close of closers.splice(0).reverse()) await close();
    });
    return (options) => openGateway(options, (close) => closers.push(close));
}

function openGateway(options: GatewayOptions, onClose: (close: () => Promise<void>) => void): Gateway {
    const temp = tempState();
    const stateDir = temp.start();
    const root = mkdtempSync(path.join(tmpdir(), "jig-gateway-"));
    const settings = path.join(root, "settings");
    const cwd = path.join(root, "work");
    mkdirSync(settings);
    mkdirSync(cwd);
    if (options.config !== undefined) writeFileSync(path.join(settings, "jig.json"), JSON.stringify(options.config));
    const clock = fakeClock();
    const lines: string[] = [];
    const runtime = createGatewayRuntime({
        connectors: options.connectors,
        ...(options.startup === undefined ? {} : { startup: options.startup }),
        settings: options.settings === false ? undefined : { folder: settings, source: "argument" },
        env: options.env ?? { ...process.env },
        cwd,
        stderr: (line) => lines.push(line),
        engine: { now: clock.date, timers: clock.timers, ...options.engine },
    });
    onClose(async () => {
        await runtime.stop();
        temp.stop();
        rmSync(root, { recursive: true, force: true });
    });
    return {
        runtime,
        stateDir,
        settings,
        cwd,
        lines,
        call: (name, args, id = "call-1", extra = {}) =>
            runtime.call(name, args, {
                agent: { name: "Claude-Code", version: "2.1" },
                callId: id,
                signal: SIGNAL,
                ...extra,
            }),
        records: () => readRecords(stateDir),
        folder(prefix) {
            return mkdtempSync(path.join(root, prefix));
        },
    };
}

/** What a tool saw when it ran. */
export interface Seen {
    input: Record<string, unknown>;
    cwd: string;
    hasProgress: boolean;
}

/** A tool that works on a folder: it says where it ran, and what input it was given. `leak` is an action its connector keeps back. */
export function echoTool(seen: Seen[]): EngineTool {
    return {
        tool: "echo",
        plugin: "jig-test",
        label: "Echo",
        description: "Says where it runs.",
        usesFolder: true,
        input: {
            type: "object",
            properties: { action: { type: "string", enum: ["read", "leak"] }, text: { type: "string" } },
            required: ["action"],
            additionalProperties: false,
        },
        classify: () => ({ action: "read", environment: "local", effect: "read" }),
        async execute(input, call) {
            seen.push({ input: { ...input }, cwd: call.cwd, hasProgress: call.progress !== undefined });
            call.progress?.("working");
            return { text: `echo ${call.cwd}` };
        },
    };
}

/** A tool whose calls take a while, and say when they start and end. */
export function slowTool(order: string[], sequential: boolean): EngineTool {
    return {
        tool: "slow",
        plugin: "jig-test",
        label: "Slow",
        description: "Waits.",
        input: { type: "object", properties: { text: { type: "string" } }, additionalProperties: false },
        sequential,
        classify: () => ({ environment: "local", effect: "read" }),
        async execute(input) {
            const name = String(input.text);
            order.push(`start ${name}`);
            await sleep(name === "a" ? 80 : 0);
            order.push(`end ${name}`);
            return { text: name };
        },
    };
}

export const withTools = (name: string, tools: EngineTool[], rest: Partial<ConnectorModule> = {}): ConnectorModule => ({
    name,
    tools,
    ...rest,
});
