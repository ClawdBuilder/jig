// Lays a company's onboarding list over the fields the validators named: its labels, its words, its hints, and the order
// it asks them in. Internal to jig-core; setup-plan.ts calls it once, after the fields are built.
import type { OnboardingEntry } from "./contract.ts";
import { onboardingItemAt } from "./onboarding.ts";
import { optionalQuestion, referenceQuestion } from "./setup-fields.ts";
import type { SetupSection } from "./setup-plan.ts";

/** Lays the company's labels, words and hints over the fields the validators named, and orders them by the list. */
export function applyOnboarding(
    entry: OnboardingEntry,
    candidates: Array<{ section: SetupSection; order: number }>,
): void {
    const position = new Map<string, number>();
    for (const [index, item] of entry.items.entries()) {
        if (item.kind === "info" || item.kind === "login" || item.kind === "proposal") continue;
        position.set(`${item.section}.${item.path}`, index);
    }
    for (const { section } of candidates) {
        section.fields.sort(
            (left, right) =>
                (position.get(`${left.section}.${left.path}`) ?? Number.MAX_SAFE_INTEGER) -
                (position.get(`${right.section}.${right.path}`) ?? Number.MAX_SAFE_INTEGER),
        );
        for (const field of section.fields) {
            const item = onboardingItemAt(entry, field.section, field.path);
            if (item === undefined || item.kind === "info" || item.kind === "login" || item.kind === "proposal")
                continue;
            field.label = item.label;
            field.question = item.kind === "reference" ? referenceQuestion(item.label) : item.label;
            if (item.why !== undefined) field.reason = item.why;
            if (item.kind === "text") {
                if (item.placeholder !== undefined) field.placeholder = item.placeholder;
                if (item.optional === true) {
                    field.optional = true;
                    field.question = optionalQuestion(item.label);
                }
                continue;
            }
            if (item.kind === "pick") {
                field.kind = "pick";
                field.choices = [...item.choices];
                field.placeholder = undefined;
                continue;
            }
            // A reference: only a field the validator already treats as a credential can carry the company's hints.
            const reference = field.reference;
            if (field.kind !== "reference" || reference === undefined) continue;
            const preferred = item.preferredStore ?? entry.preferredStore;
            if (preferred !== undefined && reference.stores.includes(preferred)) {
                reference.preferred = preferred;
                reference.stores = [preferred, ...reference.stores.filter((store) => store !== preferred)];
            }
            if (item.suggested !== undefined) reference.suggested = item.suggested;
            if (item.addHints !== undefined) reference.addHints = item.addHints;
        }
    }
}
