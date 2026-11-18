// The questions of one section: what the plugin asks for it, what its validator names, and the sign-in method it uses,
// in the order setup asks them. One field per path: a sign-in method's field wins, and a validator's field and a
// question for the same path become one, in the question's words and the validator's kind.
import type { SetupField, SetupMethod, SetupState } from "./setup-plan.ts";
import { sectionState } from "./section-state.ts";
import { fieldKind, fieldLabel, isSecret, labelOf, placeholderFor, reasonFor } from "./setup-fields.ts";
import { referenceChoice } from "./setup-reference.ts";
import { layered, removedAt, removedPaths } from "./section-defaults.ts";
import { messagePaths } from "./setup-answer.ts";
import { setupMethods } from "./setup-methods-plan.ts";
import { transportNames } from "./setup-transports.ts";
import {
    coversPath,
    itemAtPath,
    methodPaths,
    questionFields,
    questionItems,
    withItemWords,
} from "./setup-questions.ts";
import { getPath, isObject, parentIsObject, safePath } from "./setup-values.ts";

/** One section's questions, with its sign-in methods, or no question and no method when it needs neither. */
export interface SectionQuestions {
    label: string;
    fields: SetupField[];
    methods?: SetupMethod[];
    /** True when setup asks which sign-in method to use. */
    askMethod: boolean;
    notes: string[];
}

/** The section's defaults under the person's own values, with the replace/oneOf/union rules applied. */
export function layeredSection(state: SetupState, section: string, rawSection: Record<string, unknown>): unknown {
    return layered(
        state.defaults.get(section),
        rawSection,
        state.replace.get(section) ?? [],
        state.oneOf.get(section) ?? [],
        state.union.get(section) ?? [],
    );
}

/** Whether a method field asks for this path, or for one above or below it (`auth` covers `auth.email`). */
function coveredBy(covered: readonly string[], path: string): boolean {
    return covered.some((one) => one === path || one.startsWith(`${path}.`) || path.startsWith(`${one}.`));
}

/** The validator's messages for one section, which name the fields setup may ask about. */
function sectionMessages(state: SetupState, section: string): readonly string[] {
    const now = sectionState(state.personal, section);
    if (now === "company defaults incomplete") return state.personal.incomplete.get(section) ?? [];
    if (now !== "not set or invalid") return [];
    return state.personal.problems.filter((problem) => problem.key === section).map((problem) => problem.message);
}

/** A field for one path a validator names, or the note saying why setup cannot ask for it here. */
function validatorField(
    state: SetupState,
    section: string,
    path: string,
    message: string,
    merged: unknown,
    rawSection: Record<string, unknown>,
): SetupField | { note: string } {
    const defaults = state.defaults.get(section);
    if (removedAt(removedPaths(defaults, rawSection), path) !== undefined) return { note: "" };
    const label = fieldLabel(section, path);
    if (!safePath(path)) return { note: `${labelOf(section)} needs a change that setup cannot ask for here.` };
    if (!parentIsObject(rawSection, path)) {
        return { note: `${label} sits under a value setup cannot change here. /jig doctor names the problem.` };
    }
    const current = getPath(merged, path);
    const defaultValue = getPath(defaults, path);
    if (current !== undefined && (typeof current === "object" || Array.isArray(current))) {
        return { note: `${label} holds more than one value, so setup leaves it for later.` };
    }
    const last = path.split(".").at(-1) ?? path;
    if (isSecret(last, current, defaultValue, message)) {
        const reference = referenceChoice(state, current, defaultValue);
        if (reference.stores.length === 0) {
            return {
                note: `${label}: no secret store is available. Turn one on in your settings, then run /jig setup again.`,
            };
        }
        return {
            section,
            path,
            label,
            question: `Where do you keep the ${label}?`,
            reason: "Jig reads the value from there when a tool needs it.",
            kind: "reference",
            reference,
        };
    }
    const kind = fieldKind(current, message, last);
    const placeholder = placeholderFor(kind, current, last);
    return {
        section,
        path,
        label,
        question: label,
        ...(placeholder === undefined ? {} : { placeholder }),
        kind,
        ...(typeof current === "string" || typeof current === "number" || typeof current === "boolean"
            ? { current }
            : {}),
        reason: reasonFor(message),
    };
}

/** The questions of one section, in the order setup asks them: required questions, the sign-in method, then the
 *  optional ones. `requested` is a section the person named, which also asks how they already sign in. */
export function sectionQuestions(
    state: SetupState,
    section: string,
    raw: Record<string, unknown>,
    requested = false,
): SectionQuestions {
    const notes: string[] = [];
    const rawValue = raw[section];
    const rawSection = isObject(rawValue) ? rawValue : {};
    const merged = layeredSection(state, section, rawSection);
    const items = questionItems(state.onboarding, state.sectionSetup?.get(section)?.items, section);
    const { methods, askMethod } = setupMethods(state, section, merged, requested, transportNames(state, raw));
    // A method covers a validator's field only while its question is asked in this run, and only for the paths that make a
    // sign-in; a wrong value anywhere else is still the validator's question.
    const methodCovered = askMethod ? methodPaths(methods) : [];
    const itemOrder = new Map(items.map((one, index) => [one.item.path, index]));

    if (rawValue !== undefined && !isObject(rawValue)) {
        notes.push(`${labelOf(section)} is not in a shape setup can change here. /jig doctor names the problem.`);
    }
    const required: Array<{ field: SetupField; order: number }> = [];
    const askedByValidator = new Set<string>();
    const validatorPaths = new Set<string>();
    for (const message of sectionMessages(state, section)) {
        const paths = messagePaths(message, section);
        if (paths.length === 0) {
            notes.push("This part needs a change that setup cannot ask for here.");
            continue;
        }
        for (const path of paths) {
            if (validatorPaths.has(path)) continue;
            validatorPaths.add(path);
            if (coveredBy(methodCovered, path)) continue;
            const item = itemAtPath(items, path);
            // An entry or an object asks for the map itself; a validator field cannot add one more to it.
            if (item?.item.kind === "entry" || item?.item.kind === "object") continue;
            // Another question above or below this path asks for it; an exact one gets the validator's field, with
            // its words, because the validator's kind and secret classification must not be replaced by the item's.
            if (item === undefined && coversPath(items, path)) continue;
            const built = validatorField(state, section, path, message, merged, rawSection);
            if ("note" in built) {
                if (built.note !== "") notes.push(built.note);
                continue;
            }
            if (item !== undefined) askedByValidator.add(path);
            required.push({
                field: item === undefined ? built : withItemWords(state, built, item),
                order: item === undefined ? 10_000 : (itemOrder.get(path) ?? 10_000),
            });
        }
    }

    const itemFields = questionFields(state, items, raw, requested, askedByValidator).map((field) => ({
        field,
        order: itemOrder.get(field.path) ?? 10_000,
    }));
    const fields = [...itemFields, ...required]
        .sort((left, right) => {
            const optional = (one: { field: SetupField }): number => (one.field.optional === true ? 1 : 0);
            return optional(left) - optional(right) || left.order - right.order;
        })
        .map((one) => one.field);

    for (const method of methods) {
        for (const note of method.notes ?? []) notes.push(`${method.label}: ${note}`);
    }
    return {
        label: labelOf(section),
        fields,
        ...(methods.length === 0 ? {} : { methods }),
        askMethod: methods.length > 0 && askMethod,
        notes,
    };
}
