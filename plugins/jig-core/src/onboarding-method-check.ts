// The sign-in methods a plugin's section declares, and a company's choice among them: checked once, when they are
// registered, so setup can offer them and infer the one a person already uses. onboarding.ts checks the company's items.
import { requiredFields, requiredPaths } from "./onboarding-methods.ts";
import type {
    OnboardingMethod,
    OnboardingMethodChoice,
    OnboardingMethodField,
    OnboardingStore,
} from "./contract-onboarding.ts";
import {
    LABEL_MAX,
    METHOD_ID,
    METHOD_PATH,
    ONBOARDING_STORES,
    SECTION,
    WHY_MAX,
    oneLine,
    optionalLine,
    safeMethodPath,
} from "./onboarding-common.ts";
import { unknownField } from "./kit/fields.ts";

/** One field of a plugin method, or of a company-only fixed method. */
function checkMethodField(
    raw: unknown,
    at: string,
    company: boolean,
    errors: string[],
): OnboardingMethodField | undefined {
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
        errors.push(`${at}: must be an object`);
        return undefined;
    }
    const field = raw as Record<string, unknown>;
    const kind = field.kind;
    if (kind !== "text" && kind !== "pick" && kind !== "reference") {
        errors.push(`${at}.kind: must be text, pick or reference`);
        return undefined;
    }
    const allowed =
        kind === "reference"
            ? ["kind", "path", "label", "stores", "preferredStore", "suggested", "addHints", "why"]
            : kind === "pick"
              ? ["kind", "path", "label", "choices", "why", "value"]
              : ["kind", "path", "label", "why", "placeholder", "optional", "value"];
    for (const key of Object.keys(field)) {
        if (!allowed.includes(key)) errors.push(unknownField(at, key, allowed));
    }
    if (!METHOD_PATH.test(String(field.path)) || !safeMethodPath(String(field.path)))
        errors.push(`${at}.path: a dotted path inside the section, without a prototype key`);
    if (!oneLine(field.label, LABEL_MAX)) errors.push(`${at}.label: needed, one line`);
    optionalLine(field.why, `${at}.why`, WHY_MAX, errors);
    if (company && (typeof field.value !== "string" || !oneLine(field.value, 64))) {
        errors.push(`${at}.value: a company-only method fixes every field in one line of at most 64 characters`);
    }
    if (!company && field.value !== undefined) errors.push(`${at}.value: only a company-only method may fix a field`);
    if (kind === "text") {
        optionalLine(field.placeholder, `${at}.placeholder`, LABEL_MAX, errors);
        if (field.optional !== undefined && typeof field.optional !== "boolean")
            errors.push(`${at}.optional: true or false`);
    }
    if (kind === "pick") {
        if (!Array.isArray(field.choices) || field.choices.length === 0 || field.choices.length > 100) {
            errors.push(`${at}.choices: a list of one to 100 choices`);
        } else {
            for (const [index, choice] of field.choices.entries()) {
                if (!oneLine(choice, LABEL_MAX)) errors.push(`${at}.choices[${index}]: one line`);
            }
        }
        if (
            company &&
            typeof field.value === "string" &&
            Array.isArray(field.choices) &&
            !field.choices.includes(field.value)
        ) {
            errors.push(`${at}.value: must be one of the choices`);
        }
    }
    if (kind === "reference") {
        if (field.stores !== undefined) {
            if (!Array.isArray(field.stores) || field.stores.length === 0) {
                errors.push(`${at}.stores: a list of the stores to offer`);
            } else {
                for (const store of field.stores) {
                    if (!ONBOARDING_STORES.includes(store as OnboardingStore))
                        errors.push(`${at}.stores: ${JSON.stringify(store)} is not a store Jig knows`);
                }
            }
        }
        for (const [name, value] of [
            ["suggested", field.suggested],
            ["addHints", field.addHints],
        ] as const) {
            if (value === undefined) continue;
            if (typeof value !== "object" || value === null || Array.isArray(value)) {
                errors.push(`${at}.${name}: must be an object keyed by store`);
                continue;
            }
            for (const store of Object.keys(value)) {
                if (!ONBOARDING_STORES.includes(store as OnboardingStore))
                    errors.push(`${at}.${name}: ${JSON.stringify(store)} is not a store Jig knows`);
            }
        }
        if (field.preferredStore !== undefined && !ONBOARDING_STORES.includes(field.preferredStore as OnboardingStore))
            errors.push(`${at}.preferredStore: must be one of ${ONBOARDING_STORES.join(", ")}`);
    }
    return field as unknown as OnboardingMethodField;
}

/** Throws when a plugin's methods for one section are not a list setup can use. */
export function checkOnboardingMethods(section: string, raw: unknown): readonly OnboardingMethod[] {
    if (!SECTION.test(section)) throw new TypeError(`onboarding methods: ${JSON.stringify(section)} is not a section`);
    if (!Array.isArray(raw) || raw.length === 0) {
        throw new TypeError(`onboarding methods(${section}): methods must be a non-empty list`);
    }
    const errors: string[] = [];
    const methods: OnboardingMethod[] = [];
    const ids = new Set<string>();
    const shapes = new Map<string, string>();
    for (const [index, value] of raw.entries()) {
        const at = `methods[${index}]`;
        if (typeof value !== "object" || value === null || Array.isArray(value)) {
            errors.push(`${at}: must be an object`);
            continue;
        }
        const method = value as Record<string, unknown>;
        const keys = ["id", "label", "who", "fields", "requires", "companyOnly"];
        for (const key of Object.keys(method)) {
            if (!keys.includes(key)) errors.push(unknownField(at, key, keys));
        }
        if (method.companyOnly !== undefined && typeof method.companyOnly !== "boolean")
            errors.push(`${at}.companyOnly: true or false`);
        if (typeof method.id !== "string" || !METHOD_ID.test(method.id)) errors.push(`${at}.id: a lower-case id`);
        else if (ids.has(method.id)) errors.push(`${at}.id: ${JSON.stringify(method.id)} is used twice`);
        else ids.add(method.id);
        if (!oneLine(method.label, LABEL_MAX)) errors.push(`${at}.label: needed, one line`);
        optionalLine(method.who, `${at}.who`, LABEL_MAX, errors);
        if (
            method.requires !== undefined &&
            (!METHOD_PATH.test(String(method.requires)) || !safeMethodPath(String(method.requires)))
        ) {
            errors.push(`${at}.requires: a relative dotted path without a prototype key`);
        }
        if (!Array.isArray(method.fields) || method.fields.length === 0 || method.fields.length > 64) {
            errors.push(`${at}.fields: a list of one to 64 fields`);
            continue;
        }
        const fields: OnboardingMethodField[] = [];
        for (const [field, rawField] of method.fields.entries()) {
            const checked = checkMethodField(rawField, `${at}.fields[${field}]`, false, errors);
            if (checked !== undefined) fields.push(checked);
        }
        const complete = {
            id: String(method.id ?? ""),
            label: String(method.label ?? ""),
            ...(typeof method.who === "string" ? { who: method.who } : {}),
            ...(typeof method.requires === "string" ? { requires: method.requires } : {}),
            ...(method.companyOnly === true ? { companyOnly: true as const } : {}),
            fields,
        };
        if (requiredFields(complete as OnboardingMethod).length === 0)
            errors.push(`${at}.fields: at least one field is required`);
        const paths = requiredPaths(complete as OnboardingMethod);
        const other = shapes.get(paths);
        if (other !== undefined)
            errors.push(`${at}.fields: the same required paths as ${other}; the method could not be inferred`);
        else shapes.set(paths, String(method.id));
        methods.push(complete as OnboardingMethod);
    }
    if (errors.length > 0) throw new TypeError(`onboarding methods(${section}): ${errors.join("; ")}`);
    return methods;
}

/** The company's overlay on a section's methods, checked against the ids the plugin registered. */
export function checkMethodChoice(
    raw: unknown,
    at: string,
    known: readonly OnboardingMethod[] | undefined,
    errors: string[],
): OnboardingMethodChoice | undefined {
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
        errors.push(`${at}: must be an object`);
        return undefined;
    }
    const choice = raw as Record<string, unknown>;
    for (const key of Object.keys(choice)) {
        if (!["default", "hide", "add"].includes(key)) errors.push(unknownField(at, key, ["default", "hide", "add"]));
    }
    if (choice.default !== undefined && (typeof choice.default !== "string" || !METHOD_ID.test(choice.default)))
        errors.push(`${at}.default: a method id`);
    const hidden = new Set<string>();
    if (choice.hide !== undefined) {
        if (!Array.isArray(choice.hide)) errors.push(`${at}.hide: a list of method ids`);
        else {
            for (const [index, id] of choice.hide.entries()) {
                if (typeof id !== "string" || !METHOD_ID.test(id)) errors.push(`${at}.hide[${index}]: a method id`);
                else if (hidden.has(id)) errors.push(`${at}.hide[${index}]: ${JSON.stringify(id)} is listed twice`);
                else hidden.add(id);
            }
        }
    }
    const add: OnboardingMethod[] = [];
    if (choice.add !== undefined) {
        if (!Array.isArray(choice.add)) errors.push(`${at}.add: a list of methods`);
        else {
            for (const [index, value] of choice.add.entries()) {
                const methodAt = `${at}.add[${index}]`;
                if (typeof value !== "object" || value === null || Array.isArray(value)) {
                    errors.push(`${methodAt}: must be an object`);
                    continue;
                }
                const method = value as Record<string, unknown>;
                for (const key of Object.keys(method)) {
                    if (!["id", "label", "who", "fields"].includes(key))
                        errors.push(`${methodAt}.${key}: unknown field`);
                }
                if (typeof method.id !== "string" || !METHOD_ID.test(method.id))
                    errors.push(`${methodAt}.id: a lower-case id`);
                if (!oneLine(method.label, LABEL_MAX)) errors.push(`${methodAt}.label: needed, one line`);
                optionalLine(method.who, `${methodAt}.who`, LABEL_MAX, errors);
                if (!Array.isArray(method.fields) || method.fields.length === 0) {
                    errors.push(`${methodAt}.fields: a list of fixed fields`);
                    continue;
                }
                const fields: OnboardingMethodField[] = [];
                for (const [field, rawField] of method.fields.entries()) {
                    const checked = checkMethodField(rawField, `${methodAt}.fields[${field}]`, true, errors);
                    if (checked !== undefined) {
                        const last = checked.path.split(".").at(-1);
                        if (last !== "signIn" && last !== "transport")
                            errors.push(
                                `${methodAt}.fields[${field}].path: a company method names its own signIn or transport`,
                            );
                        fields.push(checked);
                    }
                }
                const complete = {
                    id: String(method.id ?? ""),
                    label: String(method.label ?? ""),
                    ...(typeof method.who === "string" ? { who: method.who } : {}),
                    fields,
                };
                const same = known?.find((one) => requiredPaths(one) === requiredPaths(complete));
                if (same !== undefined) {
                    if (same.id !== complete.id) {
                        errors.push(
                            `${methodAt}.id: use ${JSON.stringify(same.id)} to prefill this method's value, not a new method`,
                        );
                    }
                    // A matching path set with the plugin's id is a default value for that method, kept in `add`
                    // so the plan can prefill it without writing an id.
                    add.push(complete);
                    continue;
                }
                if (known !== undefined) {
                    const shared = [...new Set(complete.fields.map((field) => field.path))].filter((path) =>
                        known.some((one) => new Set(one.fields.map((field) => field.path)).has(path)),
                    );
                    if (shared.length > 0) {
                        errors.push(
                            `${methodAt}.fields: shares ${shared.join(", ")} with a free method; use one path set or prefill the plugin method`,
                        );
                    }
                }
                if (add.some((one) => requiredPaths(one) === requiredPaths(complete)))
                    errors.push(`${methodAt}.fields: the same required paths as another company method`);
                add.push(complete);
            }
        }
    }
    if (known !== undefined) {
        const ids = new Set(known.map((method) => method.id));
        for (const method of add) {
            if (
                ids.has(method.id) &&
                !known.some((one) => one.id === method.id && requiredPaths(one) === requiredPaths(method))
            )
                errors.push(`${at}.add: ${JSON.stringify(method.id)} is already a plugin method`);
        }
        const names = new Set([...known, ...add].map((method) => method.id));
        if (typeof choice.default === "string" && !names.has(choice.default))
            errors.push(`${at}.default: ${JSON.stringify(choice.default)} is not a method of this section`);
        for (const id of Array.isArray(choice.hide) ? choice.hide : []) {
            if (typeof id === "string" && !names.has(id))
                errors.push(`${at}.hide: ${JSON.stringify(id)} is not a method of this section`);
        }
        if (typeof choice.default === "string" && hidden.has(choice.default))
            errors.push(`${at}.default: ${JSON.stringify(choice.default)} cannot also be hidden`);
        const paths = new Map<string, string>();
        for (const method of [...known, ...add]) {
            const set = requiredPaths(method);
            const other = paths.get(set);
            if (other !== undefined && other !== method.id)
                errors.push(`${at}: ${JSON.stringify(method.id)} has the same required paths as ${other}`);
            else paths.set(set, method.id);
        }
    }
    return add.length === 0 ? (choice as OnboardingMethodChoice) : ({ ...choice, add } as OnboardingMethodChoice);
}
