// What fills the session's context, part by part, for the Context panel: the system prompt, the context files (AGENTS.md
// and the like), the skills list, the tool declarations, the messages, the compaction reserve and the free space. Pure
// functions over what Pi reports, so a test gives its own.
//
// Sizes are counted in characters, exactly, from the prompt Pi renders and the tool declarations Pi sends; tokens are
// characters / 4, rounded up, the estimate Pi itself uses (`estimateTokens`). The total is Pi's own figure (the last reply's
// usage plus an estimate of what came after), so Messages, the total less the other parts, is an estimate too.

/** Characters per token in every estimate here, as in Pi's `estimateTokens`. */
export const CHARS_PER_TOKEN = 4;
export const tokensOf = (chars: number): number => Math.ceil(Math.max(0, chars) / CHARS_PER_TOKEN);

export interface PromptParts {
    /** The whole rendered system prompt. */
    chars: number;
    /** The `project_context` section, tags included: every context file and its wrapping. */
    contextChars: number;
    /** Each context file as the prompt carries it, in order. */
    files: Array<{ path: string; chars: number }>;
    /** The `skills` section, tags included. */
    skillsChars: number;
    /** The skills that section lists for the model. */
    skillNames: string[];
}

const unescapeXml = (text: string): string =>
    text
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'")
        .replace(/&amp;/g, "&");

/**
 * Finds the parts of Pi's rendered system prompt. Pi renders each section as `<name>\n…\n</name>`; the context files are
 * `<project_instructions path="…">` blocks inside `project_context`, and the skills an `<available_skills>` list inside
 * `skills`, which comes after it. A prompt another extension replaced whole has neither, and counts as system prompt.
 */
export function parsePrompt(text: string): PromptParts {
    const parts: PromptParts = { chars: text.length, contextChars: 0, files: [], skillsChars: 0, skillNames: [] };
    let after = 0;
    const open = "<project_context>\n";
    const closeContext = "\n</project_context>";
    const start = text.indexOf(open);
    if (start >= 0) {
        const tag = '<project_instructions path="';
        const close = "\n</project_instructions>";
        let at = start + open.length;
        for (;;) {
            const a = text.indexOf(tag, at);
            const end = text.indexOf(closeContext, at);
            if (a < 0 || (end >= 0 && end < a)) break;
            const q = text.indexOf('">\n', a + tag.length);
            if (q < 0) break;
            const b = text.indexOf(close, q + 3);
            if (b < 0) break;
            parts.files.push({ path: text.slice(a + tag.length, q), chars: b + close.length - a });
            at = b + close.length;
        }
        const end = text.indexOf(closeContext, at);
        after = end < 0 ? text.length : end + closeContext.length;
        parts.contextChars = after - start;
    }
    const skillsAt = text.indexOf("<skills>\n", after);
    if (skillsAt >= 0) {
        const end = text.indexOf("\n</skills>", skillsAt);
        const stop = end < 0 ? text.length : end + "\n</skills>".length;
        parts.skillsChars = stop - skillsAt;
        const section = text.slice(skillsAt, stop);
        for (const m of section.matchAll(/<skill>\s*<name>([^<]*)<\/name>/g))
            parts.skillNames.push(unescapeXml(m[1] ?? ""));
    }
    return parts;
}

/** A tool as `pi.getAllTools()` describes it; only what its declaration to the model holds is counted. */
export interface ToolLike {
    name: string;
    description?: string;
    parameters?: unknown;
}

/** The characters of one tool's declaration: its name, description and parameter schema, as JSON. */
export function toolChars(tool: ToolLike): number {
    return JSON.stringify({ name: tool.name, description: tool.description ?? "", parameters: tool.parameters ?? {} })
        .length;
}

const escapeXml = (text: string): string =>
    text
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&apos;");

/** The characters of one skill's entry in the skills list, as Pi writes it (name, description, location). */
export function skillChars(skill: { name: string; description?: string; path?: string }): number {
    return [
        "  <skill>",
        `    <name>${escapeXml(skill.name)}</name>`,
        `    <description>${escapeXml(skill.description ?? "")}</description>`,
        `    <location>${escapeXml(skill.path ?? "")}</location>`,
        "  </skill>",
        "",
    ].join("\n").length;
}

/** The skills section's own text around the entries: the section tags, Pi's three lines of guidance and the list's tags. */
export const SKILLS_FRAME_CHARS = [
    "<skills>",
    "The following skills provide specialized instructions for specific tasks.",
    "Use the read tool to load a skill's file when the task matches its description.",
    "Resolve relative paths against the skill's directory (parent of SKILL.md). Use absolute paths in tool calls.",
    "",
    "<available_skills>",
    "</available_skills>",
    "</skills>",
].join("\n").length;

export interface Parts {
    messages: number | null;
    tools: number;
    system: number;
    skills: number;
    contextFiles: number;
}

export interface Breakdown {
    window: number | null;
    /** Tokens in use, or null when Pi does not know (after a compaction, until the next reply). */
    used: number | null;
    /** `pi`: Pi's figure, from the last reply; `parts`: no reply yet, so the parts added up. */
    usedFrom: "pi" | "parts" | null;
    /** The tokens Pi keeps free: it compacts when fewer are left. 0 with compaction off. */
    reserve: number;
    /** What is left before the reserve. */
    free: number | null;
    parts: Parts;
}

export interface BreakdownInput {
    window: number | null;
    /** Pi's `getContextUsage().tokens`. */
    piTokens: number | null;
    /** Whether the branch was sent before (`hasReply`): then Pi's figure counts the prompt and tools too. */
    hasReply: boolean;
    prompt: PromptParts;
    toolsTokens: number;
    skillsTokens: number;
    reserve: number;
}

/**
 * The breakdown. System prompt is the rendered prompt less its context files and skills; the skills part is counted from
 * the skills that are on (the prompt may still show the last turn's list); Messages is the total less everything else.
 */
export function compose(input: BreakdownInput): Breakdown {
    const system = tokensOf(input.prompt.chars - input.prompt.contextChars - input.prompt.skillsChars);
    const contextFiles = tokensOf(input.prompt.contextChars);
    const fixed = system + contextFiles + input.skillsTokens + input.toolsTokens;
    let used: number | null;
    let usedFrom: Breakdown["usedFrom"];
    let messages: number | null;
    if (input.piTokens === null) {
        // Before any reply Pi counts nothing it would send but the messages; after a compaction it does not know yet.
        used = input.hasReply ? null : fixed;
        usedFrom = input.hasReply ? null : "parts";
        messages = input.hasReply ? null : 0;
    } else if (input.hasReply) {
        used = Math.round(input.piTokens);
        usedFrom = "pi";
        messages = Math.max(0, used - fixed);
    } else {
        messages = Math.round(input.piTokens);
        used = fixed + messages;
        usedFrom = "parts";
    }
    const reserve = Math.max(0, input.window === null ? input.reserve : Math.min(input.reserve, input.window));
    const free = input.window === null || used === null ? null : Math.max(0, input.window - used - reserve);
    return {
        window: input.window,
        used,
        usedFrom,
        reserve,
        free,
        parts: { messages, tools: input.toolsTokens, system, skills: input.skillsTokens, contextFiles },
    };
}

type Rec = Record<string, unknown>;
const isRec = (value: unknown): value is Rec => typeof value === "object" && value !== null && !Array.isArray(value);
const count = (value: unknown): number | undefined =>
    typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : undefined;

/** Pi's default reserve (`compaction.reserveTokens`). */
export const DEFAULT_RESERVE = 16384;

/**
 * The compaction reserve from Pi's merged settings (`pi.getSettings()`), as Pi resolves it: the model's override in
 * `compaction.modelOverrides["provider/id"]`, else `compaction.reserveTokens`, else 16384; 0 when `compaction.enabled` is false.
 */
export function reserveFrom(settings: unknown, model?: { provider: string; id: string }): number {
    const compaction = isRec(settings) && isRec(settings.compaction) ? settings.compaction : {};
    if (compaction.enabled === false) return 0;
    const overrides = isRec(compaction.modelOverrides) ? compaction.modelOverrides : {};
    const entry = model ? overrides[`${model.provider}/${model.id}`] : undefined;
    return (
        (isRec(entry) ? count(entry.reserveTokens) : undefined) ?? count(compaction.reserveTokens) ?? DEFAULT_RESERVE
    );
}

/**
 * Whether the branch was sent to the model before: it holds a reply with usage, or a compaction. Then Pi's total counts the
 * prompt and the tools too (or is null, after a compaction); before that, Pi's figure is an estimate of the messages alone.
 */
export function hasReply(entries: readonly unknown[]): boolean {
    for (let i = entries.length - 1; i >= 0; i--) {
        const entry = entries[i];
        if (!isRec(entry)) continue;
        if (entry.type === "compaction") return true;
        const message = entry.type === "message" && isRec(entry.message) ? entry.message : undefined;
        if (message?.role !== "assistant" || message.stopReason === "error" || message.stopReason === "aborted")
            continue;
        const usage = isRec(message.usage) ? message.usage : undefined;
        const total = ["input", "output", "cacheRead", "cacheWrite"].reduce(
            (sum, k) => sum + (count(usage?.[k]) ?? 0),
            0,
        );
        if (total > 0) return true;
    }
    return false;
}
