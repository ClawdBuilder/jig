// A company's onboarding list: what its people must supply, in the company's order and words. It is data, checked once when
// the plugin registers, never code: setup and doctor read it and ask or report. A plugin without a list is fine — setup falls
// back to the section validators, which is less pretty but never blocked.
import type {
    OnboardingEntry,
    OnboardingItem,
    OnboardingMethod,
    OnboardingMethodChoice,
    OnboardingMethodField,
    OnboardingStore,
} from "./contract.ts";

/** The stores a list may name, in `jig.json`'s spelling. */
export const ONBOARDING_STORES: readonly OnboardingStore[] = ["pass", "env", "keychain", "op", "cmd", "file"];

const SECTION = /^[A-Za-z][A-Za-z0-9_-]*$/;
const PATH = /^[A-Za-z0-9_][A-Za-z0-9_-]*(\.[A-Za-z0-9_][A-Za-z0-9_-]*)*$/;
const METHOD_ID = /^[a-z][a-z0-9-]{0,63}$/;
const METHOD_PATH = /^(?:[A-Za-z0-9_*][A-Za-z0-9_*-]*)(?:\.[A-Za-z0-9_*][A-Za-z0-9_*-]*)*$/;
const LABEL_MAX = 120;
const WHY_MAX = 400;
const DETAIL_MAX = 600;

function oneLine(value: unknown, max: number): value is string {
    return (
        typeof value === "string" && value.trim() !== "" && value.length <= max && !/[\u0000-\u001f\u007f]/.test(value)
    );
}

function optionalLine(value: unknown, at: string, max: number, errors: string[]): void {
    if (value !== undefined && !oneLine(value, max))
        errors.push(`${at}: must be one line of at most ${max} characters`);
}

/** The required paths of a method. Kinds and optional fields do not decide the method; the set of paths does.
 *  A subset is allowed: `{ auth.token }` is Jira Data Center, `{ auth.email, auth.token }` is Jira Cloud. A value is
 *  matched to the most specific method (largest path set); only two exact sets are ambiguous. */
function methodPaths(method: OnboardingMethod): string {
    return method.fields
        .filter((field) => field.kind === "reference" || (field.kind === "text" && field.optional !== true))
        .map((field) => field.path)
        .sort()
        .join("|");
}

function methodFieldPaths(method: OnboardingMethod): Set<string> {
    return new Set(method.fields.map((field) => field.path));
}

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
        if (!allowed.includes(key)) errors.push(`${at}.${key}: unknown field for ${kind}`);
    }
    if (!METHOD_PATH.test(String(field.path))) errors.push(`${at}.path: a dotted path inside the section`);
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
    if (!SECTION.test(section))
        throw new TypeError(`onboarding.registerMethods: ${JSON.stringify(section)} is not a section`);
    if (!Array.isArray(raw) || raw.length === 0) {
        throw new TypeError(`onboarding.registerMethods(${section}): methods must be a non-empty list`);
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
        for (const key of Object.keys(method)) {
            if (!["id", "label", "who", "fields"].includes(key)) errors.push(`${at}.${key}: unknown field`);
        }
        if (typeof method.id !== "string" || !METHOD_ID.test(method.id)) errors.push(`${at}.id: a lower-case id`);
        else if (ids.has(method.id)) errors.push(`${at}.id: ${JSON.stringify(method.id)} is used twice`);
        else ids.add(method.id);
        if (!oneLine(method.label, LABEL_MAX)) errors.push(`${at}.label: needed, one line`);
        optionalLine(method.who, `${at}.who`, LABEL_MAX, errors);
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
            fields,
        };
        const paths = methodPaths(complete as OnboardingMethod);
        const other = shapes.get(paths);
        if (other !== undefined)
            errors.push(`${at}.fields: the same required paths as ${other}; the method could not be inferred`);
        else shapes.set(paths, String(method.id));
        methods.push(complete as OnboardingMethod);
    }
    if (errors.length > 0) throw new TypeError(`onboarding.registerMethods(${section}): ${errors.join("; ")}`);
    return methods;
}

/** The company's overlay on a section's methods, checked against the ids the plugin registered. */
function checkMethodChoice(
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
        if (!["default", "hide", "add"].includes(key)) errors.push(`${at}.${key}: unknown field`);
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
                const same = known?.find((one) => methodPaths(one) === methodPaths(complete));
                if (same !== undefined) {
                    if (same.id !== complete.id) {
                        errors.push(
                            `${methodAt}.id: use ${JSON.stringify(same.id)} to prefill this method's value, not a new method`,
                        );
                    }
                    // A matching path set with the plugin's id is a default value for that method, kept in `add`
                    // so the plan can prefill it without writing an id.
                    continue;
                }
                if (known !== undefined) {
                    const shared = [...methodFieldPaths(complete)].filter((path) =>
                        known.some((one) => methodFieldPaths(one).has(path)),
                    );
                    if (shared.length > 0) {
                        errors.push(
                            `${methodAt}.fields: shares ${shared.join(", ")} with a free method; use one path set or prefill the plugin method`,
                        );
                    }
                }
                if (add.some((one) => methodPaths(one) === methodPaths(complete)))
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
                !known.some((one) => one.id === method.id && methodPaths(one) === methodPaths(method))
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
            const set = methodPaths(method);
            const other = paths.get(set);
            if (other !== undefined && other !== method.id)
                errors.push(`${at}: ${JSON.stringify(method.id)} has the same required paths as ${other}`);
            else paths.set(set, method.id);
        }
    }
    return add.length === 0 ? (choice as OnboardingMethodChoice) : ({ ...choice, add } as OnboardingMethodChoice);
}

/** Throws a `TypeError` naming the item and field when the list is not one setup can follow. */
export function checkOnboarding(
    raw: unknown,
    knownMethods: ReadonlyMap<string, readonly OnboardingMethod[]> = new Map(),
): OnboardingEntry {
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
        throw new TypeError("onboarding.register: the entry must be an object with items");
    }
    const entry = raw as Record<string, unknown>;
    for (const key of Object.keys(entry)) {
        if (key !== "preferredStore" && key !== "items" && key !== "methods") {
            throw new TypeError(`onboarding.register: unknown field ${JSON.stringify(key)}`);
        }
    }
    const errors: string[] = [];
    if (entry.preferredStore !== undefined && !ONBOARDING_STORES.includes(entry.preferredStore as OnboardingStore)) {
        errors.push(`preferredStore: must be one of ${ONBOARDING_STORES.join(", ")}`);
    }
    if (entry.items !== undefined && !Array.isArray(entry.items)) {
        throw new TypeError("onboarding.register: items must be a list");
    }
    const items: OnboardingItem[] = [];
    for (const [index, rawItem] of (entry.items ?? []).entries()) {
        const at = `items[${index}]`;
        if (typeof rawItem !== "object" || rawItem === null || Array.isArray(rawItem)) {
            errors.push(`${at}: must be an object`);
            continue;
        }
        const item = rawItem as Record<string, unknown>;
        const check = (kind: string, fields: readonly string[]): boolean => {
            if (item.kind !== kind) return false;
            for (const field of Object.keys(item)) {
                if (field !== "kind" && !fields.includes(field))
                    errors.push(`${at}.${field}: unknown field for ${kind}`);
            }
            return true;
        };
        if (check("info", ["label", "detail", "url"])) {
            if (!oneLine(item.label, LABEL_MAX)) errors.push(`${at}.label: needed, one line`);
            optionalLine(item.detail, `${at}.detail`, DETAIL_MAX, errors);
            optionalLine(item.url, `${at}.url`, 500, errors);
            items.push(item as unknown as OnboardingItem);
            continue;
        }
        const shared = ["section", "path", "label", "why"];
        if (check("text", [...shared, "placeholder", "optional"])) {
            if (!SECTION.test(String(item.section))) errors.push(`${at}.section: the section's name`);
            if (!PATH.test(String(item.path)))
                errors.push(`${at}.path: a dotted path inside the section, such as bastion.user`);
            if (!oneLine(item.label, LABEL_MAX)) errors.push(`${at}.label: needed, one line`);
            optionalLine(item.why, `${at}.why`, WHY_MAX, errors);
            optionalLine(item.placeholder, `${at}.placeholder`, LABEL_MAX, errors);
            if (item.optional !== undefined && typeof item.optional !== "boolean")
                errors.push(`${at}.optional: true or false`);
            items.push(item as unknown as OnboardingItem);
            continue;
        }
        if (check("pick", [...shared, "choices"])) {
            if (!SECTION.test(String(item.section))) errors.push(`${at}.section: the section's name`);
            if (!PATH.test(String(item.path)))
                errors.push(`${at}.path: a dotted path inside the section, such as bastion.user`);
            if (!oneLine(item.label, LABEL_MAX)) errors.push(`${at}.label: needed, one line`);
            optionalLine(item.why, `${at}.why`, WHY_MAX, errors);
            if (!Array.isArray(item.choices) || item.choices.length === 0 || item.choices.length > 100) {
                errors.push(`${at}.choices: a list of one to 100 choices`);
            } else {
                for (const [choice, value] of item.choices.entries()) {
                    if (!oneLine(value, LABEL_MAX)) errors.push(`${at}.choices[${choice}]: one line`);
                }
            }
            items.push(item as unknown as OnboardingItem);
            continue;
        }
        if (check("reference", [...shared, "stores", "preferredStore", "suggested", "addHints"])) {
            if (!SECTION.test(String(item.section))) errors.push(`${at}.section: the section's name`);
            if (!PATH.test(String(item.path)))
                errors.push(`${at}.path: a dotted path inside the section, such as sso.token`);
            if (!oneLine(item.label, LABEL_MAX)) errors.push(`${at}.label: needed, one line`);
            optionalLine(item.why, `${at}.why`, WHY_MAX, errors);
            if (item.stores !== undefined) {
                if (!Array.isArray(item.stores) || item.stores.length === 0) {
                    errors.push(`${at}.stores: a list of the stores to offer`);
                } else {
                    for (const store of item.stores) {
                        if (!ONBOARDING_STORES.includes(store as OnboardingStore)) {
                            errors.push(`${at}.stores: ${JSON.stringify(store)} is not a store Jig knows`);
                        }
                    }
                }
            }
            for (const [field, value] of [
                ["suggested", item.suggested],
                ["addHints", item.addHints],
            ] as const) {
                if (value === undefined) continue;
                if (typeof value !== "object" || value === null || Array.isArray(value)) {
                    errors.push(`${at}.${field}: must be an object keyed by store`);
                    continue;
                }
                for (const store of Object.keys(value)) {
                    if (!ONBOARDING_STORES.includes(store as OnboardingStore)) {
                        errors.push(`${at}.${field}: ${JSON.stringify(store)} is not a store Jig knows`);
                    }
                }
            }
            if (
                item.preferredStore !== undefined &&
                !ONBOARDING_STORES.includes(item.preferredStore as OnboardingStore)
            ) {
                errors.push(`${at}.preferredStore: must be one of ${ONBOARDING_STORES.join(", ")}`);
            }
            items.push(item as unknown as OnboardingItem);
            continue;
        }
        if (check("login", ["tool", "status", "login", "label", "why"])) {
            if (!oneLine(item.tool, 60)) errors.push(`${at}.tool: needed, a program name`);
            if (
                !Array.isArray(item.status) ||
                item.status.length === 0 ||
                item.status.length > 20 ||
                item.status.some((part) => typeof part !== "string" || part.length > 200)
            ) {
                errors.push(`${at}.status: the command that checks the login, as a list of arguments`);
            }
            if (!oneLine(item.login, 200)) errors.push(`${at}.login: needed, the command that logs in`);
            if (!oneLine(item.label, LABEL_MAX)) errors.push(`${at}.label: needed, one line`);
            optionalLine(item.why, `${at}.why`, WHY_MAX, errors);
            items.push(item as unknown as OnboardingItem);
            continue;
        }
        errors.push(`${at}.kind: must be text, pick, reference, login or info`);
    }
    const methods: Record<string, OnboardingMethodChoice> = {};
    if (entry.methods !== undefined) {
        if (typeof entry.methods !== "object" || entry.methods === null || Array.isArray(entry.methods)) {
            errors.push("methods: must be an object keyed by section");
        } else {
            for (const [section, value] of Object.entries(entry.methods)) {
                if (!SECTION.test(section)) {
                    errors.push(`methods.${section}: not a section name`);
                    continue;
                }
                const checked = checkMethodChoice(value, `methods.${section}`, knownMethods.get(section), errors);
                if (checked !== undefined) methods[section] = checked;
            }
        }
    }
    if (errors.length > 0) {
        throw new TypeError(`onboarding.register: ${errors.join("; ")}`);
    }
    return {
        ...(entry.preferredStore === undefined ? {} : { preferredStore: entry.preferredStore as OnboardingStore }),
        items,
        ...(Object.keys(methods).length === 0 ? {} : { methods }),
    };
}

/** The item for one field, by section and dotted path, or undefined when the company did not name it. */
export function onboardingItemAt(
    entry: OnboardingEntry | undefined,
    section: string,
    path: string,
): OnboardingItem | undefined {
    for (const item of entry?.items ?? []) {
        if (item.kind === "info" || item.kind === "login") continue;
        if (item.section === section && item.path === path) return item;
    }
    return undefined;
}

/** The order a company gave its sections by: the first item's position for each section. */
export function onboardingOrder(entry: OnboardingEntry | undefined): Map<string, number> {
    const order = new Map<string, number>();
    let at = 0;
    for (const item of entry?.items ?? []) {
        if (item.kind === "info" || item.kind === "login") continue;
        at++;
        if (!order.has(item.section)) order.set(item.section, at);
    }
    return order;
}
