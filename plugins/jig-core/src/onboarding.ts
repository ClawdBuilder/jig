// A company's onboarding list: what its people must supply, in the company's order and words. It is data, checked once when
// the plugin registers, never code: setup and doctor read it and ask or report. A plugin without a list is fine — setup falls
// back to the section validators, which is less pretty but never blocked.
import { checkDetect } from "./detect.ts";
import { checkMethodChoice, checkOnboardingMethods } from "./onboarding-method-check.ts";
import { checkObjectForms } from "./onboarding-object-check.ts";
import { checkProposal } from "./setup-proposal.ts";
import type {
    OnboardingEntry,
    OnboardingItem,
    OnboardingMethod,
    OnboardingMethodChoice,
    OnboardingStore,
} from "./contract-onboarding.ts";
import {
    DETAIL_MAX,
    LABEL_MAX,
    ONBOARDING_STORES,
    PATH,
    SECTION,
    WHY_MAX,
    oneLine,
    optionalLine,
} from "./onboarding-common.ts";

export { ONBOARDING_STORES };
export { checkOnboardingMethods };

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
        if (check("text", [...shared, "placeholder", "optional", "list", "detect"])) {
            if (!SECTION.test(String(item.section))) errors.push(`${at}.section: the section's name`);
            if (!PATH.test(String(item.path)))
                errors.push(`${at}.path: a dotted path inside the section, such as bastion.user`);
            if (!oneLine(item.label, LABEL_MAX)) errors.push(`${at}.label: needed, one line`);
            optionalLine(item.why, `${at}.why`, WHY_MAX, errors);
            optionalLine(item.placeholder, `${at}.placeholder`, LABEL_MAX, errors);
            if (item.optional !== undefined && typeof item.optional !== "boolean")
                errors.push(`${at}.optional: true or false`);
            if (item.list !== undefined && typeof item.list !== "boolean") errors.push(`${at}.list: true or false`);
            checkDetect(item, at, errors);
            items.push(item as unknown as OnboardingItem);
            continue;
        }
        if (check("pick", [...shared, "choices", "detect"])) {
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
            checkDetect(item, at, errors);
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
        if (
            check("entry", [
                ...shared,
                "keyLabel",
                "keyPlaceholder",
                "valueLabel",
                "valuePlaceholder",
                "detect",
                "repeat",
                "optional",
            ])
        ) {
            if (!SECTION.test(String(item.section))) errors.push(`${at}.section: the section's name`);
            if (!PATH.test(String(item.path))) errors.push(`${at}.path: the section's map, such as accounts`);
            if (!oneLine(item.label, LABEL_MAX)) errors.push(`${at}.label: needed, one line`);
            optionalLine(item.why, `${at}.why`, WHY_MAX, errors);
            if (!oneLine(item.keyLabel, LABEL_MAX)) errors.push(`${at}.keyLabel: needed, one line`);
            if (!oneLine(item.valueLabel, LABEL_MAX)) errors.push(`${at}.valueLabel: needed, one line`);
            optionalLine(item.keyPlaceholder, `${at}.keyPlaceholder`, LABEL_MAX, errors);
            optionalLine(item.valuePlaceholder, `${at}.valuePlaceholder`, LABEL_MAX, errors);
            for (const name of ["repeat", "optional"] as const) {
                if (item[name] !== undefined && typeof item[name] !== "boolean")
                    errors.push(`${at}.${name}: true or false`);
            }
            checkDetect(item, at, errors);
            items.push(item as unknown as OnboardingItem);
            continue;
        }
        if (check("object", [...shared, "keyLabel", "keyPlaceholder", "forms", "repeat"])) {
            if (!SECTION.test(String(item.section))) errors.push(`${at}.section: the section's name`);
            if (!PATH.test(String(item.path))) errors.push(`${at}.path: the section's map, such as connections`);
            if (!oneLine(item.label, LABEL_MAX)) errors.push(`${at}.label: needed, one line`);
            optionalLine(item.why, `${at}.why`, WHY_MAX, errors);
            if (!oneLine(item.keyLabel, LABEL_MAX)) errors.push(`${at}.keyLabel: needed, one line`);
            optionalLine(item.keyPlaceholder, `${at}.keyPlaceholder`, LABEL_MAX, errors);
            if (item.repeat !== undefined && typeof item.repeat !== "boolean")
                errors.push(`${at}.repeat: true or false`);
            checkObjectForms(item.forms, `${at}.forms`, errors);
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
        if (check("proposal", ["section", "path", "key", "value", "label", "why"])) {
            checkProposal(item, at, errors);
            items.push(item as unknown as OnboardingItem);
            continue;
        }
        errors.push(`${at}.kind: must be text, pick, reference, entry, object, proposal, login or info`);
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
