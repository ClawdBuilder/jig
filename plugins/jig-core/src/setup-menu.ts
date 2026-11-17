// Setup's plugin list: one line per registered plugin section that said what it needs, with its status. Picking a line
// asks that plugin's questions and comes back here; "Done" saves everything. A plugin with no questions yet says what to
// read and shows a section to add by hand.
import type { OnboardingSetup } from "./contract-onboarding.ts";
import type { SetupState } from "./setup-plan.ts";
import { onboardingOrder } from "./onboarding.ts";
import { sectionState } from "./section-state.ts";
import { labelOf } from "./setup-fields.ts";
import { layeredSection } from "./setup-section.ts";
import { isObject } from "./setup-values.ts";

export type PluginStatus = "set up" | "not set up" | "ready" | "not set up (questions coming)";

/** One line of setup's plugin list. */
export interface PluginLine {
    section: string;
    label: string;
    status: PluginStatus;
    summary: string;
    /** The whole line, as the person reads it: the label, the status and the one-line summary. */
    text: string;
}

/** Setup's last choice: no more plugins, save what there is. */
export const DONE_LINE = "Done: save and finish";

/** The question above the list. */
export const LIST_TITLE = "Jig setup: which plugin do you want to set up?";

function timeToAsk(setup: OnboardingSetup | undefined): number {
    if (setup?.items !== undefined) return 0;
    if (setup?.pending !== undefined) return 1;
    return 2;
}

/** Whether a section's values pass its own check now: the person's answers as they stand in `raw`, over the defaults. */
function configured(state: SetupState, section: string, raw: Record<string, unknown>): boolean {
    const current = raw[section];
    if (current === undefined && sectionState(state.personal, section) === "loaded") return true;
    const merged = layeredSection(state, section, isObject(current) ? current : {});
    const check = state.sectionChecks.get(section);
    let messages: readonly string[];
    try {
        messages = check === undefined ? [] : check(merged);
    } catch {
        return false;
    }
    return messages.length === 0 && (current !== undefined || state.defaults.get(section) !== undefined);
}

/** The status a line shows: a section with questions is set up or not, one waiting for them says so, the rest are ready. */
export function pluginStatus(state: SetupState, section: string, raw: Record<string, unknown>): PluginStatus {
    const setup = state.sectionSetup?.get(section);
    if (setup?.items !== undefined) return configured(state, section, raw) ? "set up" : "not set up";
    if (setup?.pending !== undefined) return "not set up (questions coming)";
    return "ready";
}

/** Every registered section that said what it needs, in the order setup shows them. */
export function pluginLines(state: SetupState, raw: Record<string, unknown>): PluginLine[] {
    const positions = onboardingOrder(state.onboarding);
    const rows: Array<{ index: number; line: PluginLine; named: number; group: number }> = [];
    let index = 0;
    for (const section of state.sectionChecks.keys()) {
        index++;
        const setup = state.sectionSetup?.get(section);
        if (setup === undefined) continue;
        rows.push({
            index,
            named: positions.get(section) ?? Number.MAX_SAFE_INTEGER,
            group: timeToAsk(setup),
            line: {
                section,
                label: labelOf(section),
                status: pluginStatus(state, section, raw),
                summary: setup.summary,
                text: "",
            },
        });
    }
    rows.sort((left, right) => left.named - right.named || left.group - right.group || left.index - right.index);
    const labels = rows.map((row) => row.line.label.length);
    const statuses = rows.map((row) => row.line.status.length);
    const labelWidth = Math.max(0, ...labels);
    const statusWidth = Math.max(0, ...statuses);
    return rows.map((row) => ({
        ...row.line,
        text: `${row.line.label.padEnd(labelWidth)}  ${row.line.status.padEnd(statusWidth)}  ${row.line.summary}`,
    }));
}

/** What setup says when a plugin needs settings it cannot ask for yet. */
export function pendingLines(label: string, setup: OnboardingSetup): string[] {
    const pending = setup.pending;
    if (pending === undefined) return [`${label} is ready: ${setup.summary}`];
    return [
        `${label} needs settings that setup cannot ask for yet: ${setup.summary}`,
        `Read ${pending.doc} in the Jig package.`,
        "Add a section like this one to your settings, then run jig setup again:",
        JSON.stringify(pending.example, null, 4),
    ];
}

/** What setup says when a plugin needs nothing. */
export function readyLines(label: string, setup: OnboardingSetup): string[] {
    return [`${label} is ready: ${setup.summary}`, "Nothing to ask; Jig's defaults apply."];
}
