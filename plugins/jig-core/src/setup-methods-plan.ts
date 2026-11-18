// The sign-in methods of one section, as setup asks them: the plugin's own, with the company's default, hidden ids and
// fixed prefill, each field already a question. A method a company makes usable is offered only while a company is active.
import type { OnboardingMethod } from "./contract-onboarding.ts";
import type { SetupField, SetupMethod, SetupState } from "./setup-plan.ts";
import { inferredMethod, requiredPaths } from "./onboarding-methods.ts";
import { expandMethodPath, methodPathAllowed } from "./setup-method-paths.ts";
import { referenceChoice } from "./setup-reference.ts";
import { optionalQuestion, referenceQuestion } from "./setup-fields.ts";
import { getPath } from "./setup-values.ts";

/** The methods of one section as setup asks them, and whether the "How do you sign in?" question is needed. */
export interface MethodPlan {
    methods: SetupMethod[];
    /** True when setup asks which method to use: the section is named, or its values select none. */
    askMethod: boolean;
}

/** `transports` are the names a method that goes through a transport may offer: it is offered only while there is one. */
export function setupMethods(
    state: SetupState,
    section: string,
    merged: unknown,
    requested = false,
    transports: readonly string[] = [],
): MethodPlan {
    const registered = state.onboardingMethods?.get(section) ?? [];
    const choice = state.onboarding?.methods?.[section];
    const hidden = new Set(choice?.hide ?? []);
    const prefill = new Map<string, Map<string, string>>();
    const added: OnboardingMethod[] = [];
    for (const method of choice?.add ?? []) {
        const target = registered.find((one) => requiredPaths(one) === requiredPaths(method));
        if (target !== undefined && target.id === method.id) {
            const values = new Map<string, string>();
            for (const field of method.fields) {
                if (field.kind !== "reference" && field.value !== undefined) values.set(field.path, field.value);
            }
            prefill.set(method.id, values);
            continue;
        }
        added.push(method);
    }
    const all = [...registered, ...added];
    // A method that goes through a transport is offered while one exists, or while a company fixes which one.
    const visible = all.filter(
        (method) =>
            !hidden.has(method.id) &&
            (method.companyOnly !== true || state.companyActive === true) &&
            (method.viaTransport !== true || transports.length > 0 || prefill.has(method.id)),
    );
    if (visible.length === 0) return { methods: [], askMethod: false };
    const chosen = choice?.default ?? visible[0]?.id;
    const current = inferredMethod(visible, merged);
    const methods = visible.map((method) => {
        const fields: SetupField[] = [];
        const notes: string[] = [];
        const fixed = prefill.get(method.id);
        for (const field of method.fields) {
            const paths = expandMethodPath(field.path, merged).filter((path) =>
                methodPathAllowed(field.path, path, method, merged),
            );
            if (paths.length === 0) notes.push(`No match for ${field.path}; name it first.`);
            for (const path of paths) {
                const at = getPath(merged, path);
                const current =
                    typeof at === "string" || typeof at === "number" || typeof at === "boolean" ? at : undefined;
                const value = fixed?.get(field.path) ?? (field.kind === "reference" ? undefined : field.value);
                if (value !== undefined) {
                    fields.push({
                        section,
                        path,
                        label: field.label,
                        question: field.label,
                        kind: "text",
                        ...(current === undefined ? {} : { current, keep: true as const }),
                        fixed: value,
                        reason: field.why ?? "The company's sign-in choice sets this.",
                    });
                    continue;
                }
                if (field.kind === "reference") {
                    const reference = referenceChoice(state, current, getPath(state.defaults.get(section), path));
                    if (field.stores !== undefined) {
                        reference.stores = field.stores.filter((store) => reference.stores.includes(store));
                    }
                    const preferred = field.preferredStore ?? state.onboarding?.preferredStore;
                    if (preferred !== undefined && reference.stores.includes(preferred)) {
                        reference.preferred = preferred;
                        reference.stores = [preferred, ...reference.stores.filter((store) => store !== preferred)];
                    }
                    if (field.suggested !== undefined) reference.suggested = field.suggested;
                    if (field.addHints !== undefined) reference.addHints = field.addHints;
                    fields.push({
                        section,
                        path,
                        label: field.label,
                        question: referenceQuestion(field.label),
                        kind: "reference",
                        ...(current === undefined ? {} : { current, keep: true as const }),
                        reason: field.why ?? "Jig reads the value from there when a tool needs it.",
                        reference,
                    });
                    continue;
                }
                if (method.viaTransport === true && field.kind === "text") {
                    // Which transport: a pick of the names that exist, never a name typed.
                    fields.push({
                        section,
                        path,
                        label: field.label,
                        question: field.label,
                        kind: "pick",
                        choices: [...transports],
                        ...(current === undefined ? {} : { current, keep: true as const }),
                        reason: field.why ?? "Jig sends the requests through the transport you pick.",
                    });
                    continue;
                }
                if (field.kind === "pick") {
                    fields.push({
                        section,
                        path,
                        label: field.label,
                        question: field.label,
                        kind: "pick",
                        choices: [...field.choices],
                        ...(current === undefined ? {} : { current, keep: true as const }),
                        reason: field.why ?? "The plugin's list says the choices.",
                    });
                    continue;
                }
                fields.push({
                    section,
                    path,
                    label: field.label,
                    question: field.optional === true ? optionalQuestion(field.label, field.placeholder) : field.label,
                    ...(field.placeholder === undefined ? {} : { placeholder: field.placeholder }),
                    ...(current === undefined ? {} : { current, keep: true as const }),
                    kind: "text",
                    ...(field.optional === true ? { optional: true as const } : {}),
                    reason: field.why ?? "The plugin's list says this field is needed.",
                });
            }
        }
        return {
            id: method.id,
            label: method.label,
            ...(method.who === undefined ? {} : { who: method.who }),
            default: method.id === chosen,
            ...(choice?.default === method.id ? { companyDefault: true as const } : {}),
            ...(current === undefined ? {} : { current: method.id === current.id }),
            fields,
            ...(notes.length === 0 ? {} : { notes }),
        };
    });
    return { methods, askMethod: requested || current === undefined };
}
