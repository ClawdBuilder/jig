// The engine's test harness: a host of our own, a state folder and a settings folder of our own, a clock moved by hand and a reader of the
// records, and no Pi. These tests run in a process that refuses every Pi package (`npm run test:engine`), so a read of Pi in the engine
// fails them. `openWorld` builds an engine over such a host; `useWorlds` closes every world a test file opened.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach } from "node:test";
import type { Approval, AskRequest } from "../../src/ask.ts";
import type { EngineOptions } from "../../src/engine-options.ts";
import { createEngine } from "../../src/engine.ts";
import type { CallRequest, Engine, EngineHost, ToolInfo } from "../../src/engine.ts";
import type { WatchMessage } from "../../src/watch/message.ts";
import { fakeClock } from "../support/clock.ts";
import type { FakeClock } from "../support/clock.ts";
import { readRecords, tempState } from "../support/state.ts";

/** What the host was given, in order. */
export interface HostLog {
    asked: AskRequest[];
    notices: Array<{ text: string; level: string }>;
    woke: WatchMessage[];
    emitted: Array<{ name: string; event: unknown }>;
}

export interface WorldOptions {
    /** The content of jig.json, written to the settings folder before the engine starts. Default: no file. */
    config?: unknown;
    /** What the host says: whether a question can reach anyone (default true) and whether one about a protected path can (default false). */
    canAsk?: boolean;
    canAskProtected?: boolean;
    /** What `ask` answers, in order: an approval, or `"later"`. After the list it allows. */
    answers?: Array<Approval | "later">;
    /** What the agent says about its tools, by name. Default: nothing. */
    tools?: Record<string, ToolInfo>;
    /** What `notify` and `wake` return: false says nobody saw the notice, or the agent could not be woken. Default true. */
    shown?: boolean;
    woken?: boolean;
    /** Changes to what the engine is made with. */
    engine?: Partial<EngineOptions>;
}

export interface World {
    engine: Engine;
    host: EngineHost;
    log: HostLog;
    clock: FakeClock;
    /** The settings folder: jig.json is here. */
    settings: string;
    /** The working folder the host reports. */
    cwd: string;
    /** The state folder: records, spill files and masking keys go here. */
    stateDir: string;
    /** Every record line written so far, parsed. */
    records(): Array<Record<string, unknown>>;
    close(): Promise<void>;
}

export const ALLOW: Approval = { answer: "allow", dismissed: false, waitedMs: 5 };
export const SIGNAL = new AbortController().signal;

export const request = (tool: string, callId = "call-1", input: Record<string, unknown> = {}): CallRequest => ({
    callId,
    tool,
    input,
});

/** The event the host was handed at a place of the list (a negative place counts from the end). */
export function eventAt(log: HostLog, at: number): Record<string, unknown> {
    return (log.emitted.at(at)?.event ?? {}) as Record<string, unknown>;
}

/** An engine over a host with no agent behind it. It is told it is a child agent, so a start sets no background job going. */
export function openWorld(options: WorldOptions = {}): World {
    const temp = tempState();
    const stateDir = temp.start();
    const root = mkdtempSync(path.join(tmpdir(), "jig-engine-"));
    const settings = path.join(root, "settings");
    const cwd = path.join(root, "work");
    mkdirSync(settings);
    mkdirSync(cwd);
    if (options.config !== undefined) writeFileSync(path.join(settings, "jig.json"), JSON.stringify(options.config));
    const clock = fakeClock();
    const engine = createEngine({
        configPath: () => path.join(settings, "jig.json"),
        env: { ...process.env, PI_SUBAGENT_ID: "test-child" },
        now: clock.date,
        timers: clock.timers,
        ...options.engine,
    });
    const log: HostLog = { asked: [], notices: [], woke: [], emitted: [] };
    const answers = [...(options.answers ?? [])];
    const host: EngineHost = {
        agent: { name: "test", version: "1" },
        session: { id: "session-1", role: "main" },
        cwd,
        canAsk: options.canAsk ?? true,
        canAskProtected: options.canAskProtected ?? false,
        toolInfo: (name) => options.tools?.[name],
        ask: async (asked) => {
            log.asked.push(asked);
            return answers.shift() ?? ALLOW;
        },
        notify: (text, level) => {
            log.notices.push({ text, level });
            return options.shown ?? true;
        },
        wake: async (message) => {
            log.woke.push(message);
            return options.woken ?? true;
        },
        emit: (name, event) => {
            log.emitted.push({ name, event });
        },
    };
    return {
        engine,
        host,
        log,
        clock,
        settings,
        cwd,
        stateDir,
        records: () => readRecords(stateDir),
        async close() {
            await engine.stop();
            temp.stop();
            rmSync(root, { recursive: true, force: true });
        },
    };
}

/** Closes every world a test file opened, after each test. Call it once at the top of the file; it gives `openWorld` back. */
export function useWorlds(): (options?: WorldOptions) => World {
    const open: World[] = [];
    afterEach(async () => {
        // The last one opened is closed first, so that each puts back the state folder it found.
        for (const world of open.splice(0).reverse()) await world.close();
    });
    return (options) => {
        const world = openWorld(options);
        open.push(world);
        return world;
    };
}
