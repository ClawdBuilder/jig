// The status file of one session: what it holds (schema 1, see the README) and when it is written. The heavy parts (the
// session's totals, the ticket folder) are read again only when something that changes them happened; a check every
// `tickMs` notices a changed ticket, tool set or idle state, and writes only when the file's content would change.
import path from "node:path";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Activity } from "./activity.ts";
import type { Output, Recent } from "./activity.ts";
import { fileName, removeFile, sessionsDir, sweep, writeAtomic } from "./files.ts";
import { activeTicket, readTicket, ticketsFolder, workflowFolders } from "./ticket.ts";
import type { TicketView, WorkflowView } from "./ticket.ts";
import { contextFill, sessionUsage } from "./usage.ts";
import type { ContextFill, Usage } from "./usage.ts";

export const SCHEMA = 1;

/** Variables a terminal host sets in the terminals it runs, in the order they are looked at: herdr-core, WezTerm, kitty, tmux.
 *  The first one set names the terminal. tmux comes last because a host may run inside it. */
export const TERMINAL_VARIABLES = ["HC_TERMINAL_ID", "WEZTERM_PANE", "KITTY_WINDOW_ID", "TMUX_PANE"] as const;

/** The terminal Pi runs in, and the variable that named it. */
export function terminalOf(env: NodeJS.ProcessEnv): { terminal: string | null; terminalFrom: string | null } {
    for (const name of TERMINAL_VARIABLES) {
        const value = env[name]?.trim();
        if (value) return { terminal: value.slice(0, 100), terminalFrom: name };
    }
    return { terminal: null, terminalFrom: null };
}

export interface SessionStatus {
    schema: typeof SCHEMA;
    session: string;
    pid: number;
    cwd: string;
    /** The terminal Pi runs in, as the program that hosts it names it (`t7`, `%3`), or null when none is known. */
    terminal: string | null;
    /** The variable `terminal` came from, which says whose name it is: see TERMINAL_VARIABLES. */
    terminalFrom: string | null;
    agentDir: string;
    model: { provider: string; id: string; name: string } | null;
    thinking: string | null;
    state: "busy" | "idle";
    context: ContextFill;
    usage: Usage;
    tools: { active: number; total: number };
    ticket: TicketView | null;
    workflow: WorkflowView | null;
    outputs: Output[];
    recent: Recent[];
    startedAt: string;
    updatedAt: string;
}

/** What the status reads from outside Pi's context: configuration and places. A test gives its own. */
export interface Sources {
    env: NodeJS.ProcessEnv;
    stateDir: () => string;
    agentDir: () => string;
    /** A section of jig.json as jig-core loaded it, or undefined. Never a credential: `memory`, `workflow` and `jira`'s `site`. */
    section: (name: string) => unknown;
    tools: () => { active: number; total: number };
    thinking: () => string | null;
    now: () => Date;
}

export class StatusFile {
    readonly activity: Activity;
    private ctx: ExtensionContext | undefined;
    private file: string | undefined;
    private startedAt = "";
    private busy = false;
    private usage: Usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 };
    private ticketKey: string | undefined;
    private ticket: { ticket: TicketView; workflow?: WorkflowView } | undefined;
    private ticketReadAt = 0;
    private last = "";
    private timer: NodeJS.Timeout | undefined;
    private readonly sources: Sources;

    constructor(sources: Sources) {
        this.sources = sources;
        this.activity = new Activity(sources.now);
    }

    /** The file of the running session, or undefined between sessions. */
    get path(): string | undefined {
        return this.file;
    }

    start(ctx: ExtensionContext, tickMs: number): void {
        this.stop();
        this.ctx = ctx;
        this.activity.reset();
        this.busy = false;
        this.last = "";
        this.ticketKey = undefined;
        this.ticket = undefined;
        this.startedAt = this.sources.now().toISOString();
        const dir = sessionsDir(this.sources.stateDir());
        sweep(dir);
        this.file = path.join(dir, fileName(ctx.sessionManager.getSessionId()));
        this.refresh();
        if (tickMs > 0) {
            this.timer = setInterval(() => this.tick(), tickMs);
            this.timer.unref();
        }
    }

    /** The session ends: the file goes. Safe to call twice. */
    stop(): void {
        if (this.timer !== undefined) clearInterval(this.timer);
        this.timer = undefined;
        if (this.file !== undefined) removeFile(this.file);
        this.file = undefined;
        this.ctx = undefined;
    }

    setBusy(busy: boolean): void {
        this.busy = busy;
        this.write();
    }

    /** Reads everything again (totals, ticket folder) and writes. After a turn, a model change, a session start. */
    refresh(ctx?: ExtensionContext): void {
        if (ctx !== undefined && this.file !== undefined) this.ctx = ctx;
        if (this.ctx === undefined) return;
        try {
            this.usage = sessionUsage(this.ctx);
        } catch {
            // keep the last totals
        }
        this.readTicket(true);
        this.write();
    }

    /** The cheap check: a new ticket, tool set or state shows up here. Every few seconds the ticket folder is read again too. */
    tick(): void {
        if (this.ctx === undefined) return;
        this.readTicket(this.sources.now().getTime() - this.ticketReadAt > 10_000);
        this.write();
    }

    private readTicket(force: boolean): void {
        const ctx = this.ctx;
        if (ctx === undefined) return;
        let key: string | undefined;
        try {
            key = activeTicket(ctx.sessionManager.getBranch());
        } catch {
            key = this.ticketKey;
        }
        if (key === this.ticketKey && !force) return;
        this.ticketKey = key;
        this.ticketReadAt = this.sources.now().getTime();
        if (key === undefined) {
            this.ticket = undefined;
            return;
        }
        const trusted = (() => {
            try {
                return ctx.isProjectTrusted();
            } catch {
                return false;
            }
        })();
        const folders = workflowFolders(this.sources.section("workflow"), this.sources.agentDir(), ctx.cwd, trusted);
        this.ticket = readTicket(
            key,
            ticketsFolder(this.sources.section("memory"), this.sources.env),
            this.sources.section("jira"),
            folders,
        );
    }

    /** The status as it is now. */
    snapshot(): SessionStatus | undefined {
        const ctx = this.ctx;
        if (ctx === undefined) return undefined;
        const model = ctx.model;
        let idle = !this.busy;
        try {
            idle = ctx.isIdle() && !this.busy;
        } catch {
            // the last state we were told
        }
        return {
            schema: SCHEMA,
            session: ctx.sessionManager.getSessionId(),
            pid: process.pid,
            cwd: ctx.cwd,
            ...terminalOf(this.sources.env),
            agentDir: this.sources.agentDir(),
            model: model ? { provider: model.provider, id: model.id, name: model.name ?? model.id } : null,
            thinking: this.sources.thinking(),
            state: idle ? "idle" : "busy",
            context: contextFill(ctx),
            usage: this.usage,
            tools: this.sources.tools(),
            ticket: this.ticket?.ticket ?? null,
            workflow: this.ticket?.workflow ?? null,
            outputs: this.activity.outputs,
            recent: this.activity.recent,
            startedAt: this.startedAt,
            updatedAt: "",
        };
    }

    /** Writes the file when its content changed. Returns whether it wrote. */
    write(): boolean {
        if (this.file === undefined) return false;
        const status = this.snapshot();
        if (status === undefined) return false;
        const body = JSON.stringify(status);
        if (body === this.last) return false;
        status.updatedAt = this.sources.now().toISOString();
        try {
            writeAtomic(this.file, `${JSON.stringify(status, null, 2)}\n`);
            this.last = body;
            return true;
        } catch {
            return false; // a full disk or a removed folder: the panel shows the last file, and the next change tries again
        }
    }
}
