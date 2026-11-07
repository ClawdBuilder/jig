// `/context`: the same breakdown the Context panel reads, as a grid and a list in Pi's terminal. Nothing is measured here:
// `ContextView.detail()` is the one calculation, and this file only names and lays out its parts. Tokens are estimates
// (characters / 4, and messages = Pi's total less the parts), as breakdown.ts says.
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Key, matchesKey, truncateToWidth } from "@earendil-works/pi-tui";
import type { Theme } from "@earendil-works/pi-coding-agent";
import type { ContextDetail } from "./context.ts";
import { tokensOf } from "./breakdown.ts";

export interface ToolGroup {
    label: string;
    tools: Array<{ name: string; tokens: number; on: boolean }>;
}

export interface JigMessage {
    label: string;
    count: number;
    tokens: number;
}

export interface ContextReport {
    detail: ContextDetail;
    model: string;
    /** Jig's own messages: ticket notes, recall, review follow-ups. They are part of the messages estimate, not extra. */
    messages: JigMessage[];
    groups: ToolGroup[];
    /** Deferred tools: their names are not in the context; they are found by `tool_search` first. */
    deferred: string[];
}

export interface ReportInput {
    detail: ContextDetail;
    model: string;
    /** `tool -> plugin` from `jig().tools.declared()`. */
    declared: ReadonlyMap<string, string>;
    /** Tools Pi reports as deferred, whether or not the active set names them. */
    deferred?: readonly string[];
    entries?: readonly unknown[];
}

const isRec = (value: unknown): value is Record<string, unknown> =>
    typeof value === "object" && value !== null && !Array.isArray(value);

const messageText = (value: unknown): string => {
    if (typeof value === "string") return value;
    if (!Array.isArray(value)) return "";
    return value.map((part) => (isRec(part) && typeof part.text === "string" ? part.text : "")).join("");
};

const CUSTOM_LABELS: Readonly<Record<string, string>> = {
    "jig-memory-notes": "Ticket notes",
    "jig-memory-recall": "Recall results",
    "jig-memory-empty-files": "Ticket checks",
    "jig-memory-checks": "Ticket checks",
    "jig-memory-card-request": "Ticket card request",
    "jig-memory-card-fix": "Ticket card fix",
    "jig-memory-close-offer": "Ticket close offer",
};

/** Jig's messages, found by their custom types; review follow-ups are the two prompts jig-review sends as user messages. */
export function jigMessages(entries: readonly unknown[]): JigMessage[] {
    const found = new Map<string, JigMessage>();
    const add = (label: string, chars: number): void => {
        const known = found.get(label) ?? { label, count: 0, tokens: 0 };
        known.count++;
        known.tokens += tokensOf(chars);
        found.set(label, known);
    };
    for (const entry of entries) {
        if (!isRec(entry)) continue;
        if (entry.type === "custom" && typeof entry.customType === "string") {
            const label = CUSTOM_LABELS[entry.customType];
            if (label !== undefined) add(label, messageText(entry.content).length);
            continue;
        }
        if (entry.type !== "message" || !isRec(entry.message)) continue;
        const message = entry.message;
        if (message.role !== "user") continue;
        const text = messageText(message.content);
        if (text.startsWith("Interactive code review ")) add("Review follow-ups", text.length);
        else if (text.startsWith("The user approved ")) add("Review follow-ups", text.length);
    }
    return [...found.values()].sort((a, b) => b.tokens - a.tokens);
}

/** The report: the detail as Pi gave it, with tool ownership and Jig's messages alongside. */
export function buildReport(input: ReportInput): ContextReport {
    const deferred = new Set(input.deferred ?? []);
    const groups = new Map<string, ToolGroup>();
    const add = (label: string, name: string, tokens: number, on: boolean): void => {
        const group = groups.get(label) ?? { label, tools: [] };
        group.tools.push({ name, tokens, on });
        groups.set(label, group);
    };
    for (const tool of input.detail.tools) {
        if (deferred.has(tool.name) || !tool.on) continue;
        const plugin = input.declared.get(tool.name);
        add(plugin === undefined ? "Pi built-in / other" : plugin, tool.name, tool.tokens, true);
    }
    return {
        detail: input.detail,
        model: input.model,
        messages: jigMessages(input.entries ?? []),
        groups: [...groups.values()].sort((a, b) =>
            a.label === "Pi built-in / other"
                ? b.label === "Pi built-in / other"
                    ? 0
                    : -1
                : b.label === "Pi built-in / other"
                  ? 1
                  : a.label.localeCompare(b.label),
        ),
        deferred: [...deferred].sort(),
    };
}

const count = (value: number): string => value.toLocaleString("en-US");
const percent = (part: number, whole: number | null): string =>
    whole === null || whole <= 0 ? "—" : `${((part / whole) * 100).toFixed(1)}%`;

const PARTS = [
    { key: "system", label: "System prompt", role: "accent" },
    { key: "contextFiles", label: "Context files", role: "success" },
    { key: "skills", label: "Skills", role: "warning" },
    { key: "tools", label: "Tools", role: "toolTitle" },
    { key: "messages", label: "Messages", role: "accent" },
] as const;

type PartKey = (typeof PARTS)[number]["key"];

/** The grid: one cell per percent of the window, coloured by part; free space stays dim. Narrow widths wrap. */
function grid(report: ContextReport, width: number, paint: (role: string, text: string) => string): string[] {
    const { window, used, parts } = report.detail;
    if (window === null || window <= 0 || used === null) return [];
    const amount: Record<PartKey, number> = {
        system: parts.system,
        contextFiles: parts.contextFiles,
        skills: parts.skills,
        tools: parts.tools,
        messages: parts.messages ?? 0,
    };
    const cells = 100;
    const counts = new Map<PartKey, number>();
    let taken = 0;
    for (const part of PARTS) {
        const n = Math.min(cells - taken, Math.max(0, Math.round((amount[part.key] / window) * cells)));
        counts.set(part.key, n);
        taken += n;
    }
    const free = Math.max(0, cells - taken);
    const row =
        PARTS.map((part) => paint(part.role, "█".repeat(counts.get(part.key) ?? 0))).join("") +
        paint("dim", "░".repeat(free));
    const columns = Math.max(10, Math.min(cells, width));
    const lines: string[] = [];
    for (let at = 0; at < row.length; at += columns) lines.push(row.slice(at, at + columns));
    return lines;
}

/** The command's lines. `paint` lets the terminal use Pi's theme and a test use plain text. */
export function reportLines(
    report: ContextReport,
    width: number,
    paint: (role: string, text: string) => string,
): string[] {
    const { detail } = report;
    const used = detail.used;
    const window = detail.window;
    const estimate = detail.usedFrom !== "pi" || detail.parts.messages === null;
    const lines: string[] = [
        paint("accent", `Context · ${report.model}`),
        paint(
            "muted",
            `Window ${window === null ? "unknown" : count(window)} · Used ${used === null ? "unknown" : count(used)} (${percent(used ?? 0, window)})${estimate ? " · estimate" : ""}`,
        ),
    ];
    lines.push(...grid(report, width, paint));
    for (const part of PARTS) {
        const tokens = detail.parts[part.key];
        if (tokens === null) continue;
        lines.push(
            `${paint(part.role, "█")} ${part.label.padEnd(15)} ${count(tokens).padStart(8)}  ${percent(tokens, window).padStart(6)}${part.key === "messages" ? "  estimate" : ""}`,
        );
    }
    if (detail.reserve > 0) {
        lines.push(`${paint("dim", "░")} ${"Compaction reserve".padEnd(15)} ${count(detail.reserve).padStart(8)}`);
    }
    if (detail.free !== null) {
        lines.push(`${paint("dim", "░")} ${"Free".padEnd(15)} ${count(detail.free).padStart(8)}`);
    }
    lines.push("", paint("accent", "Tools"));
    for (const group of report.groups) {
        lines.push(paint("toolTitle", group.label));
        for (const tool of group.tools) {
            lines.push(
                `  ${tool.on ? "" : "off "}${tool.name.padEnd(24)} ${tool.on ? count(tool.tokens).padStart(7) : "not in context"}`,
            );
        }
    }
    if (report.deferred.length > 0) {
        lines.push(paint("toolTitle", "Deferred (found by tool_search)"));
        for (const name of report.deferred) lines.push(`  ${name.padEnd(24)} not in context`);
    }
    if (report.messages.length > 0) {
        lines.push("", paint("accent", "Jig messages (apart from conversation)"));
        for (const message of report.messages) {
            lines.push(
                `  ${message.label.padEnd(24)} ${String(message.count).padStart(3)}  ${count(message.tokens).padStart(7)}  estimate`,
            );
        }
    }
    lines.push("", paint("muted", "q or Esc closes · tokens are estimates"));
    return lines.map((line) => truncateToWidth(line, Math.max(0, width), ""));
}

/** Shows `/context` until q/Esc, or prints it when there is no screen. */
export async function showContext(ctx: ExtensionContext, report: ContextReport): Promise<void> {
    if (!ctx.hasUI) {
        for (const line of reportLines(report, 100, (_role, text) => text)) ctx.ui.notify(line, "info");
        return;
    }
    await ctx.ui.custom<void>((tui, theme, _keys, done) => {
        const component = {
            invalidate(): void {},
            dispose(): void {},
            handleInput(data: string): void {
                if (matchesKey(data, Key.escape) || data === "q") done();
            },
            render(width: number): string[] {
                const paint = (role: string, text: string): string =>
                    theme.fg(role as Parameters<Theme["fg"]>[0], text);
                const height = Math.max(1, tui.terminal?.rows ?? 24);
                return reportLines(report, width, paint).slice(0, Math.max(1, height - 1));
            },
        };
        return component;
    });
}
