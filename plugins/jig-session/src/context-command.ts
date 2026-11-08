// `/context`: the same breakdown the Context panel reads, as a grid and a list in Pi's terminal. Nothing is measured here:
// `ContextView.detail()` is the one calculation, and this file only names and lays out its parts. Tokens are estimates
// (characters / 4, and messages = Pi's total less the parts), as breakdown.ts says.
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Key, matchesKey, truncateToWidth } from "@earendil-works/pi-tui";
import type { Theme } from "@earendil-works/pi-coding-agent";
import type { ContextDetail } from "./context.ts";
import { tokensOf } from "./breakdown.ts";
import { MESSAGE_LABELS } from "../../jig-core/src/kit/jig-messages.ts";

export interface ToolGroup {
    label: string;
    tools: Array<{ name: string; tokens: number }>;
}

export interface JigMessage {
    label: string;
    count: number;
    tokens: number;
}

export interface ContextReport {
    detail: ContextDetail;
    model: string;
    /** Whether jig-core's `tools.declared()` exists; without it no tool can be attributed to a plugin. */
    jigLoaded: boolean;
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
    jigLoaded: boolean;
    entries?: readonly unknown[];
}

const isRec = (value: unknown): value is Record<string, unknown> =>
    typeof value === "object" && value !== null && !Array.isArray(value);

const messageText = (value: unknown): string => {
    if (typeof value === "string") return value;
    if (!Array.isArray(value)) return "";
    return value.map((part) => (isRec(part) && typeof part.text === "string" ? part.text : "")).join("");
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
        // Pi writes a pi.sendMessage() entry as custom_message; custom (appendEntry) has data, never content.
        if (entry.type === "custom_message" && typeof entry.customType === "string") {
            const label = MESSAGE_LABELS[entry.customType];
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
    const add = (label: string, name: string, tokens: number): void => {
        const group = groups.get(label) ?? { label, tools: [] };
        group.tools.push({ name, tokens });
        groups.set(label, group);
    };
    const piLabel = input.jigLoaded ? "Pi built-in / other" : "Jig not loaded (Pi / other tools)";
    for (const tool of input.detail.tools) {
        if (deferred.has(tool.name) || !tool.on) continue;
        const plugin = input.declared.get(tool.name);
        add(plugin === undefined ? piLabel : plugin, tool.name, tool.tokens);
    }
    return {
        detail: input.detail,
        model: input.model,
        jigLoaded: input.jigLoaded,
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
    // Wrap the cells before painting: slicing a painted string can cut an ANSI escape in half.
    const drawn: Array<{ role: string; cell: string }> = [];
    for (const part of PARTS)
        for (let i = 0; i < (counts.get(part.key) ?? 0); i++) drawn.push({ role: part.role, cell: "█" });
    for (let i = 0; i < free; i++) drawn.push({ role: "dim", cell: "░" });
    const columns = Math.max(10, Math.min(cells, width));
    const lines: string[] = [];
    for (let at = 0; at < drawn.length; at += columns)
        lines.push(
            drawn
                .slice(at, at + columns)
                .map(({ role, cell }) => paint(role, cell))
                .join(""),
        );
    return lines;
}

/** The command's lines. `paint` lets the terminal use Pi's theme and a test use plain text. */
export function reportLines(
    report: ContextReport,
    width: number,
    paint: (role: string, text: string) => string,
    options: { hint?: boolean } = {},
): string[] {
    const { detail } = report;
    const used = detail.used;
    const window = detail.window;
    const estimate = detail.usedFrom !== "pi" || detail.parts.messages === null;
    const lines: string[] = [
        paint("accent", `Context · ${report.model}`),
        paint(
            "muted",
            `Window ${window === null ? "unknown" : count(window)} · Used ${used === null ? "unknown" : count(used)} (${used === null ? "—" : percent(used, window)})${estimate ? " · estimate" : ""}`,
        ),
    ];
    lines.push(...grid(report, width, paint));
    // The mode marker, the longest label, the widest token and the widest percent line up every row. The labels include
    // "Compaction reserve", so a fixed 15 is too narrow.
    const rows: Array<{ role: string; marker: string; label: string; tokens: number; note: string }> = PARTS.flatMap(
        (part) => {
            const tokens = detail.parts[part.key];
            return tokens === null
                ? []
                : [
                      {
                          role: part.role,
                          marker: "█",
                          label: part.label,
                          tokens,
                          note: part.key === "messages" ? "  estimate" : "",
                      },
                  ];
        },
    );
    if (detail.reserve > 0)
        rows.push({ role: "dim", marker: "░", label: "Compaction reserve", tokens: detail.reserve, note: "" });
    if (detail.free !== null) rows.push({ role: "dim", marker: "░", label: "Free", tokens: detail.free, note: "" });
    const tokenWidth = Math.max(...rows.map((row) => count(row.tokens).length));
    const percentWidth = Math.max(...rows.map((row) => percent(row.tokens, window).length));
    // Keep the numbers at narrow widths; shorten the label instead. Four characters are the marker, the space after it,
    // the space before the token and the two spaces before the percent.
    const labelWidth = Math.min(
        Math.max(...rows.map((row) => row.label.length)),
        Math.max(1, width - tokenWidth - percentWidth - 4),
    );
    for (const row of rows) {
        const label = truncateToWidth(row.label, labelWidth, "…").padEnd(labelWidth);
        lines.push(
            `${paint(row.role, row.marker)} ${label} ${count(row.tokens).padStart(tokenWidth)}  ${percent(row.tokens, window).padStart(percentWidth)}${row.note}`,
        );
    }
    lines.push("", paint("accent", "Tools"));
    for (const group of report.groups) {
        lines.push(paint("toolTitle", group.label));
        for (const tool of group.tools) {
            lines.push(`  ${tool.name.padEnd(24)} ${count(tool.tokens).padStart(7)}`);
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
    if (options.hint !== false) lines.push("", paint("muted", "q or Esc closes · tokens are estimates"));
    return lines.map((line) => truncateToWidth(line, Math.max(0, width), ""));
}

/** Shows `/context` until q/Esc, or prints it when there is no screen. */
export async function showContext(ctx: ExtensionContext, report: ContextReport): Promise<void> {
    if (!ctx.hasUI) {
        ctx.ui.notify(reportLines(report, 100, (_role, text) => text, { hint: false }).join("\n"), "info");
        return;
    }
    await ctx.ui.custom<void>((tui, theme, _keys, done) => {
        let offset = 0;
        let page = 1;
        let lastLines: string[] = [];
        const component = {
            invalidate(): void {},
            dispose(): void {},
            handleInput(data: string): void {
                if (matchesKey(data, Key.escape) || data === "q") {
                    done();
                    return;
                }
                if (matchesKey(data, Key.up)) offset = Math.max(0, offset - 1);
                else if (matchesKey(data, Key.down)) offset++;
                else if (matchesKey(data, Key.pageUp)) offset = Math.max(0, offset - page);
                else if (matchesKey(data, Key.pageDown)) offset += page;
                else return;
                tui.requestRender();
            },
            render(width: number): string[] {
                const paint = (role: string, text: string): string =>
                    theme.fg(role as Parameters<Theme["fg"]>[0], text);
                const lines = reportLines(report, width, paint);
                const hint = lines.at(-1) ?? "";
                lastLines = lines.slice(0, -1);
                const height = Math.max(2, tui.terminal?.rows ?? 24);
                const visible = Math.max(1, height - 1);
                page = visible;
                offset = Math.min(offset, Math.max(0, lastLines.length - visible));
                return [...lastLines.slice(offset, offset + visible), hint];
            },
        };
        return component;
    });
}
