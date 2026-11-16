// The doctor's "You need:" lines: the fields a company's onboarding list says its tools need, and the settings do not
// hold. A missing section is named once; a loaded section that lacks a required field is named field by field, in the
// item's own words, so a tool refusing at run time is not the first word about it. Optional items are never named: that
// is what makes them optional.
import type { DoctorContext, DoctorLine } from "./doctor.ts";
import { sectionState } from "./section-state.ts";
import { getPath } from "./setup-plan.ts";

export function onboardingLines(context: DoctorContext, settingsShown: string): DoctorLine[] {
    const entry = context.onboarding;
    if (entry === undefined) return [];
    const lines: DoctorLine[] = [];
    for (const [index, item] of entry.items.entries()) {
        if (item.kind === "info" || item.kind === "login") continue;
        if (item.kind === "text" && item.optional === true) continue;
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
    return lines;
}
