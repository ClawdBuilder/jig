// One accepted answer, checked against the section's own validator before it is kept: a whole field, one entry of a map,
// or a list written from one line. `setup.ts` asks; this file decides whether the answer is a change, a refusal, or
// "kept" (an empty answer where a value is already set).
import type { SetupChange, SetupField, SetupPlan } from "./setup-plan.ts";
import { layered } from "./section-defaults.ts";
import { parseSecretReference } from "./secrets.ts";
import { isObject, parentIsObject, safePath } from "./setup-values.ts";
import { setValuePath } from "./setup-write.ts";

/** What an answer did: a change to write, a plain refusal, or nothing because the current value stays. */
export type AnswerResult = { change: SetupChange } | { problem: string } | { kept: true };

/** The longest one key of a map may be, and the names a map key may never be. */
const KEY_MAX = 200;
const UNSAFE_KEYS = new Set(["__proto__", "constructor", "prototype"]);

/** One answer as typed: a reference, a number, yes/no, a list, or plain text. */
export function applyAnswer(
    plan: SetupPlan,
    draft: Record<string, unknown>,
    field: SetupField,
    text: string,
): AnswerResult {
    const trimmed = text.trim();
    if (trimmed === "") {
        if (field.keep === true) return { kept: true };
        return { problem: `Please enter a value for ${field.label}.` };
    }
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
    } else if (field.list === true) {
        value = trimmed
            .split(/[,\n]/)
            .map((part) => part.trim())
            .filter((part) => part !== "");
    } else {
        value = trimmed;
    }
    return applyValue(plan, draft, field, value);
}

/** One already-parsed value, checked and kept only when the section still passes. */
export function applyValue(
    plan: SetupPlan,
    draft: Record<string, unknown>,
    field: SetupField,
    value: unknown,
): AnswerResult {
    if (!safePath(field.path)) return { problem: cannotChange(field) };
    const existing = draft[field.section];
    if (existing !== undefined && (!isObject(existing) || !parentIsObject(existing, field.path))) {
        return { problem: cannotChange(field) };
    }
    const nextSection = structuredClone(isObject(existing) ? existing : {});
    setValuePath(nextSection, field.path, value);
    return commit(plan, draft, field, nextSection, value, field.path);
}

/** One key and value of the map at `path`: the answer becomes `path.key`, and the key is never a path. */
export function applyEntry(
    plan: SetupPlan,
    draft: Record<string, unknown>,
    field: SetupField,
    key: string,
    value: string,
): AnswerResult {
    const cleanKey = key.trim();
    if (cleanKey === "" || cleanKey.length > KEY_MAX || /[\u0000-\u001f\u007f]/.test(cleanKey)) {
        return { problem: `${field.entry?.keyLabel ?? "The name"} must be one line of at most ${KEY_MAX} characters.` };
    }
    if (UNSAFE_KEYS.has(cleanKey)) return { problem: "That name cannot be used." };
    if (!safePath(field.path)) return { problem: cannotChange(field) };
    const existing = draft[field.section];
    if (existing !== undefined && (!isObject(existing) || !parentIsObject(existing, field.path))) {
        return { problem: cannotChange(field) };
    }
    const nextSection = structuredClone(isObject(existing) ? existing : {});
    const current = getAt(nextSection, field.path);
    const map = isObject(current) ? { ...current } : {};
    map[cleanKey] = value.trim();
    setValuePath(nextSection, field.path, map);
    return commit(plan, draft, field, nextSection, value.trim(), field.path, cleanKey);
}

function commit(
    plan: SetupPlan,
    draft: Record<string, unknown>,
    field: SetupField,
    nextSection: Record<string, unknown>,
    value: unknown,
    path: string,
    key?: string,
): AnswerResult {
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
    const rejected = messages.filter((message) => messagePaths(message, field.section).includes(path));
    if (rejected.length > 0) return { problem: plainProblem(field, rejected[0] ?? "") };
    draft[field.section] = nextSection;
    const oldValue =
        key === undefined ? getAt(plan.raw[field.section], path) : getAt(getAt(plan.raw[field.section], path), key);
    return {
        change: {
            section: field.section,
            path,
            label: field.label,
            ...(oldValue === undefined ? {} : { oldValue }),
            value,
            ...(key === undefined ? {} : { key }),
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

/** The refusal for a path setup will not write: a path it cannot follow, or one under a value it cannot change. */
function cannotChange(field: SetupField): string {
    return `${field.label} cannot be changed here. /jig doctor names the problem.`;
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

function getAt(value: unknown, path: string): unknown {
    let at: unknown = value;
    for (const part of path.split(".")) {
        if (!isObject(at)) return undefined;
        at = at[part];
    }
    return at;
}
