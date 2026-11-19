// Setup's plugin list: one line per registered plugin section that said what it needs, with its status. Picking a line
// asks that plugin's questions and comes back here; "Done" saves everything. A plugin with no questions yet says what to
// read and shows a section to add by hand.
import type { SectionCheck } from "./config.ts";
import type { OnboardingSetup } from "./contract-onboarding.ts";
import type { SetupState } from "./setup-plan.ts";
import type { SetupUi } from "./setup.ts";
import { onboardingOrder } from "./onboarding.ts";
import { sectionState } from "./section-state.ts";
import { labelOf } from "./setup-fields.ts";
import { layeredSection } from "./setup-section.ts";
import { isObject } from "./setup-values.ts";

export type PluginStatus =
    | "set up"
    | "not set up"
    | "ready"
    | "ready (optional settings)"
    | "not set up (questions coming)";

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

/** What a choice that ends the plugin's questions is called while the questions come from the list. */
const BACK_TO_LIST = "Back to the list";

/**
 * The screen as a plugin's questions see it when they were picked from the list. Its choices that say "Cancel setup" (a
 * relay that does not answer, a credential not found yet) only leave that plugin and return to the list, so they say
 * that. Anywhere else there is no list, and the same choice does end setup.
 */
export function listScreen(ui: SetupUi): SetupUi {
    return {
        select: async (title, options) => {
            const answer = await ui.select(
                title,
                options.map((option) => (option === "Cancel setup" ? BACK_TO_LIST : option)),
            );
            return answer === BACK_TO_LIST ? "Cancel setup" : answer;
        },
        input: (title, placeholder) => ui.input(title, placeholder),
        confirm: (title, message, options) => ui.confirm(title, message, options),
        notify: (text, level) => ui.notify(text, level),
    };
}

/** The words for a number of changes: "1 change", "3 changes". */
export function changeCount(count: number): string {
    return count === 1 ? "1 change" : `${count} changes`;
}

/** The list's title: with answers not yet saved it says how many, so Ctrl+C at the list is not a surprise. */
export function listTitle(unsaved: number): string {
    return unsaved === 0 ? LIST_TITLE : `${LIST_TITLE} (${unsaved} unsaved ${unsaved === 1 ? "change" : "changes"})`;
}
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
    if (setup?.items !== undefined) {
        if (configured(state, section, raw)) return "set up";
        return optionalSettingsOnly(state, section) ? "ready (optional settings)" : "not set up";
    }
    if (setup?.pending !== undefined) return "not set up (questions coming)";
    return "ready";
}

/** Whether every question a plugin asks is optional, so writing no settings at all is an answer. */
export function onlyOptionalQuestions(setup: OnboardingSetup | undefined): boolean {
    if (setup?.items === undefined) return false;
    return setup.items.every(
        (item) =>
            item.kind === "info" ||
            item.kind === "login" ||
            item.kind === "proposal" ||
            ("optional" in item && item.optional === true),
    );
}

/** Whether a section's own check passes a section with nothing written: the plugin works on its defaults. */
export function passesWithoutSettings(check: SectionCheck | undefined, empty: unknown): boolean {
    if (check === undefined) return false;
    try {
        return check(empty).length === 0;
    } catch {
        return false;
    }
}

/** Whether setup and the doctor may leave a plugin alone: all its questions are optional and it works with nothing
 *  written. Git is the first: it works on its defaults, and an account mapping is the person's choice. */
export function optionalSettingsOnly(state: SetupState, section: string): boolean {
    if (!onlyOptionalQuestions(state.sectionSetup?.get(section))) return false;
    return passesWithoutSettings(state.sectionChecks.get(section), layeredSection(state, section, {}));
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
        "Add a section like this one to your settings, then run setup again:",
        JSON.stringify(pending.example, null, 4),
    ];
}

/** What setup says when a plugin needs nothing. */
export function readyLines(label: string, setup: OnboardingSetup): string[] {
    return [`${label} is ready: ${setup.summary}`, "Nothing to ask; Jig's defaults apply."];
}
