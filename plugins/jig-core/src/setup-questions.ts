// A plugin's own setup questions: the `setup` option of `registerSection`, checked once when the section is registered,
// then read by setup (to ask) and by the doctor (to say a section is not set up). A plugin's items use the company list's
// kinds, except `proposal`: a proposal names a value a company already knows, and a plugin asks for its own maps with
// `entry`, and one named object of a map with `object`. This file also merges a company's items with a plugin's, one
// field per path, and builds the questions.
import type {
    OnboardingEntry,
    OnboardingItem,
    OnboardingObjectField,
    OnboardingSetup,
    OnboardingStore,
} from "./contract-onboarding.ts";
import { checkOnboarding, onboardingItemAt } from "./onboarding.ts";
import { oneLine } from "./onboarding-common.ts";
import type { SetupField, SetupObjectField, SetupReferenceChoice, SetupState } from "./setup-plan.ts";
import { getPath, isObject, safePath } from "./setup-values.ts";
import { layered, removedAt, removedPaths } from "./section-defaults.ts";
import { optionalQuestion, referenceQuestion } from "./setup-fields.ts";
import { referenceChoice } from "./setup-reference.ts";

const SUMMARY_MAX = 160;
const DOC_MAX = 300;
const EXAMPLE_MAX = 2_000;
const MAX_ITEMS = 64;

function fail(section: string, message: string): never {
    throw new TypeError(`registerSection(${section}): setup.${message}`);
}

/** Throws a `TypeError` naming the field when a plugin's `setup` is not one setup can follow. */
export function checkSetup(section: string, raw: unknown): OnboardingSetup {
    if (!isObject(raw)) fail(section, "must be an object with a summary");
    const keys = ["summary", "items", "pending"];
    for (const key of Object.keys(raw)) {
        if (!keys.includes(key)) fail(section, `${key}: unknown field`);
    }
    const summary = raw.summary;
    if (!oneLine(summary, SUMMARY_MAX))
        fail(section, `summary: one line of at most ${SUMMARY_MAX} characters is needed`);
    let items: readonly OnboardingItem[] | undefined;
    if (raw.items !== undefined) {
        if (!Array.isArray(raw.items) || raw.items.length === 0 || raw.items.length > MAX_ITEMS) {
            fail(section, `items: a list of one to ${MAX_ITEMS} questions`);
        }
        let checked: OnboardingEntry;
        try {
            checked = checkOnboarding({ items: raw.items });
        } catch (error) {
            throw new TypeError(`registerSection(${section}): setup.items: ${(error as Error).message}`);
        }
        for (const [index, item] of checked.items.entries()) {
            const at = `items[${index}]`;
            if (item.kind === "proposal") {
                fail(section, `${at}: a plugin cannot propose an entry; ask for it with an "entry" item`);
            }
            if (item.kind === "info" || item.kind === "login") continue;
            // An object may name the section itself as its map, with an empty path.
            if (!(item.kind === "object" && item.path === "") && !safePath(item.path)) {
                fail(section, `${at}.path: a dotted path of plain names setup can write, such as bastion.user`);
            }
            if (item.section !== section) {
                fail(
                    section,
                    `${at}.section: must be ${JSON.stringify(section)}, the section this plugin registered, not ${JSON.stringify(item.section)}`,
                );
            }
            if (item.kind === "reference" && item.preferredStore !== undefined) {
                fail(section, `${at}.preferredStore: a plugin does not choose the person's secret store`);
            }
        }
        items = checked.items;
    }
    let pending: OnboardingSetup["pending"];
    if (raw.pending !== undefined) {
        if (items !== undefined) fail(section, "pending: a plugin with items cannot also be waiting for them");
        const value = raw.pending;
        if (!isObject(value)) fail(section, "pending: must be an object with doc and example");
        for (const key of Object.keys(value)) {
            if (key !== "doc" && key !== "example") fail(section, `pending.${key}: unknown field`);
        }
        if (!oneLine(value.doc, DOC_MAX)) fail(section, `pending.doc: one line of a page in the Jig package is needed`);
        if (!isObject(value.example)) fail(section, "pending.example: must be an object, a section to add by hand");
        let encoded = "";
        try {
            encoded = JSON.stringify(value.example) ?? "";
        } catch {
            fail(section, "pending.example: must be plain JSON");
        }
        if (encoded === "" || encoded.length > EXAMPLE_MAX) {
            fail(section, `pending.example: at most ${EXAMPLE_MAX} characters of JSON`);
        }
        pending = { doc: value.doc, example: value.example };
    }
    return {
        summary,
        ...(items === undefined ? {} : { items }),
        ...(pending === undefined ? {} : { pending }),
    };
}

/** One question of a section, and the company's entry it came from (so its preferred store and words apply). */
export interface QuestionItem {
    item: Exclude<OnboardingItem, { kind: "info" } | { kind: "login" } | { kind: "proposal" }>;
    /** The company's entry-level preferred store; only the company's own items may use it. */
    preferredStore?: OnboardingStore;
    order: number;
}

/** The item that asks for one field: the company's first, then the plugin's. */
export function itemAt(state: SetupState, section: string, path: string): OnboardingItem | undefined {
    const company = onboardingItemAt(state.onboarding, section, path);
    if (company !== undefined) return company;
    for (const item of state.sectionSetup?.get(section)?.items ?? []) {
        if (item.kind === "info" || item.kind === "login" || item.kind === "proposal") continue;
        if (item.section === section && item.path === path) return item;
    }
    return undefined;
}

/** The answer items of one section: the company's first, in its order, then the plugin's for paths it did not name. */
export function questionItems(
    entry: OnboardingEntry | undefined,
    questions: readonly OnboardingItem[] | undefined,
    section: string,
): QuestionItem[] {
    const out: QuestionItem[] = [];
    const named = new Set<string>();
    for (const item of entry?.items ?? []) {
        if (item.kind === "info" || item.kind === "login" || item.kind === "proposal") continue;
        if (item.section !== section) continue;
        named.add(item.path);
        out.push({
            item,
            ...(entry?.preferredStore === undefined ? {} : { preferredStore: entry.preferredStore }),
            order: out.length,
        });
    }
    for (const item of questions ?? []) {
        if (item.kind === "info" || item.kind === "login" || item.kind === "proposal") continue;
        if (item.section !== section) continue;
        if (named.has(item.path)) continue;
        out.push({ item, order: out.length });
    }
    return out;
}

/** Whether a question names this path or one above or below it: such a field is asked by the question, never as text.
 *  An object asks for the map itself and one new name at a time, so it never stands for the paths below it: an existing
 *  object's own fields are still repaired by the validator's question. */
export function coversPath(items: readonly QuestionItem[], path: string): boolean {
    return items.some(
        ({ item }) =>
            item.kind !== "object" &&
            (item.path === path || item.path.startsWith(`${path}.`) || path.startsWith(`${item.path}.`)),
    );
}

/** The question that asks for exactly this path, so a validator's field can use its words. */
export function itemAtPath(items: readonly QuestionItem[], path: string): QuestionItem | undefined {
    return items.find(({ item }) => item.path === path);
}

/** A validator's field for a path a question also names: the field keeps the validator's kind and secret
 *  classification, and the question gives it the company's or plugin's words. A value that is there but wrong is
 *  therefore asked again in the same words; an answer the question says is a credential is still asked as where it is
 *  kept, never as a value. */
export function withItemWords(state: SetupState, field: SetupField, item: QuestionItem): SetupField {
    const value = item.item;
    const reason = value.why ?? field.reason;
    // An entry and an object ask for a map itself; a validator field for that path is not given their words.
    if (value.kind === "entry" || value.kind === "object") return field;
    const credential = value.kind === "reference";
    if (field.kind !== "reference" && !credential) {
        if (value.kind === "pick") {
            return {
                ...field,
                label: value.label,
                question: value.label,
                kind: "pick",
                choices: [...value.choices],
                placeholder: undefined,
                reason,
            };
        }
        const placeholder = value.placeholder ?? (field.kind === "text" ? field.placeholder : undefined);
        return {
            ...field,
            label: value.label,
            question: value.label,
            ...(placeholder === undefined ? {} : { placeholder }),
            ...(value.list === true ? { list: true as const } : {}),
            reason,
        };
    }
    const reference =
        field.reference ??
        referenceChoice(state, field.current, getPath(state.defaults.get(field.section), field.path));
    offerStores(reference, credential ? value : undefined, item.preferredStore);
    return {
        ...field,
        label: value.label,
        question: referenceQuestion(value.label),
        kind: "reference",
        reference,
        reason,
    };
}

/** Narrows a credential choice to the stores the question offers, with the company's or the item's place first. */
function offerStores(
    reference: SetupReferenceChoice,
    value:
        | {
              stores?: readonly OnboardingStore[];
              preferredStore?: OnboardingStore;
              suggested?: Readonly<Partial<Record<OnboardingStore, string>>>;
              addHints?: Readonly<Partial<Record<OnboardingStore, string>>>;
              fileExpected?: boolean;
          }
        | undefined,
    entryPreferred?: OnboardingStore,
): void {
    if (value?.stores !== undefined) {
        reference.stores = value.stores.filter((store) => reference.stores.includes(store));
    }
    // The program that makes the credential writes it to a file: the file comes first, and a company's own choice still
    // goes before it.
    if (value?.fileExpected === true && reference.stores.includes("file")) {
        reference.fileExpected = true;
        reference.stores = ["file", ...reference.stores.filter((store) => store !== "file")];
    }
    const preferred = value?.preferredStore ?? entryPreferred;
    if (preferred !== undefined && reference.stores.includes(preferred)) {
        reference.preferred = preferred;
        reference.stores = [preferred, ...reference.stores.filter((store) => store !== preferred)];
    }
    if (value?.suggested !== undefined) reference.suggested = value.suggested;
    if (value?.addHints !== undefined) reference.addHints = value.addHints;
}

/** The merged section value: the company's defaults under the person's own. */
export function mergedSection(state: SetupState, section: string, raw: Record<string, unknown>): unknown {
    const rawSection = isObject(raw[section]) ? raw[section] : {};
    return layered(
        state.defaults.get(section),
        rawSection,
        state.replace.get(section) ?? [],
        state.oneOf.get(section) ?? [],
        state.union.get(section) ?? [],
    );
}

/** Whether the question's answer is already there, so setup does not ask again: set, or left out with a `null`. */
export function answerPresent(
    state: SetupState,
    section: string,
    item: QuestionItem,
    raw: Record<string, unknown>,
): boolean {
    const rawSection = isObject(raw[section]) ? raw[section] : {};
    const removed = removedPaths(state.defaults.get(section), rawSection);
    if (removedAt(removed, item.item.path) !== undefined) return true;
    const value = getPath(mergedSection(state, section, raw), item.item.path);
    // An entry or an object asks for one more of a map: an empty map is missing, a full one is not asked for again.
    if (item.item.kind === "entry" || item.item.kind === "object")
        return isObject(value) && Object.keys(value).length > 0;
    return value !== undefined;
}

/** The plain question for one item whose answer is not set yet. */
export function questionField(state: SetupState, item: QuestionItem): SetupField {
    const value = item.item;
    const reason = value.why ?? "The plugin's list says this is needed.";
    if (value.kind === "reference") {
        const reference = referenceChoice(state, undefined, undefined);
        offerStores(reference, value, item.preferredStore);
        return {
            section: value.section,
            path: value.path,
            label: value.label,
            question: referenceQuestion(value.label),
            kind: "reference",
            reason,
            reference,
        };
    }
    if (value.kind === "pick") {
        return {
            section: value.section,
            path: value.path,
            label: value.label,
            question: value.label,
            kind: "pick",
            choices: [...value.choices],
            reason,
        };
    }
    if (value.kind === "entry") {
        return {
            section: value.section,
            path: value.path,
            label: value.label,
            question: value.label,
            kind: "entry",
            reason,
            ...(value.optional === true ? { optional: true as const } : {}),
            entry: {
                keyLabel: value.keyLabel,
                ...(value.keyPlaceholder === undefined ? {} : { keyPlaceholder: value.keyPlaceholder }),
                valueLabel: value.valueLabel,
                ...(value.valuePlaceholder === undefined ? {} : { valuePlaceholder: value.valuePlaceholder }),
                ...(value.detect === undefined ? {} : { detect: value.detect }),
                ...(value.repeat === true ? { repeat: true } : {}),
            },
        };
    }
    if (value.kind === "object") {
        return {
            section: value.section,
            path: value.path,
            label: value.label,
            question: value.label,
            kind: "object",
            reason,
            ...(value.optional === true ? { optional: true as const } : {}),
            object: {
                keyLabel: value.keyLabel,
                ...(value.keyPlaceholder === undefined ? {} : { keyPlaceholder: value.keyPlaceholder }),
                forms: value.forms.map((form) => ({
                    ...(form.label === undefined ? {} : { label: form.label }),
                    ...(form.who === undefined ? {} : { who: form.who }),
                    ...(form.when === undefined ? {} : { when: { ...form.when } }),
                    ...(form.fixed === undefined ? {} : { fixed: { ...form.fixed } }),
                    fields: form.fields.map((field) => objectField(state, field, item.preferredStore)),
                })),
                ...(value.repeat === true ? { repeat: true } : {}),
            },
        };
    }
    return {
        section: value.section,
        path: value.path,
        label: value.label,
        question: value.optional === true ? optionalQuestion(value.label, value.placeholder) : value.label,
        ...(value.placeholder === undefined ? {} : { placeholder: value.placeholder }),
        kind: "text",
        ...(value.optional === true ? { optional: true as const } : {}),
        ...(value.list === true ? { list: true as const } : {}),
        reason,
    };
}

/** One question inside a new object, with the words this section's list gave it (a company's preferred store included). */
function objectField(
    state: SetupState,
    field: OnboardingObjectField,
    preferredStore: OnboardingStore | undefined,
): SetupObjectField {
    const reason = field.why ?? "The plugin's list says this field is needed.";
    if (field.kind === "reference") {
        const reference = referenceChoice(state, undefined, undefined);
        offerStores(reference, field, preferredStore);
        return {
            path: field.path,
            label: field.label,
            question: referenceQuestion(field.label),
            kind: "reference",
            reason: field.why ?? "Jig reads the value from there when a tool needs it.",
            reference,
        };
    }
    if (field.kind === "pick") {
        return {
            path: field.path,
            label: field.label,
            question: field.label,
            kind: "pick",
            choices: [...field.choices],
            reason,
        };
    }
    return {
        path: field.path,
        label: field.label,
        question: field.optional === true ? optionalQuestion(field.label, field.placeholder) : field.label,
        kind: "text",
        ...(field.placeholder === undefined ? {} : { placeholder: field.placeholder }),
        ...(field.optional === true ? { optional: true as const } : {}),
        ...(field.list === true ? { list: true as const } : {}),
        reason,
    };
}

/** The fields of one section's questions whose answers are not set yet. `requested` asks an entry or an object item even
 *  when its map has entries: the person named the section to add one. A path in `asked` already has the validator's
 *  field. */
export function questionFields(
    state: SetupState,
    items: readonly QuestionItem[],
    raw: Record<string, unknown>,
    requested = false,
    asked: ReadonlySet<string> = new Set(),
): SetupField[] {
    const out: SetupField[] = [];
    for (const item of items) {
        if (asked.has(item.item.path)) continue;
        const present = answerPresent(state, item.item.section, item, raw);
        const again = requested && (item.item.kind === "entry" || item.item.kind === "object");
        if (present && !again) continue;
        out.push(questionField(state, item));
    }
    return out;
}

/** The information and logins of the lists of the sections that are being set up, the company's first. */
export function introOf(entry: OnboardingEntry | undefined, lists: readonly (readonly OnboardingItem[])[]): string[] {
    const out: string[] = [];
    for (const item of entry?.items ?? []) {
        if (item.kind === "info") out.push([item.label, item.detail, item.url].filter(Boolean).join(" — "));
    }
    for (const list of lists) {
        for (const item of list) {
            if (item.kind === "info") out.push([item.label, item.detail, item.url].filter(Boolean).join(" — "));
        }
    }
    return out;
}

/** The logins the lists name, each once, with the program to have and the command that performs it. */
export function loginsOf(
    entry: OnboardingEntry | undefined,
    lists: readonly (readonly OnboardingItem[])[],
): Array<{ label: string; tool: string; command: string; why?: string }> {
    const out: Array<{ label: string; tool: string; command: string; why?: string }> = [];
    for (const item of [...(entry?.items ?? []), ...lists.flat()]) {
        if (item.kind !== "login") continue;
        if (out.some((one) => one.command === item.login)) continue;
        out.push({
            label: item.label,
            tool: item.tool,
            command: item.login,
            ...(item.why === undefined ? {} : { why: item.why }),
        });
    }
    return out;
}

/** A method's field paths, for dropping a validator field a method already asks for. */
export function methodPaths(methods: readonly { fields: readonly { path: string }[] }[] | undefined): string[] {
    return (methods ?? []).flatMap((method) => method.fields.map((field) => field.path));
}
