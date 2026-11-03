// The status file of one session: what it holds (schema 1, see the README) and when it is written. The heavy parts (the
// session's totals, the ticket folder) are read again only when something that changes them happened; a check every
// `tickMs` notices a changed ticket, tool set or idle state, and writes only when the file's content would change.
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Activity } from "./activity.ts";
import type { Output, Recent } from "./activity.ts";
import type { ContextDetail, ContextView } from "./context.ts";
import { fileName, removeFile, sessionsDir, sweep, writeAtomic } from "./files.ts";
import type { Outcome } from "./requests.ts";
import { ensureRequestsDir, requestsDir, sweepRequests } from "./requests.ts";
import { activeTicket, readTicket, ticketFiles, ticketsFolder, workflowFolders } from "./ticket.ts";
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
    /** What fills the context, and the tools, skills and context files behind it; null when Pi does not say. */
    contextDetail: ContextDetail | null;
    /** The outcome of the last request a reader sent, or null. */
    lastRequest: Outcome | null;
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
    /** The Context part: the breakdown, the switches and the requests. Without it the file has no `contextDetail`. */
    context?: ContextView;
}

export class StatusFile {
    readonly activity: Activity;
    private ctx: ExtensionContext | undefined;
    private file: string | undefined;
    private requestFile: string | undefined;
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

    /** The request file a reader writes for this session, or undefined between sessions. */
    get requestPath(): string | undefined {
        return this.requestFile;
    }

    start(ctx: ExtensionContext, tickMs: number, reason?: string): void {
        this.stop();
        this.ctx = ctx;
        this.activity.reset();
        this.activity.replay(safeBranch(ctx), ctx.cwd);
        this.busy = false;
        this.last = "";
        this.ticketKey = undefined;
        this.ticket = undefined;
        this.startedAt = this.sources.now().toISOString();
        const state = this.sources.stateDir();
        const dir = sessionsDir(state);
        sweep(dir);
        const name = fileName(ctx.sessionManager.getSessionId());
        this.file = path.join(dir, name);
        const context = this.sources.context;
        if (context !== undefined) {
            context.last = this.carried(reason);
            context.start(safeBranch(ctx));
            const requests = requestsDir(state);
            try {
                ensureRequestsDir(requests);
                sweepRequests(requests, (n) => existsSync(path.join(dir, n)), name);
                this.requestFile = path.join(requests, name);
            } catch {
                this.requestFile = undefined; // no requests folder: the panel's switches get no answer
            }
        }
        this.refresh();
        if (tickMs > 0) {
            this.timer = setInterval(() => this.tick(), tickMs);
            this.timer.unref();
        }
    }

    /**
     * What a reload keeps: the file this Pi wrote for this session before it reloaded, with its last request; a reload that
     * request asked for is then done. Nothing after a start of another kind.
     */
    private carried(reason: string | undefined): Outcome | null {
        if (reason !== "reload" || this.file === undefined) return null;
        try {
            const old = JSON.parse(readFileSync(this.file, "utf8")) as Partial<SessionStatus>;
            const last = old.pid === process.pid ? old.lastRequest : null;
            if (!last || typeof last !== "object") return null;
            return last.reload === "waiting" ? { ...last, reload: "done", message: `${last.message}; reloaded` } : last;
        } catch {
            return null;
        }
    }

    /** The session ends: the file goes, and its request file. A reload keeps both, for the Pi that comes back. Safe twice. */
    stop(reload = false): void {
        if (this.timer !== undefined) clearInterval(this.timer);
        this.timer = undefined;
        if (!reload) {
            if (this.file !== undefined) removeFile(this.file);
            if (this.requestFile !== undefined) removeFile(this.requestFile);
        }
        this.file = undefined;
        this.requestFile = undefined;
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

    /** The cheap check: a request, a new ticket, tool set or state shows up here. The ticket folder is read every 10 s. */
    tick(): void {
        if (this.ctx === undefined) return;
        this.takeRequest();
        this.readTicket(this.sources.now().getTime() - this.ticketReadAt > 10_000);
        this.write();
    }

    /** Applies a reader's request when there is one, writes its outcome, then reloads Pi if it asked and Pi is idle. */
    takeRequest(): void {
        const ctx = this.ctx;
        const context = this.sources.context;
        if (ctx === undefined || context === undefined || this.requestFile === undefined) return;
        let idle = false;
        try {
            idle = ctx.isIdle() && !this.busy;
        } catch {
            // taken as busy: a reload waits for the agent to settle
        }
        const taken = context.poll(this.requestFile, idle, this.sources.now());
        if (taken === undefined) return;
        this.write();
        if (taken.reloadNow) {
            try {
                context.reloadNow();
            } catch {
                // Pi refused: the outcome still says waiting, and the panel says to type /reload
            }
        }
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
            this.activity.ticketOutputs = [];
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
        const dir = path.join(ticketsFolder(this.sources.section("memory"), this.sources.env), key);
        this.activity.ticketOutputs = ticketFiles(dir).map((f) => ({
            path: f.path,
            action: "edited" as const,
            at: f.at,
            repo: this.activity.repoOf(f.path),
        }));
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
            outputs: this.activity.allOutputs(),
            recent: this.activity.recent,
            contextDetail: this.contextDetail(ctx),
            lastRequest: this.sources.context?.last ?? null,
            startedAt: this.startedAt,
            updatedAt: "",
        };
    }

    private contextDetail(ctx: ExtensionContext): ContextDetail | null {
        try {
            return this.sources.context?.detail(ctx) ?? null;
        } catch {
            return null;
        }
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

function safeBranch(ctx: ExtensionContext): readonly unknown[] {
    try {
        return ctx.sessionManager.getBranch();
    } catch {
        return [];
    }
}
