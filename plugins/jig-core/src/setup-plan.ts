// What `/jig setup` still needs, from the states `/jig` already knows, the plugin validators and the company defaults.
//
// It reads the person's file once, works out which fields a validator names and asks about one field at a time. A
// credential is asked for as WHERE it is kept, never as a value. Nothing here writes or talks to Pi.
import { lstatSync, readFileSync, readlinkSync, realpathSync, statSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import type { LoadedConfig, SecretBackend, SectionCheck } from "./config.ts";
import type { OnboardingEntry, OnboardingItem, OnboardingMethod } from "./contract.ts";
import { inferredMethod } from "./onboarding.ts";
import { onboardingItemAt, onboardingOrder } from "./onboarding.ts";
import { fieldKind, fieldLabel, isSecret, labelOf, placeholderFor, reasonFor } from "./setup-fields.ts";
import { layered } from "./section-defaults.ts";
import { setValuePath } from "./setup-write.ts";
import { shorten } from "./secret-status.ts";
import { sectionState } from "./section-state.ts";
import { parseSecretReference } from "./secrets.ts";
import { referenceChoice } from "./setup-reference.ts";

/** The part of jig-core the plan reads. `JigState` fits it once the defaults are gathered; a test can build one. */
export interface SetupState {
    personal: LoadedConfig;
    sectionChecks: ReadonlyMap<string, SectionCheck>;
    /** The company's defaults, the active company's on top: the same map `layered()` uses. */
    defaults: ReadonlyMap<string, unknown>;
    replace: ReadonlyMap<string, readonly string[]>;
    oneOf: ReadonlyMap<string, readonly (readonly string[])[]>;
    union: ReadonlyMap<string, readonly string[]>;
    configPath: string;
    /** Pi's environment, for an `env:` choice. */
    env: NodeJS.ProcessEnv;
    platform: NodeJS.Platform;
    /** Finds a program on PATH without starting it, so setup offers only stores this machine has. */
    pathLookup: (program: string, env: NodeJS.ProcessEnv) => string | undefined;
    /** The stores that can resolve a reference now: the user's, a company's, less disabled. */
    enabledBackends: readonly SecretBackend[];
    /** The person's veto list; never written or removed by setup. */
    disabledBackends: readonly SecretBackend[];
    /** The backends a company turned on; its preference is the first of these. */
    companyBackends: readonly SecretBackend[];
    /** The commands a `cmd:` reference may name. */
    commands: Readonly<Record<string, readonly string[]>>;
    /** The active company's onboarding list, when it wrote one: its order, labels and hints. */
    onboarding?: OnboardingEntry;
    /** A section the person asked to change even when it is valid; `jig setup <section>` sets it. */
    requestedSection?: string;
    /** The sign-in methods plugins registered for their sections. */
    onboardingMethods?: ReadonlyMap<string, readonly OnboardingMethod[]>;
}

export type SetupFieldKind = "text" | "number" | "boolean" | "reference" | "pick";

/** One question. `current` is for the placeholder, never a secret and never a raw reference. */
export interface SetupField {
    section: string;
    path: string;
    label: string;
    question: string;
    placeholder?: string;
    kind: SetupFieldKind;
    current?: string | number | boolean;
    reason: string;
    /** For a credential: where the person may keep it, and which choice is the company's. */
    reference?: SetupReferenceChoice;
    /** For a pick: the plain answers, from the company's list. */
    choices?: readonly string[];
    /** A fixed answer, from a company-only method; setup shows it and does not ask. */
    fixed?: string;
}

export interface SetupReferenceChoice {
    /** The stores to offer, the company's choice first. */
    stores: SecretBackend[];
    /** The store marked "(company default)", when the company named one. */
    preferred?: SecretBackend;
    /** The stores that are already on; a choice outside this adds one to `secrets.backends`. */
    enabled: SecretBackend[];
    /** The stores the person turned off; they are not offered, and setup says so. */
    disabled: SecretBackend[];
    commands: Readonly<Record<string, readonly string[]>>;
    /** A reference *shape* per store, from the company's list, never a value. */
    suggested?: Readonly<Partial<Record<SecretBackend, string>>>;
    /** What the company says to do to add it, per store. */
    addHints?: Readonly<Partial<Record<SecretBackend, string>>>;
}

export interface SetupMethod {
    id: string;
    label: string;
    who?: string;
    /** The company's choice, or the first visible method. */
    default: boolean;
    /** The method the section's current values select, by required path set. */
    current?: boolean;
    fields: SetupField[];
    /** Why a wildcard produced no fields, when the plan cannot ask for a name yet. */
    notes?: string[];
}

export interface SetupSection {
    name: string;
    label: string;
    fields: SetupField[];
    /** The sign-in methods this section's plugin declared; setup asks the question before these fields. */
    methods?: SetupMethod[];
    /** Things setup cannot ask for here, such as a credential or a value that is a list. */
    notes: string[];
}

export interface SetupPlan {
    /** The path in the settings, which may be a link. */
    file: string;
    /** The regular file read and written: the link's target, or the same path when it is not a link. */
    target: string;
    /** True when `file` is a link and `target` is where it points. */
    link: boolean;
    exists: boolean;
    before: string;
    mode: number;
    raw: Record<string, unknown>;
    sections: SetupSection[];
    /** File-level notes, when there is nothing to ask but something to say. */
    notes: string[];
    /** What the company says before the questions, from its `info` items. */
    intro: string[];
    /** Logins the company names, and the command that performs each: setup shows it and does not check it. */
    logins: Array<{ label: string; command: string; why?: string }>;
    defaults: ReadonlyMap<string, unknown>;
    checks: ReadonlyMap<string, SectionCheck>;
    replace: ReadonlyMap<string, readonly string[]>;
    oneOf: ReadonlyMap<string, readonly (readonly string[])[]>;
    union: ReadonlyMap<string, readonly string[]>;
}

export type SetupPlanResult = { plan: SetupPlan } | { problem: string };

/** The question for a credential, built from the company's label without doubling its article. */
function referenceQuestion(label: string): string {
    const named = label.replace(/^the\s+/i, "").trim();
    return `Where does the ${named} live?`;
}

/** Adds a field for each onboarding item whose value is not set yet and which the validators did not name. */
function addOnboardingFields(
    entry: OnboardingEntry,
    state: SetupState,
    raw: Record<string, unknown>,
    candidates: Array<{ section: SetupSection; order: number }>,
): void {
    const byName = new Map(candidates.map((candidate) => [candidate.section.name, candidate]));
    for (const [index, item] of entry.items.entries()) {
        if (item.kind === "info" || item.kind === "login") continue;
        if (!state.sectionChecks.has(item.section)) continue;
        if (!safePath(item.path) || !PATH_SHAPE.test(item.path)) continue;
        let candidate = byName.get(item.section);
        if (candidate === undefined) {
            candidate = {
                section: { name: item.section, label: labelOf(item.section), fields: [], notes: [] },
                order: 10_000 + index,
            };
            byName.set(item.section, candidate);
            candidates.push(candidate);
        }
        if (candidate.section.fields.some((field) => field.path === item.path)) continue;
        const rawValue = raw[item.section];
        const rawSection = isObject(rawValue) ? rawValue : {};
        if (!parentIsObject(rawSection, item.path)) continue;
        const defaults = state.defaults.get(item.section);
        const merged = layered(
            defaults,
            rawSection,
            state.replace.get(item.section) ?? [],
            state.oneOf.get(item.section) ?? [],
            state.union.get(item.section) ?? [],
        );
        if (getPath(merged, item.path) !== undefined) continue;
        candidate.section.fields.push(onboardingField(entry, state, item));
    }
}

const PATH_SHAPE = /^[A-Za-z0-9_][A-Za-z0-9_-]*(\.[A-Za-z0-9_][A-Za-z0-9_-]*)*$/;

/** The plain question for one onboarding item whose value is not set. */
function onboardingField(
    entry: OnboardingEntry,
    state: SetupState,
    item: Exclude<OnboardingItem, { kind: "info" } | { kind: "login" }>,
): SetupField {
    const reason = item.why ?? "The company's list says its tools need it.";
    if (item.kind === "reference") {
        const reference = referenceChoice(state, undefined, undefined);
        const preferred = item.preferredStore ?? entry.preferredStore;
        if (preferred !== undefined && reference.stores.includes(preferred)) {
            reference.preferred = preferred;
            reference.stores = [preferred, ...reference.stores.filter((store) => store !== preferred)];
        }
        if (item.suggested !== undefined) reference.suggested = item.suggested;
        if (item.addHints !== undefined) reference.addHints = item.addHints;
        return {
            section: item.section,
            path: item.path,
            label: item.label,
            question: referenceQuestion(item.label),
            kind: "reference",
            reason,
            reference,
        };
    }
    if (item.kind === "pick") {
        return {
            section: item.section,
            path: item.path,
            label: item.label,
            question: item.label,
            kind: "pick",
            choices: [...item.choices],
            reason,
        };
    }
    return {
        section: item.section,
        path: item.path,
        label: item.label,
        question: item.label,
        ...(item.placeholder === undefined ? {} : { placeholder: item.placeholder }),
        kind: "text",
        reason,
    };
}

/** Lays the company's labels, words and hints over the fields the validators named, and orders them by the list. */
function applyOnboarding(entry: OnboardingEntry, candidates: Array<{ section: SetupSection; order: number }>): void {
    const position = new Map<string, number>();
    for (const [index, item] of entry.items.entries()) {
        if (item.kind === "info" || item.kind === "login") continue;
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
            if (item === undefined || item.kind === "info" || item.kind === "login") continue;
            field.label = item.label;
            field.question = item.kind === "reference" ? referenceQuestion(item.label) : item.label;
            if (item.why !== undefined) field.reason = item.why;
            if (item.kind === "text") {
                if (item.placeholder !== undefined) field.placeholder = item.placeholder;
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

/** A change the person accepted: one field, its plain label, and what was there before. */
export interface SetupChange {
    section: string;
    path: string;
    label: string;
    oldValue?: unknown;
    value: unknown;
    /** A plain phrase for a reference's place, such as "pass entry work/jira-token". Never a reference. */
    note?: string;
    /** A store to turn on in `secrets.backends`, when the chosen store is not on yet. */
    enableBackend?: SecretBackend;
}

/** The required paths of a method; kinds and optional fields do not decide the method. */
function requiredPaths(method: OnboardingMethod): string {
    return method.fields
        .filter((field) => field.kind === "reference" || (field.kind === "text" && field.optional !== true))
        .map((field) => field.path)
        .sort()
        .join("|");
}

/** A dynamic name that is safe to put in a dotted path. */
function safeSegment(name: string): boolean {
    return /^[A-Za-z0-9_][A-Za-z0-9_-]*$/.test(name) && !["__proto__", "constructor", "prototype"].includes(name);
}

/** Expands one `*` path segment against the configured objects: `services.*.ci.auth` -> each service name.
 *  Only object parents are expanded; a string mapping and a dotted key are left for a person to name. */
function expandMethodPath(path: string, root: unknown): string[] {
    const dynamic = path.includes("*");
    let paths = [""];
    for (const segment of path.split(".")) {
        if (segment !== "*") {
            paths = paths.map((prefix) => (prefix === "" ? segment : `${prefix}.${segment}`));
            continue;
        }
        const next: string[] = [];
        for (const prefix of paths) {
            const value = prefix === "" ? root : getPath(root, prefix);
            if (!isObject(value)) continue;
            for (const name of Object.keys(value)) {
                if (safeSegment(name)) next.push(prefix === "" ? name : `${prefix}.${name}`);
            }
        }
        paths = next;
    }
    if (!dynamic) return paths;
    return paths.filter((path) => {
        const parent = path.split(".").slice(0, -1).join(".");
        if (isObject(getPath(root, parent))) return true;
        // A CI method may create ci.auth, but only when the service already has ci.
        const ci = path.indexOf(".ci.");
        if (ci === -1) return false;
        return isObject(getPath(root, `${path.slice(0, ci)}.ci`));
    });
}

/** The methods of one section, with the company's hide/default overlay, and each field as a setup question. */
function setupMethods(
    state: SetupState,
    section: string,
    rawSection: Record<string, unknown>,
    merged: unknown,
): SetupMethod[] {
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
    const visible = all.filter((method) => !hidden.has(method.id));
    if (visible.length === 0) return [];
    const chosen = choice?.default ?? visible[0]?.id;
    const current = inferredMethod(visible, merged)?.id;
    return visible.map((method) => {
        const fields: SetupField[] = [];
        const notes: string[] = [];
        const fixed = prefill.get(method.id);
        for (const field of method.fields) {
            const paths = expandMethodPath(field.path, merged);
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
                        ...(current === undefined ? {} : { current }),
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
                        reason: field.why ?? "Jig reads the value from there when a tool needs it.",
                        reference,
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
                        ...(current === undefined ? {} : { current }),
                        reason: field.why ?? "The plugin's list says the choices.",
                    });
                    continue;
                }
                fields.push({
                    section,
                    path,
                    label: field.label,
                    question: field.label,
                    ...(field.placeholder === undefined ? {} : { placeholder: field.placeholder }),
                    ...(current === undefined ? {} : { current }),
                    kind: "text",
                    reason: field.why ?? "The plugin's list says this field is needed.",
                });
            }
        }
        return {
            id: method.id,
            label: method.label,
            ...(method.who === undefined ? {} : { who: method.who }),
            default: method.id === chosen,
            ...(current === undefined ? {} : { current: method.id === current }),
            fields,
            ...(notes.length === 0 ? {} : { notes }),
        };
    });
}

/** The plan: read the file, then ask only about the fields a validator names. */
export function buildSetupPlan(state: SetupState): SetupPlanResult {
    if (state.configPath === "") {
        return { problem: "Pi has not told Jig where its settings are. Restart Pi, then run /jig setup again." };
    }
    let exists = false;
    let before = "";
    let mode = 0o600;
    let target = state.configPath;
    let link = false;
    try {
        const entry = lstatSync(state.configPath);
        if (entry.isSymbolicLink()) {
            link = true;
            try {
                target = realpathSync(state.configPath);
            } catch {
                let written = "";
                try {
                    written = readlinkSync(state.configPath);
                } catch {
                    // The link is there; its text is not readable.
                }
                const shown =
                    written === ""
                        ? "a missing target"
                        : shorten(
                              path.isAbsolute(written)
                                  ? written
                                  : path.resolve(path.dirname(state.configPath), written),
                              homedir(),
                          );
                return {
                    problem: `Your settings file is a link to ${shown}, which does not exist. Fix the link, then run /jig setup again.`,
                };
            }
            const info = statSync(target);
            if (!info.isFile()) {
                return {
                    problem: `Your settings file is a link to ${shorten(target, homedir())}, which is not a file. Setup changes nothing.`,
                };
            }
            exists = true;
            mode = info.mode & 0o777;
            before = readFileSync(target, "utf8");
        } else if (entry.isFile()) {
            exists = true;
            mode = entry.mode & 0o777;
            before = readFileSync(state.configPath, "utf8");
        } else {
            return { problem: "Your Jig settings are not a file. /jig doctor names the problem." };
        }
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
            return { problem: "Your Jig settings could not be read. /jig doctor names the problem." };
        }
    }
    const linkNote = link
        ? `Your settings file is a link to ${shorten(target, homedir())}; that file will be changed.`
        : undefined;

    let raw: unknown = {};
    if (exists) {
        try {
            // A byte-order mark is not part of the JSON, and `config.ts` ignores it too.
            raw = JSON.parse(before.replace(/^\uFEFF/, ""));
        } catch {
            return {
                problem:
                    "Your Jig settings are not valid JSON. /jig doctor names the problem; fix it, then run /jig setup again.",
            };
        }
    }
    if (!isObject(raw)) {
        return { problem: "Your Jig settings are not one object. /jig doctor names the problem." };
    }

    const candidates: Array<{ section: SetupSection; priority: number; order: number }> = [];
    let order = 0;
    for (const name of state.sectionChecks.keys()) {
        order++;
        const section = sectionState(state.personal, name);
        if ((section === "loaded" || section === "not set") && state.requestedSection !== name) continue;
        const priority = section === "company defaults incomplete" ? 0 : 1;
        const messages =
            section === "company defaults incomplete"
                ? [...(state.personal.incomplete.get(name) ?? [])]
                : state.personal.problems.filter((problem) => problem.key === name).map((problem) => problem.message);
        if (messages.length === 0 && state.requestedSection !== name) continue;

        const notes: string[] = [];
        const rawValue = raw[name];
        if (rawValue !== undefined && !isObject(rawValue)) {
            notes.push(`${labelOf(name)} is not in a shape setup can change here. /jig doctor names the problem.`);
            candidates.push({
                section: { name, label: labelOf(name), fields: [], notes },
                priority,
                order,
            });
            continue;
        }
        const rawSection = isObject(rawValue) ? rawValue : {};
        const defaults = state.defaults.get(name);
        const merged = layered(
            defaults,
            rawSection,
            state.replace.get(name) ?? [],
            state.oneOf.get(name) ?? [],
            state.union.get(name) ?? [],
        );
        const paths = new Map<string, string>();
        for (const message of messages) {
            const found = messagePaths(message, name);
            if (found.length === 0) {
                notes.push("This part needs a change that setup cannot ask for here.");
                continue;
            }
            for (const path of found) if (!paths.has(path)) paths.set(path, message);
        }

        const fields: SetupField[] = [];
        for (const [path, message] of paths) {
            if (!safePath(path)) {
                notes.push(`${labelOf(name)} needs a change that setup cannot ask for here.`);
                continue;
            }
            const label = fieldLabel(name, path);
            const last = path.split(".").at(-1) ?? path;
            if (!parentIsObject(rawSection, path)) {
                notes.push(`${label} sits under a value setup cannot change here. /jig doctor names the problem.`);
                continue;
            }
            const current = getPath(merged, path);
            const defaultValue = getPath(defaults, path);
            if (current !== undefined && (typeof current === "object" || Array.isArray(current))) {
                notes.push(`${label} holds more than one value, so setup leaves it for later.`);
                continue;
            }
            if (isSecret(last, current, defaultValue, message)) {
                const reference = referenceChoice(state, current, defaultValue);
                if (reference.stores.length === 0) {
                    notes.push(
                        `${label}: no secret store is available. Turn one on in your settings, then run /jig setup again.`,
                    );
                    continue;
                }
                fields.push({
                    section: name,
                    path,
                    label,
                    question: `Where do you keep the ${label}?`,
                    reason: "Jig reads the value from there when a tool needs it.",
                    kind: "reference",
                    reference,
                });
                continue;
            }
            const kind = fieldKind(current, message, last);
            const placeholder = placeholderFor(kind, current, last);
            fields.push({
                section: name,
                path,
                label,
                question: label,
                ...(placeholder === undefined ? {} : { placeholder }),
                kind,
                ...(isPrimitive(current) ? { current } : {}),
                reason: reasonFor(message),
            });
        }

        const methods = setupMethods(state, name, rawSection, merged);
        if (fields.length > 0 || notes.length > 0 || methods.length > 0) {
            candidates.push({
                section: { name, label: labelOf(name), fields, ...(methods.length === 0 ? {} : { methods }), notes },
                priority,
                order,
            });
        }
    }

    const entry = state.onboarding;
    const intro: string[] = [];
    const logins: Array<{ label: string; command: string; why?: string }> = [];
    if (entry !== undefined) {
        for (const item of entry.items) {
            if (item.kind === "info") {
                intro.push([item.label, item.detail, item.url].filter((part) => part !== undefined).join(" — "));
            } else if (item.kind === "login") {
                logins.push({
                    label: item.label,
                    command: item.login,
                    ...(item.why === undefined ? {} : { why: item.why }),
                });
            }
        }
        addOnboardingFields(entry, state, raw, candidates);
        applyOnboarding(entry, candidates);
        const order = onboardingOrder(entry);
        candidates.sort(
            (left, right) =>
                (order.get(left.section.name) ?? Number.MAX_SAFE_INTEGER) -
                    (order.get(right.section.name) ?? Number.MAX_SAFE_INTEGER) ||
                left.priority - right.priority ||
                left.order - right.order,
        );
    } else {
        candidates.sort((left, right) => left.priority - right.priority || left.order - right.order);
    }
    return {
        plan: {
            file: state.configPath,
            target,
            link,
            exists,
            before,
            mode,
            raw,
            sections: candidates.map((candidate) => candidate.section),
            notes: linkNote === undefined ? [] : [linkNote],
            intro,
            logins,
            defaults: state.defaults,
            checks: state.sectionChecks,
            replace: state.replace,
            oneOf: state.oneOf,
            union: state.union,
        },
    };
}

/** Checks one answer with the plugin's own validator, layered over the defaults, and keeps it only if this field passes. */
export function applyAnswer(
    plan: SetupPlan,
    draft: Record<string, unknown>,
    field: SetupField,
    text: string,
): { change: SetupChange } | { problem: string } {
    const trimmed = text.trim();
    if (trimmed === "") return { problem: `Please enter a value for ${field.label}.` };

    let value: unknown;
    if (field.kind === "reference") {
        if (parseSecretReference(trimmed) === undefined) {
            return { problem: "That is not a place Jig can read a value from." };
        }
        value = trimmed;
    } else if (field.kind === "number") {
        const number = Number(trimmed);
        if (!Number.isFinite(number)) return { problem: `${field.label} must be a number.` };
        value = number;
    } else if (field.kind === "boolean") {
        const answer = /^(y|yes|true|1)$/i.test(trimmed) ? true : /^(n|no|false|0)$/i.test(trimmed) ? false : undefined;
        if (answer === undefined) return { problem: `${field.label} must be yes or no.` };
        value = answer;
    } else {
        value = trimmed;
    }

    const existing = draft[field.section];
    if (existing !== undefined && (!isObject(existing) || !parentIsObject(existing, field.path))) {
        return { problem: `${field.label} cannot be changed here. /jig doctor names the problem.` };
    }
    const nextSection = structuredClone(isObject(existing) ? existing : {});
    setValuePath(nextSection, field.path, value);
    const check = plan.checks.get(field.section);
    let messages: readonly string[];
    try {
        const merged = layered(
            plan.defaults.get(field.section),
            nextSection,
            plan.replace.get(field.section) ?? [],
            plan.oneOf.get(field.section) ?? [],
            plan.union.get(field.section) ?? [],
        );
        messages = check === undefined ? [] : check(merged).map(String);
    } catch {
        return { problem: `The plugin's check could not run for ${field.label}. Try another value.` };
    }
    const rejected = messages.filter((message) => messagePaths(message, field.section).includes(field.path));
    if (rejected.length > 0) return { problem: plainProblem(field, rejected[0] ?? "") };

    draft[field.section] = nextSection;
    const oldValue = getPath(plan.raw[field.section], field.path);
    return {
        change: {
            section: field.section,
            path: field.path,
            label: field.label,
            ...(oldValue === undefined ? {} : { oldValue }),
            value,
        },
    };
}

/** The fields a validator names, such as `acme.bastion.user` in "acme.bastion.user is required". */
export function messagePaths(message: string, section: string): string[] {
    const escaped = section.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const pattern = new RegExp(`(?:^|[^A-Za-z0-9_.-])${escaped}\\.([A-Za-z0-9_-]+(?:\\.[A-Za-z0-9_-]+)*)`, "g");
    const found: string[] = [];
    for (const match of message.matchAll(pattern)) {
        const path = match[1];
        if (path !== undefined && !found.includes(path)) found.push(path);
    }
    return found;
}

/** A path setup may write: plain dotted names, no array index and no prototype key. */
export function safePath(path: string): boolean {
    return path !== "" && !unsafePath(path) && path.split(".").every((part) => /^[A-Za-z_][A-Za-z0-9_-]*$/.test(part));
}

function unsafePath(path: string): boolean {
    return path
        .split(".")
        .some((part) => part === "" || /^\d+$/.test(part) || ["__proto__", "constructor", "prototype"].includes(part));
}

function plainProblem(field: SetupField, message: string): string {
    const key = `${field.section}.${field.path}`;
    let text = message
        .replace(new RegExp(`${key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}:?`, "ig"), "")
        .replace(/[`"'{}]/g, "")
        .replace(/\s+/g, " ")
        .trim();
    if (text === "" || text.includes(`${field.section}.`) || /\b[A-Za-z0-9_]+\.[A-Za-z0-9_]/.test(text)) {
        text = "did not pass the plugin's check";
    }
    const sentence = `${field.label} ${text}`.replace(/[.?!]?$/, ".");
    return sentence.length > 240 ? `${sentence.slice(0, 237)}...` : sentence;
}

function isObject(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isPrimitive(value: unknown): value is string | number | boolean {
    return typeof value === "string" || typeof value === "number" || typeof value === "boolean";
}

/** Whether every existing parent of `path` is an object, so setting the field cannot replace a scalar. */
function parentIsObject(value: unknown, path: string): boolean {
    if (value === undefined) return true;
    let at: unknown = value;
    for (const part of path.split(".").slice(0, -1)) {
        if (!isObject(at)) return false;
        at = at[part];
        if (at === undefined) return true;
    }
    return true;
}

function getPath(value: unknown, path: string): unknown {
    let at = value;
    for (const part of path.split(".")) {
        if (!isObject(at)) return undefined;
        at = at[part];
    }
    return at;
}
