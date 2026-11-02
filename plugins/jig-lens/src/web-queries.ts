// The questions the `/lens web` page asks of the index, beside the summary's own in queries.ts, which it reuses for the
// totals. Like those, they are plain functions over an open connection: nothing here knows about the server or Pi. A
// list is cut at a fixed length, so a large index never makes a large answer.
//
// Times are seconds since the epoch, as in the index. A day is a day on the user's own clock, as in the summary.
import type { DatabaseSync, SQLInputValue } from "node:sqlite";
import { blockedOf, costOf, percentile, toolsOf, waitOf } from "./queries.ts";
import type { BlockedFigures, Scope, ToolName } from "./queries.ts";

/** The most rows a table of the page shows. */
export const ROWS = 200;

/** The most lines one session's timeline holds, children included. */
export const TIMELINE_LINES = 5000;

/** How deep child agents are followed under a session. */
export const CHILD_DEPTH = 4;

/** The failures in a row, of one tool and action within a session, that make a loop. */
export const LOOP_LENGTH = 3;

function where(scope: Scope): { sql: string; params: SQLInputValue[] } {
    switch (scope.kind) {
        case "period":
            return { sql: "time >= ? AND time < ?", params: [scope.from, scope.to] };
        case "session":
            return { sql: "session = ?", params: [scope.session] };
        case "ticket":
            return { sql: "ticket = ?", params: [scope.ticket] };
    }
}

const text = (value: unknown) => (value === null || value === undefined ? undefined : String(value));
const num = (value: unknown) => (value === null || value === undefined ? 0 : Number(value));
const keyOf = ({ tool, action }: ToolName) => `${tool}\u0000${action ?? ""}`;
const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
/** A list of names, as `group_concat` gives it, without the empty ones, in order. */
const names = (value: unknown) =>
    (text(value) ?? "")
        .split(",")
        .filter((name) => name !== "")
        .sort(compare);

// ---- the totals of a range ------------------------------------------------------------------------------------------

export interface Totals {
    cost: number;
    /** Everything sent to the model, as in the summary: new input, cache reads and cache writes. */
    input: number;
    output: number;
    /** The share of `input` that the cache supplied, from 0 to 1. Undefined when nothing was sent. */
    cacheHit: number | undefined;
    turns: number;
    calls: number;
    failed: number;
    blocked: number;
    questions: number;
    waitedMs: number;
}

/** The figures at the top of the page, made by the summary's own queries. */
export function totalsOf(db: DatabaseSync, scope: Scope): Totals {
    const cost = costOf(db, scope);
    const tools = toolsOf(db, scope);
    const wait = waitOf(db, scope);
    return {
        cost: cost?.cost ?? 0,
        input: cost?.input ?? 0,
        output: cost?.output ?? 0,
        cacheHit: cost === undefined || cost.input === 0 ? undefined : cost.cacheRead / cost.input,
        turns: cost?.turns ?? 0,
        calls: tools?.calls ?? 0,
        failed: tools?.failed ?? 0,
        blocked: tools?.blocked ?? 0,
        questions: wait?.questions ?? 0,
        waitedMs: wait?.totalMs ?? 0,
    };
}

export interface Day {
    /** `YYYY-MM-DD` on the user's clock. */
    day: string;
    cost: number;
    turns: number;
    calls: number;
    failed: number;
}

const two = (n: number) => String(n).padStart(2, "0");
const localDay = (seconds: number) => {
    const date = new Date(seconds * 1000);
    return `${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())}`;
};

/** Every day of the range, with its cost and calls; a day with nothing has zeros, so a chart has no gaps. */
export function daysOf(db: DatabaseSync, from: number, to: number): Day[] {
    const days = new Map<string, Day>();
    for (let at = new Date(from * 1000); at.getTime() / 1000 < to; at.setDate(at.getDate() + 1)) {
        const day = localDay(at.getTime() / 1000);
        days.set(day, { day, cost: 0, turns: 0, calls: 0, failed: 0 });
    }
    const turns = db.prepare("SELECT time, cost FROM turn WHERE time >= ? AND time < ?");
    turns.setReturnArrays(true);
    for (const [time, cost] of turns.all(from, to) as unknown as Array<[number, number]>) {
        const day = days.get(localDay(time));
        if (day === undefined) continue;
        day.cost += cost;
        day.turns++;
    }
    const calls = db.prepare("SELECT time, outcome FROM call WHERE time >= ? AND time < ?");
    calls.setReturnArrays(true);
    for (const [time, outcome] of calls.all(from, to) as unknown as Array<[number, string]>) {
        const day = days.get(localDay(time));
        if (day === undefined) continue;
        day.calls++;
        if (outcome === "error") day.failed++;
    }
    return [...days.values()];
}

// ---- sessions and tickets -------------------------------------------------------------------------------------------

export interface SessionRow {
    session: string;
    agentRole: string;
    parentSession: string | undefined;
    /** The tickets the session's lines in scope carry, in order. */
    tickets: string[];
    /** The first and the last line in scope. */
    first: number;
    last: number;
    cost: number;
    turns: number;
    input: number;
    output: number;
    calls: number;
    failed: number;
    blocked: number;
    questions: number;
    waitedMs: number;
}

/** One row for each session that has a line in scope, most recent first. */
export function sessionsOf(db: DatabaseSync, scope: Scope, limit = ROWS): SessionRow[] {
    const { sql, params } = where(scope);
    const rows = new Map<string, SessionRow>();
    const row = (raw: Record<string, unknown>): SessionRow => {
        const session = String(raw.session);
        let found = rows.get(session);
        if (found === undefined) {
            found = {
                session,
                agentRole: String(raw.agentRole),
                parentSession: text(raw.parentSession),
                tickets: [],
                first: Number(raw.first),
                last: Number(raw.last),
                cost: 0,
                turns: 0,
                input: 0,
                output: 0,
                calls: 0,
                failed: 0,
                blocked: 0,
                questions: 0,
                waitedMs: 0,
            };
            rows.set(session, found);
        }
        found.first = Math.min(found.first, Number(raw.first));
        found.last = Math.max(found.last, Number(raw.last));
        found.tickets = [...new Set([...found.tickets, ...names(raw.tickets)])].sort(compare);
        return found;
    };
    const head = `session, max(agentRole) AS agentRole, max(parentSession) AS parentSession,
                  group_concat(DISTINCT ticket) AS tickets, min(time) AS first, max(time) AS last`;
    for (const raw of db
        .prepare(
            `SELECT ${head}, count(*) AS turns, sum(cost) AS cost, sum(input + cacheRead + cacheWrite) AS input,
                    sum(output) AS output
             FROM turn WHERE ${sql} GROUP BY session`,
        )
        .all(...params)) {
        const found = row(raw);
        found.turns = num(raw.turns);
        found.cost = num(raw.cost);
        found.input = num(raw.input);
        found.output = num(raw.output);
    }
    for (const raw of db
        .prepare(
            `SELECT ${head}, count(*) AS calls, sum(outcome = 'error') AS failed, sum(outcome = 'blocked') AS blocked,
                    sum(answer IS NOT NULL) AS questions, coalesce(sum(waitedMs), 0) AS waited
             FROM call WHERE ${sql} GROUP BY session`,
        )
        .all(...params)) {
        const found = row(raw);
        found.calls = num(raw.calls);
        found.failed = num(raw.failed);
        found.blocked = num(raw.blocked);
        found.questions = num(raw.questions);
        found.waitedMs = num(raw.waited);
    }
    return [...rows.values()].sort((a, b) => b.last - a.last || compare(a.session, b.session)).slice(0, limit);
}

export interface TicketRow {
    ticket: string;
    sessions: number;
    first: number;
    last: number;
    cost: number;
    turns: number;
    calls: number;
    failed: number;
    waitedMs: number;
}

/** One row for each ticket that has a line in scope, the most expensive first. Lines with no ticket are left out. */
export function ticketsOf(db: DatabaseSync, scope: Scope, limit = ROWS): TicketRow[] {
    const { sql, params } = where(scope);
    const tickets = new Map<string, TicketRow & { ids: Set<string> }>();
    const row = (raw: Record<string, unknown>) => {
        const ticket = String(raw.ticket);
        const found = tickets.get(ticket) ?? {
            ticket,
            ids: new Set<string>(),
            sessions: 0,
            first: Number(raw.first),
            last: Number(raw.last),
            cost: 0,
            turns: 0,
            calls: 0,
            failed: 0,
            waitedMs: 0,
        };
        for (const id of names(raw.sessions)) found.ids.add(id);
        found.first = Math.min(found.first, Number(raw.first));
        found.last = Math.max(found.last, Number(raw.last));
        tickets.set(ticket, found);
        return found;
    };
    const head = "ticket, group_concat(DISTINCT session) AS sessions, min(time) AS first, max(time) AS last";
    for (const raw of db
        .prepare(
            `SELECT ${head}, count(*) AS turns, sum(cost) AS cost
             FROM turn WHERE ${sql} AND ticket IS NOT NULL GROUP BY ticket`,
        )
        .all(...params)) {
        const found = row(raw);
        found.turns = num(raw.turns);
        found.cost = num(raw.cost);
    }
    for (const raw of db
        .prepare(
            `SELECT ${head}, count(*) AS calls, sum(outcome = 'error') AS failed, coalesce(sum(waitedMs), 0) AS waited
             FROM call WHERE ${sql} AND ticket IS NOT NULL GROUP BY ticket`,
        )
        .all(...params)) {
        const found = row(raw);
        found.calls = num(raw.calls);
        found.failed = num(raw.failed);
        found.waitedMs = num(raw.waited);
    }
    return [...tickets.values()]
        .map(({ ids, ...rest }) => ({ ...rest, sessions: ids.size }))
        .sort((a, b) => b.cost - a.cost || b.last - a.last || compare(a.ticket, b.ticket))
        .slice(0, limit);
}

export interface TicketSession extends SessionRow {
    /** The tools the session called on the ticket, most calls first. */
    tools: Array<ToolName & { calls: number; failed: number }>;
}

/** Every session of one ticket, with the tools each used on it. */
export function ticketSessionsOf(db: DatabaseSync, ticket: string): TicketSession[] {
    const sessions = sessionsOf(db, { kind: "ticket", ticket });
    const tools = new Map<string, TicketSession["tools"]>();
    for (const raw of db
        .prepare(
            `SELECT session, tool, action, count(*) AS calls, sum(outcome = 'error') AS failed
             FROM call WHERE ticket = ? GROUP BY session, tool, action`,
        )
        .all(ticket)) {
        const list = tools.get(String(raw.session)) ?? [];
        list.push({ tool: String(raw.tool), action: text(raw.action), calls: num(raw.calls), failed: num(raw.failed) });
        tools.set(String(raw.session), list);
    }
    return sessions.map((session) => ({
        ...session,
        tools: (tools.get(session.session) ?? []).sort((a, b) => b.calls - a.calls || compare(keyOf(a), keyOf(b))),
    }));
}

// ---- one session in order -------------------------------------------------------------------------------------------

export interface TurnLine {
    kind: "turn";
    time: number;
    /** What to show: the model's name, or a short form of its id (see `nameModels`). */
    model: string;
    /** The id as recorded, for a tooltip only. */
    modelId: string;
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
    cost: number;
}

export interface CallLine {
    kind: "call";
    time: number;
    tool: string;
    action: string | undefined;
    environment: string | undefined;
    effect: string | undefined;
    decision: string | undefined;
    decisionSource: string | undefined;
    approval: string | undefined;
    answer: string | undefined;
    waitedMs: number | undefined;
    outcome: string;
    errorKind: string | undefined;
    error: string | undefined;
    durationMs: number | undefined;
    toolCallId: string;
    facts: Record<string, unknown> | undefined;
}

/** A child agent, placed at its first line, with its own lines inside. */
export interface ChildLine {
    kind: "child";
    time: number;
    timeline: Timeline;
}

export type Line = TurnLine | CallLine | ChildLine;

export interface Timeline {
    session: string;
    agentRole: string;
    parentSession: string | undefined;
    tickets: string[];
    first: number;
    last: number;
    cost: number;
    lines: Line[];
    /** Set when the lines were cut at `TIMELINE_LINES`. */
    cut: boolean;
}

function facts(value: unknown): Record<string, unknown> | undefined {
    if (typeof value !== "string") return undefined;
    try {
        const parsed = JSON.parse(value) as unknown;
        return typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : undefined;
    } catch {
        return undefined;
    }
}

const optionalNumber = (value: unknown) => (value === null || value === undefined ? undefined : Number(value));

/**
 * Every turn and call of one session in order, with its child agents (sessions whose parent it is) nested where they
 * started, down to `CHILD_DEPTH`. Undefined when the session has no line. `budget` is shared by the children, so the
 * whole tree holds at most `TIMELINE_LINES` lines.
 */
export function timelineOf(
    db: DatabaseSync,
    session: string,
    depth = 0,
    budget = { left: TIMELINE_LINES },
): Timeline | undefined {
    const [row] = sessionsOf(db, { kind: "session", session });
    if (row === undefined) return undefined;
    const lines: Line[] = [];
    for (const raw of db
        .prepare(
            "SELECT time, model, input, output, cacheRead, cacheWrite, cost FROM turn WHERE session = ? ORDER BY time",
        )
        .all(session)) {
        lines.push({
            kind: "turn",
            time: Number(raw.time),
            model: String(raw.model),
            modelId: String(raw.model),
            input: num(raw.input),
            output: num(raw.output),
            cacheRead: num(raw.cacheRead),
            cacheWrite: num(raw.cacheWrite),
            cost: num(raw.cost),
        });
    }
    for (const raw of db
        .prepare(
            `SELECT time, tool, action, environment, effect, decision, decisionSource, approval, answer, waitedMs,
                    outcome, errorKind, error, durationMs, toolCallId, facts
             FROM call WHERE session = ? ORDER BY time`,
        )
        .all(session)) {
        lines.push({
            kind: "call",
            time: Number(raw.time),
            tool: String(raw.tool),
            action: text(raw.action),
            environment: text(raw.environment),
            effect: text(raw.effect),
            decision: text(raw.decision),
            decisionSource: text(raw.decisionSource),
            approval: text(raw.approval),
            answer: text(raw.answer),
            waitedMs: optionalNumber(raw.waitedMs),
            outcome: String(raw.outcome),
            errorKind: text(raw.errorKind),
            error: text(raw.error),
            durationMs: optionalNumber(raw.durationMs),
            toolCallId: String(raw.toolCallId),
            facts: facts(raw.facts),
        });
    }
    lines.sort((a, b) => a.time - b.time);
    const own = lines.slice(0, Math.max(0, budget.left));
    let cut = own.length < lines.length;
    budget.left -= own.length;

    if (depth < CHILD_DEPTH) {
        const children = db
            .prepare(
                `SELECT session FROM (
                     SELECT session, min(time) AS first FROM call WHERE parentSession = ? GROUP BY session
                     UNION ALL
                     SELECT session, min(time) AS first FROM turn WHERE parentSession = ? GROUP BY session
                 ) WHERE session <> ? GROUP BY session ORDER BY min(first)`,
            )
            .all(session, session, session);
        for (const child of children) {
            if (budget.left <= 0) {
                cut = true;
                break;
            }
            const timeline = timelineOf(db, String(child.session), depth + 1, budget);
            if (timeline !== undefined) own.push({ kind: "child", time: timeline.first, timeline });
        }
        own.sort((a, b) => a.time - b.time);
    }
    return { ...row, lines: own, cut, cost: row.cost };
}

/**
 * The timeline with each turn's model shown by `label`: a name, or a short form of the id. The full id stays only in
 * `modelId`, for a tooltip, so a long provider id (with an account number in it) is never what the page shows.
 */
export function nameModels(timeline: Timeline, label: (id: string) => string): Timeline {
    return {
        ...timeline,
        lines: timeline.lines.map((line) => {
            if (line.kind === "turn") return { ...line, model: label(line.modelId) };
            if (line.kind === "child") return { ...line, timeline: nameModels(line.timeline, label) };
            return line;
        }),
    };
}

// ---- tools ----------------------------------------------------------------------------------------------------------

export interface ToolRow extends ToolName {
    calls: number;
    failed: number;
    blocked: number;
    /** Over the calls that have a duration. Undefined when none has. */
    p50Ms: number | undefined;
    p95Ms: number | undefined;
}

/** Every tool and action of the scope with its calls, failures and durations, most calls first. */
export function toolTableOf(db: DatabaseSync, scope: Scope, limit = ROWS): ToolRow[] {
    const { sql, params } = where(scope);
    const statement = db.prepare(`SELECT tool, action, outcome, durationMs FROM call WHERE ${sql}`);
    statement.setReturnArrays(true);
    const tools = new Map<string, ToolRow & { durations: number[] }>();
    for (const [tool, action, outcome, durationMs] of statement.all(...params) as unknown as Array<
        [string, string | null, string, number | null]
    >) {
        const name = { tool, action: action ?? undefined };
        const row = tools.get(keyOf(name)) ?? {
            ...name,
            calls: 0,
            failed: 0,
            blocked: 0,
            p50Ms: undefined,
            p95Ms: undefined,
            durations: [],
        };
        row.calls++;
        if (outcome === "error") row.failed++;
        if (outcome === "blocked") row.blocked++;
        if (durationMs !== null) row.durations.push(durationMs);
        tools.set(keyOf(name), row);
    }
    return [...tools.values()]
        .map(({ durations, ...row }) => {
            durations.sort((a, b) => a - b);
            return { ...row, p50Ms: percentile(durations, 50), p95Ms: percentile(durations, 95) };
        })
        .sort((a, b) => b.calls - a.calls || compare(keyOf(a), keyOf(b)))
        .slice(0, limit);
}

/** Calls that never ran, by who decided and why: the summary's own figures. */
export const refusedOf = (db: DatabaseSync, scope: Scope): BlockedFigures | undefined => blockedOf(db, scope);

export interface Loop extends ToolName {
    session: string;
    ticket: string | undefined;
    /** Failures in the run. */
    failures: number;
    /** The first and the last failure of the run. */
    from: number;
    to: number;
    /** The error kind of the last failure. */
    errorKind: string | undefined;
}

/**
 * The same tool and action failing `LOOP_LENGTH` times or more in a row within a session: the agent trying the same
 * thing again. "In a row" counts that tool and action's own calls, so a `read` between two failed `bash` calls does not
 * break the run, and a call of it that went well does. A call that was blocked counts as a failure: an agent that asks
 * again for what a rule refuses is looping too. Longest runs first.
 */
export function loopsOf(db: DatabaseSync, scope: Scope, limit = ROWS): Loop[] {
    const { sql, params } = where(scope);
    const statement = db.prepare(
        `SELECT session, ticket, tool, action, outcome, errorKind, time FROM call WHERE ${sql} ORDER BY session, time`,
    );
    statement.setReturnArrays(true);
    const loops: Loop[] = [];
    const runs = new Map<string, Loop>();
    let current: string | undefined;
    const close = (run: Loop | undefined) => {
        if (run !== undefined && run.failures >= LOOP_LENGTH) loops.push(run);
    };
    for (const [session, ticket, tool, action, outcome, errorKind, time] of statement.all(
        ...params,
    ) as unknown as Array<[string, string | null, string, string | null, string, string | null, number]>) {
        if (session !== current) {
            for (const run of runs.values()) close(run);
            runs.clear();
            current = session;
        }
        const name = { tool, action: action ?? undefined };
        const key = keyOf(name);
        if (outcome === "ok") {
            close(runs.get(key));
            runs.delete(key);
            continue;
        }
        const run = runs.get(key) ?? {
            ...name,
            session,
            ticket: ticket ?? undefined,
            failures: 0,
            from: time,
            to: time,
            errorKind: undefined,
        };
        run.failures++;
        run.to = time;
        run.errorKind = errorKind ?? undefined;
        runs.set(key, run);
    }
    for (const run of runs.values()) close(run);
    return loops.sort((a, b) => b.failures - a.failures || b.to - a.to).slice(0, limit);
}

// ---- your time ------------------------------------------------------------------------------------------------------

export interface WaitRow {
    name: string;
    questions: number;
    waitedMs: number;
    longestMs: number;
}

export interface Question extends ToolName {
    session: string;
    ticket: string | undefined;
    time: number;
    answer: string;
    waitedMs: number;
}

export interface YourTime {
    questions: number;
    totalMs: number;
    medianMs: number;
    longestMs: number;
    answers: { allowed: number; allowedForSession: number; declined: number; dismissed: number };
    byTool: WaitRow[];
    byTicket: WaitRow[];
    /** The longest waits, longest first. */
    longest: Question[];
}

/** The questions the user was asked in scope, how they answered, and how long each waited, by tool and by ticket. */
export function yourTimeOf(db: DatabaseSync, scope: Scope, limit = ROWS): YourTime | undefined {
    const wait = waitOf(db, scope);
    if (wait === undefined) return undefined;
    const { sql, params } = where(scope);
    const group = (by: string, label: (row: Record<string, unknown>) => string): WaitRow[] =>
        db
            .prepare(
                `SELECT ${by}, count(*) AS n, coalesce(sum(waitedMs), 0) AS waited, coalesce(max(waitedMs), 0) AS longest
                 FROM call WHERE ${sql} AND answer IS NOT NULL GROUP BY ${by}`,
            )
            .all(...params)
            .map((row) => ({
                name: label(row),
                questions: num(row.n),
                waitedMs: num(row.waited),
                longestMs: num(row.longest),
            }))
            .sort((a, b) => b.waitedMs - a.waitedMs || b.questions - a.questions || compare(a.name, b.name))
            .slice(0, limit);
    const longest = db
        .prepare(
            `SELECT session, ticket, tool, action, time, answer, coalesce(waitedMs, 0) AS waited
             FROM call WHERE ${sql} AND answer IS NOT NULL ORDER BY waited DESC, time DESC LIMIT ?`,
        )
        .all(...params, limit)
        .map((row) => ({
            session: String(row.session),
            ticket: text(row.ticket),
            tool: String(row.tool),
            action: text(row.action),
            time: Number(row.time),
            answer: String(row.answer),
            waitedMs: num(row.waited),
        }));
    return {
        questions: wait.questions,
        totalMs: wait.totalMs,
        medianMs: wait.medianMs,
        longestMs: longest[0]?.waitedMs ?? 0,
        answers: {
            allowed: wait.allowed,
            allowedForSession: wait.allowedForSession,
            declined: wait.declined,
            dismissed: wait.dismissed,
        },
        byTool: group("tool, action", (row) => (row.action == null ? String(row.tool) : `${row.tool} ${row.action}`)),
        byTicket: group("ticket", (row) => text(row.ticket) ?? ""),
        longest,
    };
}
