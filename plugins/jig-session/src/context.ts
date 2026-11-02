// The session's context for the Context panel: the breakdown (breakdown.ts), the tools, skills and context files behind
// it, and the requests a reader sends to switch a tool or a skill or to reload (requests.ts). Pi's parts are reached
// through `ContextHost`, so a test gives its own.
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { Breakdown, ToolLike } from "./breakdown.ts";
import {
    compose,
    hasReply,
    parsePrompt,
    reserveFrom,
    SKILLS_FRAME_CHARS,
    skillChars,
    tokensOf,
    toolChars,
} from "./breakdown.ts";
import type { Outcome, Saved, SwitchHost } from "./requests.ts";
import { parseRequest, Switches, takeRequest } from "./requests.ts";
import { contextFill } from "./usage.ts";

export interface ToolInfoLike extends ToolLike {
    exposure?: string;
}

export interface CommandLike {
    name: string;
    description?: string;
    source: string;
    sourceInfo?: { path?: string };
}

/** What the Context part needs of Pi; each one may throw, and is then taken as empty. */
export interface ContextHost {
    allTools(): ToolInfoLike[];
    activeTools(): string[];
    setActiveTools(names: string[]): void;
    /** `pi.getCommands()`: the loaded skills are its `skill:<name>` entries. */
    commands(): CommandLike[];
    /** `pi.getSettings()`, for the compaction reserve. */
    settings(): unknown;
    /** Keeps the switches in the session (`pi.appendEntry`). */
    save(saved: Saved): void;
    /** Runs `/session-reload` (`pi.sendUserMessage` with commands dispatched). Only when Pi is idle. */
    reload(): void;
}

export interface ContextDetail extends Breakdown {
    /** Every tool that can be declared to the model, in Pi's order: on when declared now, and its declaration's size. */
    tools: Array<{ name: string; on: boolean; tokens: number }>;
    /** Every loaded skill; `listed` false for one Pi lists to the model never (`disable-model-invocation`). */
    skills: Array<{ name: string; on: boolean; tokens: number; listed: boolean }>;
    /** The context files the prompt carries, in its order. */
    files: Array<{ path: string; tokens: number }>;
}

const safe = <T>(read: () => T, fallback: T): T => {
    try {
        return read() ?? fallback;
    } catch {
        return fallback;
    }
};

export class ContextView {
    readonly switches = new Switches();
    private readonly host: ContextHost;
    /** Skills Pi never lists to the model, as the last turn's prompt options said; null before the first turn. */
    private commandOnly: Set<string> | null = null;
    private toolSizes = new Map<string, { key: string; tokens: number }>();
    private pendingReload = false;
    last: Outcome | null = null;

    constructor(host: ContextHost) {
        this.host = host;
    }

    private get switchHost(): SwitchHost {
        return {
            toolNames: () => this.declarable().map((t) => t.name),
            activeTools: () => safe(() => this.host.activeTools(), []),
            setActiveTools: (names) => this.host.setActiveTools(names),
            skillNames: () => this.skills().map((s) => s.name),
        };
    }

    private declarable(): ToolInfoLike[] {
        return safe(() => this.host.allTools(), []).filter(
            (t) => typeof t?.name === "string" && t.exposure !== "hidden",
        );
    }

    private skills(): Array<{ name: string; description?: string; path?: string }> {
        return safe(() => this.host.commands(), [])
            .filter((c) => c?.source === "skill" && typeof c.name === "string")
            .map((c) => ({
                name: c.name.replace(/^skill:/, ""),
                description: c.description,
                path: c.sourceInfo?.path,
            }));
    }

    /** A new session or a reload: the switches it saved come back, and its tools are switched as they were. */
    start(entries: readonly unknown[]): void {
        this.commandOnly = null;
        this.pendingReload = false;
        this.toolSizes.clear();
        if (this.switches.restore(entries)) {
            try {
                this.switches.applyTools(this.switchHost);
            } catch {
                // Pi refused: the panel shows the tools as they are
            }
        }
    }

    /** `before_agent_start`: notes which skills Pi never lists, then leaves out the ones switched off. */
    beforeTurn(options: { skills?: Array<{ name: string; disableModelInvocation?: boolean }> }): void {
        if (Array.isArray(options.skills))
            this.commandOnly = new Set(
                options.skills.filter((s) => s.disableModelInvocation === true).map((s) => s.name),
            );
        this.switches.filterSkills(options);
    }

    private toolTokens(tool: ToolInfoLike): number {
        const key = tool.description ?? "";
        const known = this.toolSizes.get(tool.name);
        if (known?.key === key) return known.tokens;
        const tokens = tokensOf(toolChars(tool));
        this.toolSizes.set(tool.name, { key, tokens });
        return tokens;
    }

    /** The breakdown and the lists, as they are now. */
    detail(
        ctx: Pick<ExtensionContext, "getSystemPrompt" | "getContextUsage" | "model" | "sessionManager">,
    ): ContextDetail {
        const prompt = parsePrompt(safe(() => ctx.getSystemPrompt(), ""));
        const active = new Set(safe(() => this.host.activeTools(), []));
        const tools = this.declarable().map((t) => ({
            name: t.name,
            on: active.has(t.name),
            tokens: this.toolTokens(t),
        }));
        const listedNow = new Set(prompt.skillNames);
        const off = this.switches.skillsOff;
        let skillsChars = 0;
        const skills = this.skills().map((s) => {
            const listed = this.commandOnly ? !this.commandOnly.has(s.name) : listedNow.has(s.name) || off.has(s.name);
            const chars = skillChars(s);
            const on = !off.has(s.name);
            if (on && listed) skillsChars += chars;
            return { name: s.name, on, tokens: listed ? tokensOf(chars) : 0, listed };
        });
        const fill = contextFill(ctx);
        const model = ctx.model ? { provider: ctx.model.provider, id: ctx.model.id } : undefined;
        const breakdown = compose({
            window: fill.window,
            piTokens: fill.tokens,
            hasReply: hasReply(safe(() => ctx.sessionManager.getBranch(), [])),
            prompt,
            toolsTokens: tools.filter((t) => t.on).reduce((sum, t) => sum + t.tokens, 0),
            skillsTokens: skillsChars > 0 ? tokensOf(skillsChars + SKILLS_FRAME_CHARS) : 0,
            reserve: reserveFrom(
                safe(() => this.host.settings(), {}),
                model,
            ),
        });
        return {
            ...breakdown,
            tools,
            skills,
            files: prompt.files.map((f) => ({ path: f.path, tokens: tokensOf(f.chars) })),
        };
    }

    /**
     * Takes and applies the request file, when there is one. Returns undefined with none; else the outcome (also kept in
     * `last`) and whether Pi should reload now, which the caller does after writing the status file.
     */
    poll(file: string, idle: boolean, now: Date): { outcome: Outcome; reloadNow: boolean } | undefined {
        const text = takeRequest(file);
        if (text === undefined) return undefined;
        const at = now.toISOString();
        let outcome: Outcome;
        let reloadNow = false;
        const parsed = text === null ? { error: "the request is larger than 64 KiB" } : parseRequest(text);
        if (parsed.request === undefined) {
            outcome = { id: null, ok: false, message: `Refused: ${parsed.error ?? "not a request"}`, at };
        } else {
            const request = parsed.request;
            const result = this.switches.apply(request, this.switchHost);
            if (result.changed) {
                try {
                    this.host.save(this.switches.saved());
                } catch {
                    // kept for this run of Pi only
                }
            }
            const said = result.message ? [result.message] : [];
            outcome = { id: request.id, ok: result.ok, message: "", at };
            if (request.reload) {
                outcome.reload = "waiting";
                if (idle) {
                    reloadNow = true;
                    said.push("reloading");
                } else {
                    this.pendingReload = true;
                    said.push("Pi reloads when the agent is idle");
                }
            }
            outcome.message = said.join("; ") || "nothing to change";
        }
        this.last = outcome;
        return { outcome, reloadNow };
    }

    /** `agent_settled`: a reload asked while the agent worked runs now. Returns whether it did. */
    settled(): boolean {
        if (!this.pendingReload) return false;
        this.pendingReload = false;
        this.host.reload();
        return true;
    }

    reloadNow(): void {
        this.host.reload();
    }
}
