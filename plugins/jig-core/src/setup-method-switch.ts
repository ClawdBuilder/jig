// What choosing a sign-in method leaves behind. A method's fields are written one by one, so the fields of the method it
// replaces would stay beside them (`auth: { email, token, transport }`), and the plugin's own check refuses what setup
// saved. Here the fields the other methods own are taken out in the same change, and the result is checked before it is
// kept: a check that still fails reverts the method and says the check's words.
import type { SetupChange, SetupField, SetupMethod, SetupPlan, SetupSection } from "./setup-plan.ts";
import { mergedSection } from "./setup-answer.ts";
import type { SetupUi } from "./setup.ts";
import { getPath, isObject } from "./setup-values.ts";
import { removeValuePath } from "./setup-write.ts";

const parentOf = (path: string): string => path.split(".").slice(0, -1).join(".");

/**
 * The paths a method owns, from its fields: the required ones (the paths that make the section use this method, as the
 * contract says), and its optional ones that sit in the same object as a required one, such as `auth.cloudId` beside
 * `auth.oauth`. A setting in another place, such as `timeoutSeconds` next to `auth`, belongs to no method: it holds
 * whatever the person signs in with. A `*` is already a name here, because the fields are the plan's.
 */
export function ownedPaths(fields: readonly SetupField[]): string[] {
    const beside = new Set(fields.filter((field) => field.optional !== true).map((field) => parentOf(field.path)));
    return fields
        .filter((field) => field.optional !== true || beside.has(parentOf(field.path)))
        .map((field) => field.path);
}

/** What setup knew when a method was picked, so a method the section's check refuses can be put back. */
export interface SwitchMark {
    snapshot: unknown;
    changes: number;
    /** The check's messages then: only new ones refuse the method. */
    before: readonly string[];
}

/** The check's messages for the draft's section; a check that cannot run says nothing here (each answer was checked). */
function messagesOf(plan: SetupPlan, section: string, draft: Record<string, unknown>): string[] {
    const check = plan.checks.get(section);
    if (check === undefined) return [];
    const own = draft[section];
    try {
        return check(mergedSection(plan, section, isObject(own) ? own : {})).map(String);
    } catch {
        return [];
    }
}

/** Notes the draft before a method's fields are asked. */
export function beginSwitch(
    plan: SetupPlan,
    section: string,
    draft: Record<string, unknown>,
    changes: readonly SetupChange[],
): SwitchMark {
    return {
        snapshot: structuredClone(draft[section]),
        changes: changes.length,
        before: messagesOf(plan, section, draft),
    };
}

/** A message as one sentence of the check's own words, cut short. */
function sentence(message: string): string {
    const text = message.replace(/\s+/g, " ").trim();
    const cut = text.length > 240 ? `${text.slice(0, 237)}...` : text;
    return /[.?!]$/.test(cut) ? cut : `${cut}.`;
}

/**
 * After a method's fields were asked: once the section holds the method's required fields, the fields the other methods
 * own (and this one does not) are removed from the person's section, one change each. Then the section's check runs; a
 * message it did not give before reverts everything this method wrote and removed, and says the message.
 */
export function endSwitch(
    plan: SetupPlan,
    section: SetupSection,
    method: SetupMethod,
    mark: SwitchMark,
    draft: Record<string, unknown>,
    changes: SetupChange[],
    ui: SetupUi,
): void {
    const mine = method.fields.map((field) => field.path);
    const required = method.fields.filter((field) => field.optional !== true);
    const own = draft[section.name];
    const merged = mergedSection(plan, section.name, isObject(own) ? own : {});
    const answered = required.length > 0 && required.every((field) => getPath(merged, field.path) !== undefined);
    if (answered && isObject(own)) {
        const touches = (path: string): boolean =>
            mine.some((one) => one === path || one.startsWith(`${path}.`) || path.startsWith(`${one}.`));
        const gone = new Map<string, string>();
        // The label is the words of the method the person signed in with, the current one first.
        const others = (section.methods ?? []).filter((other) => other.id !== method.id);
        others.sort((left, right) => Number(right.current === true) - Number(left.current === true));
        for (const other of others) {
            for (const field of other.fields) {
                if (other.owns.includes(field.path) && !touches(field.path) && !gone.has(field.path)) {
                    gone.set(field.path, field.label);
                }
            }
        }
        for (const [path, label] of gone) {
            if (getPath(own, path) === undefined) continue;
            removeValuePath(own, path);
            changes.push({ section: section.name, path, label, value: undefined, remove: true });
        }
    }
    const fresh = messagesOf(plan, section.name, draft).find((message) => !mark.before.includes(message));
    if (fresh === undefined) return;
    if (mark.snapshot === undefined) delete draft[section.name];
    else draft[section.name] = mark.snapshot;
    changes.length = mark.changes;
    ui.notify(`The ${section.label} sign-in was not changed: ${sentence(fresh)}`, "warning");
}
