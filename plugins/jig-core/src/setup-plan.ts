// What `/jig setup` still needs, from the states `/jig` already knows, the plugin validators and the company defaults.
//
// It reads the person's file once, works out which fields a validator names and asks about one field at a time. A
// credential is asked for as WHERE it is kept, never as a value. Nothing here writes or talks to Pi.
import { lstatSync, readFileSync, readlinkSync, realpathSync, statSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import type { LoadedConfig, SecretBackend, SectionCheck } from "./config.ts";
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
}

export type SetupFieldKind = "text" | "number" | "boolean" | "reference";

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
}

export interface SetupSection {
    name: string;
    label: string;
    fields: SetupField[];
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
    defaults: ReadonlyMap<string, unknown>;
    checks: ReadonlyMap<string, SectionCheck>;
    replace: ReadonlyMap<string, readonly string[]>;
    oneOf: ReadonlyMap<string, readonly (readonly string[])[]>;
    union: ReadonlyMap<string, readonly string[]>;
}

export type SetupPlanResult = { plan: SetupPlan } | { problem: string };

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
        if (section === "loaded" || section === "not set") continue;
        const priority = section === "company defaults incomplete" ? 0 : 1;
        const messages =
            section === "company defaults incomplete"
                ? [...(state.personal.incomplete.get(name) ?? [])]
                : state.personal.problems.filter((problem) => problem.key === name).map((problem) => problem.message);
        if (messages.length === 0) continue;

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

        if (fields.length > 0 || notes.length > 0) {
            candidates.push({ section: { name, label: labelOf(name), fields, notes }, priority, order });
        }
    }

    candidates.sort((left, right) => left.priority - right.priority || left.order - right.order);
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
