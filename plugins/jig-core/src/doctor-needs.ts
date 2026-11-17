// The doctor's "You need:" lines: the fields a company's onboarding list says its tools need, and the settings do not
// hold. A missing section is named once; a loaded section that lacks a required field is named field by field, in the
// item's own words, so a tool refusing at run time is not the first word about it. Optional items are never named: that
// is what makes them optional. Nor is a field the person left out with a `null`: they removed it on purpose. Nor is a
// plugin whose questions are all optional and whose section works with nothing written: it runs on its defaults.
import type { DoctorContext, DoctorLine } from "./doctor.ts";
import { removedAt } from "./section-defaults.ts";
import { sectionState } from "./section-state.ts";
import { getPath, isObject } from "./setup-values.ts";
import { decisionsFile, proposalId, proposalPresent, readDeclined } from "./setup-proposal.ts";
import { onlyOptionalQuestions, passesWithoutSettings } from "./setup-menu.ts";

/** The doctor's lines for sections that are not set up: a skip each for a plugin that can be asked, and one compact
 *  "Not set" line for the rest. */
export function notSetupLines(context: DoctorContext, sections: readonly string[], lines: DoctorLine[]): void {
    const rest: string[] = [];
    for (const section of sections) {
        // The caller passes sections it found not set; a loaded one (it changed while the doctor ran) is not named.
        if (sectionState(context.personal, section) === "loaded") continue;
        const setup = context.sectionSetup?.get(section);
        if (setup?.items === undefined) {
            rest.push(section);
            continue;
        }
        // Every question optional and nothing written is a valid setup: say nothing rather than nag.
        if (onlyOptionalQuestions(setup) && passesWithoutSettings(context.sectionChecks.get(section), {})) continue;
        lines.push({
            id: `config.section.${section}`,
            group: "config",
            level: "skip",
            title: section,
            detail: `not set up: ${setup.summary} Run jig setup ${section}.`,
        });
    }
    if (rest.length > 0) {
        lines.push({
            id: "config.sections.not-set",
            group: "config",
            level: "skip",
            title: "Not set",
            detail: `${rest.join(", ")}; each plugin uses its defaults.`,
        });
    }
}

export function onboardingLines(context: DoctorContext, settingsShown: string): DoctorLine[] {
    const entry = context.onboarding;
    if (entry === undefined) return [];
    const lines: DoctorLine[] = [];
    for (const [index, item] of entry.items.entries()) {
        if (item.kind === "info" || item.kind === "login" || item.kind === "proposal") continue;
        if (item.kind === "object") {
            // A map of objects is there when it has one: an empty one is not an answer.
            const value = getPath(context.sections.get(item.section), item.path);
            if (isObject(value) && Object.keys(value).length > 0) continue;
            lines.push({
                id: `config.need.${index}`,
                group: "config",
                level: "warn",
                title: `You need: ${item.label}`,
                detail: item.why ?? `Add ${item.section}.${item.path} to ${settingsShown} by hand.`,
                fix: "Run jig setup and it asks for this.",
            });
            continue;
        }
        if (item.kind === "text" && item.optional === true) continue;
        if (removedAt(context.personal.removed.get(item.section) ?? [], item.path) !== undefined) continue;
        const store = item.kind === "reference" ? (item.preferredStore ?? entry.preferredStore) : undefined;
        const hint = item.kind === "reference" ? item.addHints?.[store ?? "env"] : undefined;
        if (sectionState(context.personal, item.section) === "loaded") {
            // The section is there: name the field it lacks, with the item's question and the words it already uses.
            if (getPath(context.sections.get(item.section), item.path) !== undefined) continue;
            lines.push({
                id: `config.field.${index}`,
                group: "config",
                level: "warn",
                title: `You need: ${item.label}`,
                detail: `Add ${item.section}.${item.path} to ${settingsShown}, or run jig setup and it asks for it.`,
                fix: hint ?? "Run jig setup and it asks for this.",
            });
            continue;
        }
        lines.push({
            id: `config.need.${index}`,
            group: "config",
            level: "warn",
            title: `You need: ${item.label}`,
            detail:
                item.why ??
                `Add ${item.section}.${item.path} to ${settingsShown}, or run jig setup and it asks for it.`,
            fix: hint ?? "Run jig setup and it asks for this.",
        });
    }
    if (context.configPath !== "") {
        const declined = readDeclined(decisionsFile(context.configPath));
        const raw = (section: string) => {
            const value = context.personal.sections.get(section) ?? context.sections.get(section);
            return typeof value === "object" && value !== null && !Array.isArray(value)
                ? (value as Record<string, unknown>)
                : {};
        };
        const pending = entry.items.filter(
            (item) =>
                item.kind === "proposal" &&
                !declined.has(proposalId(item)) &&
                !proposalPresent(raw(item.section), item),
        ).length;
        if (pending > 0) {
            lines.push({
                id: "config.proposals",
                group: "config",
                level: "warn",
                title: "Company proposals",
                detail: `${pending} proposed ${pending === 1 ? "entry is" : "entries are"} waiting for your answer.`,
                fix: "Run jig setup and answer them.",
            });
        }
    }
    return lines;
}
