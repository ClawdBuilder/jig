// The ticket a session works on, and its workflow, as the status file shows them. Everything is read from files that
// `jig-memory` and `jig-workflow` own: the session entry that names the active ticket, the ticket folder's `notes.md` (for a
// title) and `workflow.json`, and the workflow file that names the stages. Nothing here writes to them.
import type { Dirent } from "node:fs";
import { readdirSync, readFileSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";

/** The session entry `jig-memory` writes for the active ticket: `{ key }`, or `{ key: null }` when switched off. */
export const TICKET_ENTRY = "jig-memory-ticket";
const KEY = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/;
/** Nothing read here is larger than this; a bigger file is not the one expected. */
const MAX_BYTES = 1024 * 1024;

export const isTicketKey = (key: unknown): key is string => typeof key === "string" && KEY.test(key);

/** The ticket the session recorded last. Undefined when none, or after `/ticket off`. */
export function activeTicket(entries: readonly unknown[]): string | undefined {
    for (let i = entries.length - 1; i >= 0; i--) {
        const entry = entries[i] as { type?: string; customType?: string; data?: { key?: unknown } } | undefined;
        if (entry?.type === "custom" && entry.customType === TICKET_ENTRY) {
            const key = entry.data?.key;
            return isTicketKey(key) ? key : undefined;
        }
    }
    return undefined;
}

const expand = (folder: string): string =>
    folder.startsWith("~/") ? path.join(os.homedir(), folder.slice(2)) : path.resolve(folder);

/** The folder ticket folders live in: the `memory` section's `folder`, else the XDG data folder (jig-memory's rule). */
export function ticketsFolder(section: unknown, env: NodeJS.ProcessEnv = process.env): string {
    const folder = (section as { folder?: unknown } | undefined)?.folder;
    if (typeof folder === "string" && folder !== "") return expand(folder);
    const data = env.XDG_DATA_HOME;
    const dataHome = data !== undefined && path.isAbsolute(data) ? data : path.join(os.homedir(), ".local", "share");
    return path.join(dataHome, "jig", "tickets");
}

function readSmall(file: string): string | undefined {
    try {
        if (statSync(file).size > MAX_BYTES) return undefined;
        return readFileSync(file, "utf8");
    } catch {
        return undefined;
    }
}

function readJson(file: string): unknown {
    const text = readSmall(file);
    if (text === undefined) return undefined;
    try {
        return JSON.parse(text) as unknown;
    } catch {
        return undefined;
    }
}

/**
 * The ticket's title from the first line of its notes, when someone wrote one after the key: `# PROJ-123: Fix the login`,
 * `# PROJ-123 - Fix the login` or `# PROJ-123 Fix the login`. The template's bare `# PROJ-123` has none.
 */
export function titleFromNotes(notes: string | undefined, key: string): string | undefined {
    const first = notes?.split("\n", 1)[0]?.trim() ?? "";
    if (!first.startsWith(`# ${key}`) || /[A-Za-z0-9_.-]/.test(first.charAt(key.length + 2))) return undefined;
    const rest = first
        .slice(key.length + 2)
        .replace(/^\s*[:\-–—|]?\s*/, "")
        .trim();
    return rest === "" ? undefined : rest.slice(0, 200);
}

/** The ticket's page from the `jira` section's `site`, an https address. Only the address is read, never a credential. */
export function jiraUrl(section: unknown, key: string): string | undefined {
    const site = (section as { site?: unknown } | undefined)?.site;
    if (typeof site !== "string" || !/^https:\/\/[^\s/?#]+/.test(site)) return undefined;
    return `${site.replace(/\/+$/, "")}/browse/${encodeURIComponent(key)}`;
}

export interface Stage {
    id: string;
    goal?: string;
}

export interface PullRequest {
    /** The repository's folder, as `workflow.json` keys it. */
    repo: string;
    branch?: string;
    number?: number;
    state?: string;
    draft?: boolean;
    url?: string;
    checks?: { pass: number; fail: number; pending: number; total: number };
    /** When it was read. */
    at?: string;
    /** Why there is no reading, when there is none. */
    error?: string;
}

export interface WorkflowView {
    name: string;
    /** In order; empty when the workflow file is not found. */
    stages: Stage[];
    current: string;
    since?: string;
    prs: PullRequest[];
    /** Set when the workflow file could not be found, so the stages are unknown. */
    problem?: string;
}

const text = (value: unknown, max = 300): string | undefined =>
    typeof value === "string" && value !== "" ? value.slice(0, max) : undefined;
const count = (value: unknown): number => (typeof value === "number" && Number.isFinite(value) ? value : 0);

/** The stages of the workflow named `name`: its file in the last folder that has one, as `jig-workflow` reads them. */
export function stagesOf(name: string, folders: readonly string[]): Stage[] | undefined {
    if (!KEY.test(name)) return undefined;
    for (const folder of [...folders].reverse()) {
        const raw = readJson(path.join(folder, `${name}.json`)) as { stages?: unknown } | undefined;
        if (!Array.isArray(raw?.stages)) continue;
        const stages: Stage[] = [];
        for (const stage of raw.stages as Array<{ id?: unknown; goal?: unknown }>) {
            const id = text(stage?.id, 64);
            if (id === undefined) continue;
            const goal = text(stage.goal);
            stages.push(goal === undefined ? { id } : { id, goal });
        }
        return stages;
    }
    return undefined;
}

/** The pull requests `jig-workflow` observed, one per repository, from `workflow.json`'s `observed`. */
export function observedPrs(observed: unknown): PullRequest[] {
    if (typeof observed !== "object" || observed === null) return [];
    const prs: PullRequest[] = [];
    for (const [repo, value] of Object.entries(observed as Record<string, unknown>).slice(0, 20)) {
        const reading = value as {
            at?: unknown;
            branch?: unknown;
            error?: unknown;
            pr?: { number?: unknown; state?: unknown; isDraft?: unknown; url?: unknown };
            checks?: { pass?: unknown; fail?: unknown; pending?: unknown; total?: unknown };
        };
        const pr: PullRequest = { repo };
        const branch = text(reading?.branch, 200);
        if (branch !== undefined) pr.branch = branch;
        if (reading?.pr && typeof reading.pr.number === "number") {
            pr.number = reading.pr.number;
            pr.state = text(reading.pr.state, 20) ?? "OPEN";
            pr.draft = reading.pr.isDraft === true;
            const url = text(reading.pr.url, 500);
            if (url?.startsWith("https://")) pr.url = url;
        }
        if (reading?.checks && typeof reading.checks === "object") {
            const c = reading.checks;
            pr.checks = { pass: count(c.pass), fail: count(c.fail), pending: count(c.pending), total: count(c.total) };
        }
        const at = text(reading?.at, 40);
        if (at !== undefined) pr.at = at;
        const error = text(reading?.error, 200);
        if (error !== undefined) pr.error = error;
        prs.push(pr);
    }
    return prs;
}

/** The ticket's workflow from `<ticket folder>/workflow.json`, with its stages from the workflow file. Undefined when it has none. */
export function readWorkflow(ticketDir: string, folders: readonly string[]): WorkflowView | undefined {
    const raw = readJson(path.join(ticketDir, "workflow.json")) as
        | { version?: unknown; workflow?: unknown; stage?: unknown; stageSince?: unknown; observed?: unknown }
        | undefined;
    if (raw?.version !== 1) return undefined;
    const name = text(raw.workflow, 64);
    const current = text(raw.stage, 64);
    if (name === undefined || current === undefined) return undefined;
    const stages = stagesOf(name, folders);
    const view: WorkflowView = { name, stages: stages ?? [], current, prs: observedPrs(raw.observed) };
    const since = text(raw.stageSince, 40);
    if (since !== undefined) view.since = since;
    if (stages === undefined) view.problem = `no workflow file named ${name}`;
    return view;
}

/**
 * The folders workflow files are read from, in `jig-workflow`'s order (a later file of the same name wins): the `workflow`
 * section's `folders`, then `<agent dir>/workflows`, then the project's `.pi/workflows` when Pi trusts the project.
 */
export function workflowFolders(section: unknown, agentDir: string, cwd: string, trusted: boolean): string[] {
    const configured = (section as { folders?: unknown } | undefined)?.folders;
    const folders = Array.isArray(configured)
        ? configured.filter((f): f is string => typeof f === "string" && f !== "").map(expand)
        : [];
    folders.push(path.join(agentDir, "workflows"));
    if (trusted) folders.push(path.join(cwd, ".pi", "workflows"));
    return folders;
}

export interface TicketView {
    key: string;
    title?: string;
    url?: string;
}

/** The ticket and its workflow, read from the ticket folder. */
export function readTicket(
    key: string,
    folder: string,
    jiraSection: unknown,
    folders: readonly string[],
): { ticket: TicketView; workflow?: WorkflowView } {
    const dir = path.join(folder, key);
    const ticket: TicketView = { key };
    const title = titleFromNotes(readSmall(path.join(dir, "notes.md")), key);
    if (title !== undefined) ticket.title = title;
    const url = jiraUrl(jiraSection, key);
    if (url !== undefined) ticket.url = url;
    const workflow = readWorkflow(dir, folders);
    return workflow === undefined ? { ticket } : { ticket, workflow };
}

/** Files in a ticket folder that are bookkeeping, not work product. */
const BOOKKEEPING = new Set(["ticket.json", "workflow.json"]);
const REPORT = /\.(md|txt|json)$/i;
const MAX_FILES = 200;
/** A tool output Jig saved on its own (`<ISO time>-<tool>-<hash>.<ext>` in `evidence/`): a record, not something you made. */
const CAPTURED = /^\d{4}-\d{2}-\d{2}T[\d-]+(?:\.\d+)?Z-.+-[0-9a-f]{6,}\.[a-z]+$/i;

export interface TicketFile {
    path: string;
    /** The file's modification time, ISO. */
    at: string;
}

/**
 * The user-facing files of a ticket folder: top-level notes, plans and other .md, .txt and .json reports, and the files
 * under subfolders (`evidence/` of any type, others as reports) down to two levels. Not `ticket.json`, `workflow.json`,
 * `history/`, or the tool outputs Jig saves to `evidence/` by itself (dozens per ticket; they would bury the notes). Paths and times only; nothing is read. Bounded to a few hundred entries.
 */
export function ticketFiles(dir: string): TicketFile[] {
    const out: TicketFile[] = [];
    const walk = (folder: string, depth: number, any: boolean): void => {
        let names: Dirent[];
        try {
            names = readdirSync(folder, { withFileTypes: true });
        } catch {
            return;
        }
        for (const entry of names) {
            if (out.length >= MAX_FILES) return;
            if (entry.name.startsWith(".")) continue;
            const full = path.join(folder, entry.name);
            if (entry.isDirectory()) {
                if (depth === 0 && entry.name === "history") continue;
                if (depth < 2) walk(full, depth + 1, any || entry.name === "evidence");
            } else if (entry.isFile()) {
                if (depth === 0 && BOOKKEEPING.has(entry.name)) continue;
                if ((depth === 0 || !any) && !REPORT.test(entry.name)) continue;
                if (depth > 0 && CAPTURED.test(entry.name)) continue;
                try {
                    out.push({ path: full, at: statSync(full).mtime.toISOString() });
                } catch {
                    // gone since the listing
                }
            }
        }
    };
    walk(dir, 0, false);
    return out;
}
