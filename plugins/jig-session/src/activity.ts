// What the session did, for the panel: the files its edit and write calls changed (paths only), and its recent tool calls
// with the decision jig-core took on each (tool and action names only, never an argument's value).
import { existsSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { DecisionEvent } from "../../jig-core/src/contract.ts";

/** The most outputs kept per kind: files outside any git repository, and files inside one. */
export const MAX_OUTPUTS = 50;
export const MAX_RECENT = 15;
/** The tools whose successful calls make an output: Pi's own file tools. */
export const FILE_TOOLS = new Set(["edit", "write"]);

export interface Output {
    /** Absolute. */
    path: string;
    action: "created" | "edited";
    at: string;
    /** Absolute root of the git working tree that holds the path, or null when it is in none. */
    repo: string | null;
}

export interface Recent {
    at: string;
    tool: string;
    action?: string;
    /** jig-core's decision; absent when no decision was published for the call. */
    decision?: "allow" | "ask" | "deny";
    /** Your answer, when the call asked. */
    answer?: "allow" | "allow-session" | "decline";
    outcome: "running" | "ok" | "error" | "blocked";
}

/** A path as Pi's file tools take it (relative to the folder, `~/`, or with a leading `@`), made absolute. */
export function absolute(given: string, cwd: string): string {
    let p = given.startsWith("@") ? given.slice(1) : given;
    if (p === "~") p = os.homedir();
    else if (p.startsWith("~/")) p = path.join(os.homedir(), p.slice(2));
    return path.resolve(cwd, p);
}

/** Whether `dir` has a `.git` folder (a repository) or file (a worktree or submodule). */
function hasGit(dir: string): boolean {
    try {
        const s = statSync(path.join(dir, ".git"));
        return s.isDirectory() || s.isFile();
    } catch {
        return false;
    }
}

/** Keeps the first MAX_OUTPUTS of each kind. The cap is per kind, so edits inside repositories cannot push ticket files out. */
function capOutputs(all: Output[]): Output[] {
    let loose = 0;
    let inRepo = 0;
    return all.filter((o) => (o.repo === null ? ++loose : ++inRepo) <= MAX_OUTPUTS);
}

const NAME = /^[A-Za-z0-9_.:/-]{1,80}$/;
const clip = (value: unknown): string | undefined =>
    typeof value === "string" && NAME.test(value) ? value : undefined;

export class Activity {
    outputs: Output[] = [];
    recent: Recent[] = [];
    /** The file calls between their start and their end: the path and whether the file was there before. */
    private readonly pending = new Map<string, { path: string; existed: boolean; tool: string }>();
    private readonly byId = new Map<string, Recent>();
    private readonly now: () => Date;
    /** Folder to the root of the working tree holding it (or null), kept for the session. Walks the file system; never runs git. */
    private readonly roots = new Map<string, string | null>();

    constructor(now: () => Date = () => new Date()) {
        this.now = now;
    }

    /** Files of the active ticket's folder (notes, plans, evidence), read from disk; see `ticketFiles`. */
    ticketOutputs: Output[] = [];

    reset(): void {
        this.outputs = [];
        this.ticketOutputs = [];
        this.recent = [];
        this.pending.clear();
        this.byId.clear();
    }

    /** The root of the git working tree that holds `file`: the nearest ancestor folder with a `.git` folder or file. */
    repoOf(file: string): string | null {
        const walked: string[] = [];
        let dir = path.dirname(file);
        let found: string | null = null;
        for (;;) {
            const known = this.roots.get(dir);
            if (known !== undefined) {
                found = known;
                break;
            }
            walked.push(dir);
            if (hasGit(dir)) {
                found = dir;
                break;
            }
            const up = path.dirname(dir);
            if (up === dir) break;
            dir = up;
        }
        // Every folder walked on the way up has the same answer: the root found, or none.
        for (const w of walked) this.roots.set(w, found);
        return found;
    }

    /**
     * Rebuilds the outputs from the transcript of a branch (after a start, resume or reload): the successful `edit` and
     * `write` calls, their paths only. A write to a path not yet seen is a creation, an edit an edit.
     */
    replay(branch: readonly unknown[], cwd: string): void {
        const calls = new Map<string, { path: string; tool: string; at: string }>();
        const found = new Map<string, Output>();
        for (const entry of branch) {
            const e = entry as { type?: unknown; timestamp?: unknown; message?: Record<string, unknown> };
            const message = e?.message;
            if (e?.type !== "message" || message === undefined || message === null) continue;
            const stamp = (e.timestamp ?? message.timestamp) as unknown;
            const when = new Date(typeof stamp === "string" || typeof stamp === "number" ? stamp : Number.NaN);
            const at = Number.isNaN(when.getTime()) ? this.now().toISOString() : when.toISOString();
            if (message.role === "assistant" && Array.isArray(message.content)) {
                for (const block of message.content as Array<Record<string, unknown>>) {
                    if (block?.type !== "toolCall" || typeof block.id !== "string") continue;
                    if (typeof block.name !== "string" || !FILE_TOOLS.has(block.name)) continue;
                    const given = (block.arguments as { path?: unknown } | undefined)?.path;
                    if (typeof given !== "string" || given === "" || given.includes("\0")) continue;
                    calls.set(block.id, { path: absolute(given, cwd), tool: block.name, at });
                }
            } else if (message.role === "toolResult" && typeof message.toolCallId === "string") {
                const call = calls.get(message.toolCallId);
                calls.delete(message.toolCallId);
                if (call === undefined || message.isError === true) continue;
                const before = found.get(call.path);
                const action: Output["action"] =
                    before?.action === "created" || (call.tool === "write" && before === undefined)
                        ? "created"
                        : "edited";
                found.set(call.path, { path: call.path, action, at: call.at, repo: this.repoOf(call.path) });
            }
        }
        this.outputs = capOutputs([...found.values()].reverse());
    }

    /** The live outputs and the ticket folder's files, one per path (the newest `at` wins), newest first, capped per kind. */
    allOutputs(): Output[] {
        if (this.ticketOutputs.length === 0) return this.outputs;
        const byPath = new Map<string, Output>();
        for (const o of [...this.ticketOutputs, ...this.outputs]) {
            const other = byPath.get(o.path);
            if (other === undefined) byPath.set(o.path, o);
            else {
                const newer = Date.parse(o.at) >= Date.parse(other.at) ? o : other;
                const action = o.action === "created" || other.action === "created" ? "created" : newer.action;
                byPath.set(o.path, { ...newer, action });
            }
        }
        const sorted = [...byPath.values()].sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
        return capOutputs(sorted);
    }

    private entry(toolCallId: string, tool: string): Recent {
        let found = this.byId.get(toolCallId);
        if (found === undefined) {
            found = { at: this.now().toISOString(), tool: clip(tool) ?? "tool", outcome: "running" };
            this.byId.set(toolCallId, found);
            this.recent.unshift(found);
            for (const dropped of this.recent.splice(MAX_RECENT)) {
                for (const [id, value] of this.byId) if (value === dropped) this.byId.delete(id);
            }
        }
        return found;
    }

    /** A call starts. Returns true: the recent list changed. */
    started(toolCallId: string, tool: string): boolean {
        this.entry(toolCallId, tool);
        return true;
    }

    /** The call's arguments, after jig-core and the other plugins looked at them: for a file tool, its path. */
    called(toolCallId: string, tool: string, input: unknown, cwd: string): void {
        if (!FILE_TOOLS.has(tool)) return;
        const given = (input as { path?: unknown } | undefined)?.path;
        if (typeof given !== "string" || given === "" || given.includes("\0")) return;
        const file = absolute(given, cwd);
        this.pending.set(toolCallId, { path: file, existed: existsSync(file), tool });
    }

    /** jig-core's decision on a call. Returns whether the recent list changed. */
    decided(event: unknown): boolean {
        const e = event as Partial<DecisionEvent> | undefined;
        if (typeof e?.toolCallId !== "string" || typeof e.tool !== "string") return false;
        const entry = this.entry(e.toolCallId, e.tool);
        const action = clip(e.action);
        if (action !== undefined) entry.action = action;
        if (e.decision === "allow" || e.decision === "ask" || e.decision === "deny") entry.decision = e.decision;
        if (e.answer === "allow" || e.answer === "allow-session" || e.answer === "decline") entry.answer = e.answer;
        if (entry.decision === "deny" || entry.answer === "decline") entry.outcome = "blocked";
        return true;
    }

    /** A call ended. Returns whether the outputs changed. */
    ended(toolCallId: string, tool: string, isError: boolean): boolean {
        const entry = this.entry(toolCallId, tool);
        if (entry.outcome !== "blocked") entry.outcome = isError ? "error" : "ok";
        const file = this.pending.get(toolCallId);
        this.pending.delete(toolCallId);
        if (file === undefined || isError) return false;
        const before = this.outputs.find((o) => o.path === file.path);
        const action: Output["action"] =
            before?.action === "created" || (file.tool === "write" && !file.existed) ? "created" : "edited";
        const all = [
            { path: file.path, action, at: this.now().toISOString(), repo: this.repoOf(file.path) },
            ...this.outputs.filter((o) => o.path !== file.path),
        ];
        this.outputs = capOutputs(all);
        return true;
    }
}
