// One accepted answer, checked against the section's own validator before it is kept: a whole field, one entry of a map,
// or a list written from one line. `setup.ts` asks; this file decides whether the answer is a change, a refusal, or
// "kept" (an empty answer where a value is already set).
import type { SetupChange, SetupField, SetupPlan } from "./setup-plan.ts";
import { layered } from "./section-defaults.ts";
import { parseSecretReference } from "./secrets.ts";
import { getPath, isObject, parentIsObject, safePath } from "./setup-values.ts";
import { setValuePath } from "./setup-write.ts";
import { TRANSPORTS_SECTION, relayNameProblem } from "./transports-section.ts";

/** What an answer did: a change to write, a plain refusal, or nothing because the current value stays. */
export type AnswerResult = { change: SetupChange } | { problem: string } | { kept: true };

/** What one new object did: the change to write, or a plain refusal and the field inside the object to ask again. */
export type ObjectAnswer = { change: SetupChange } | { problem: string; at?: string };

/** The longest one key of a map may be, and the names a map key may never be. */
const KEY_MAX = 200;
const UNSAFE_KEYS = new Set(["__proto__", "constructor", "prototype"]);

/** Why a map's name cannot be used, or undefined: the rule an `entry` and an `object` share. */
export function keyProblem(key: string): string | undefined {
    if (key === "" || key.length > KEY_MAX || /[\u0000-\u001f\u007f]/.test(key)) {
        return `That name must be one line of at most ${KEY_MAX} characters.`;
    }
    if (UNSAFE_KEYS.has(key)) return "That name cannot be used.";
    return undefined;
}

/** Why a new object's name cannot be used, or undefined: the rule of any map's key, and for jig-core's `transports` a
 *  plain identifier that is not the name of a transport a company plugin registered in code (both would then be blocked
 *  on the next load). The prompt and the answer share it. */
export function objectNameProblem(plan: SetupPlan, field: SetupField, name: string): string | undefined {
    const problem = keyProblem(name);
    if (problem !== undefined || field.section !== TRANSPORTS_SECTION) return problem;
    const plain = relayNameProblem(name);
    if (plain !== undefined) return plain;
    return plan.pluginTransports.includes(name) ? `${name} is a company's transport; choose another name.` : undefined;
}

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
        value = listValues(trimmed);
    } else {
        value = trimmed;
    }
    return applyValue(plan, draft, field, value);
}

/** A short list typed on one line: entries separated by commas or new lines, each one trimmed and empty ones left out. */
export function listValues(text: string): string[] {
    return text
        .split(/[,\n]/)
        .map((part) => part.trim())
        .filter((part) => part !== "");
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
    const problem = keyProblem(cleanKey);
    if (problem !== undefined) return { problem };
    if (!safePath(field.path)) return { problem: cannotChange(field) };
    const existing = draft[field.section];
    if (existing !== undefined && (!isObject(existing) || !parentIsObject(existing, field.path))) {
        return { problem: cannotChange(field) };
    }
    const nextSection = structuredClone(isObject(existing) ? existing : {});
    const current = getPath(nextSection, field.path);
    const map = isObject(current) ? { ...current } : {};
    map[cleanKey] = value.trim();
    setValuePath(nextSection, field.path, map);
    return commit(plan, draft, field, nextSection, value.trim(), field.path, cleanKey);
}

/**
 * One named object of the map at `path`, from the answers of one form: `values` is dotted paths inside it, so
 * `{ uri, "via.ssh.host" }` becomes one connection. Setup is add-only, so a name that is already there is refused. The
 * section's check runs once over the whole object, and a message naming it or a path below it refuses it, naming the
 * field to ask again.
 */
export function applyObject(
    plan: SetupPlan,
    draft: Record<string, unknown>,
    field: SetupField,
    key: string,
    values: Readonly<Record<string, unknown>>,
): ObjectAnswer {
    const spec = field.object;
    if (spec === undefined) return { problem: cannotChange(field) };
    const cleanKey = key.trim();
    const problem = objectNameProblem(plan, field, cleanKey);
    if (problem !== undefined) return { problem };
    // The map's own path (empty when the section is the map), and every path inside the new object: an answer is a path,
    // and one setup cannot follow (a prototype key, an index) is refused here, never written. Registration refuses these
    // too; this is the answer time.
    if ((field.path !== "" && !safePath(field.path)) || !Object.keys(values).every(safePath)) {
        return { problem: cannotChange(field) };
    }
    const existing = draft[field.section];
    if (existing !== undefined && (!isObject(existing) || !parentIsObject(existing, field.path))) {
        return { problem: cannotChange(field) };
    }
    let nextSection = structuredClone(isObject(existing) ? existing : {});
    const merged = layered(
        plan.defaults.get(field.section),
        nextSection,
        plan.replace.get(field.section) ?? [],
        plan.oneOf.get(field.section) ?? [],
        plan.union.get(field.section) ?? [],
    );
    const already = getPath(merged, field.path);
    if (isObject(already) && Object.hasOwn(already, cleanKey)) {
        return { problem: `${cleanKey} is already set up here; edit it in your settings file, or use another name.` };
    }
    const current = getPath(nextSection, field.path);
    const map = isObject(current) ? { ...current } : {};
    const object: Record<string, unknown> = {};
    for (const [path, value] of Object.entries(values)) setValuePath(object, path, value);
    map[cleanKey] = object;
    if (field.path === "") nextSection = map;
    else setValuePath(nextSection, field.path, map);

    const check = plan.checks.get(field.section);
    let messages: readonly string[];
    try {
        messages = check === undefined ? [] : check(mergedSection(plan, field.section, nextSection)).map(String);
    } catch {
        return { problem: `The plugin's check could not run for ${field.label}. Try another value.` };
    }
    const keyPath = field.path === "" ? cleanKey : `${field.path}.${cleanKey}`;
    // A message about the map itself, or about this object: the object is found by its key as written, not by reading a
    // path out of the message, because a key may hold a space, a dot or a letter no path reader takes. A message that
    // names the key and nothing readable after it refuses the whole object.
    for (const message of messages) {
        if (messageNames(message, field.section, field.path)) {
            const text = plainObjectText(message, field.section, field.path);
            return { problem: `${field.label} was not added: ${text}` };
        }
        const about = aboutObject(message, field.section, keyPath);
        if (about === undefined) continue;
        const strip = about.at === undefined ? keyPath : `${keyPath}.${about.at}`;
        const text = plainObjectText(message, field.section, strip);
        return about.at === undefined
            ? { problem: `${field.label} ${cleanKey} was not added: ${text}` }
            : { problem: text, at: about.at };
    }

    draft[field.section] = nextSection;
    return {
        change: {
            section: field.section,
            path: field.path,
            label: field.label,
            value: object,
            note: cleanKey,
            key: cleanKey,
        },
    };
}

/** Whether a validator's message is about the object at `keyPath`, and the path inside it the message names, when it
 *  names one. The key is matched as text, so any key is found. */
function aboutObject(message: string, section: string, keyPath: string): { at?: string } | undefined {
    const key = `${section}.${keyPath}`.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const found = new RegExp(
        `(?:^|[^A-Za-z0-9_.-])${key}(?![A-Za-z0-9_-])(?:\\.([A-Za-z0-9_-]+(?:\\.[A-Za-z0-9_-]+)*))?`,
    ).exec(message);
    if (found === null) return undefined;
    return found[1] === undefined ? {} : { at: found[1] };
}

/** The merged section a plan would check, from one section of the draft. */
function mergedSection(plan: SetupPlan, section: string, rawSection: Record<string, unknown>): unknown {
    return layered(
        plan.defaults.get(section),
        rawSection,
        plan.replace.get(section) ?? [],
        plan.oneOf.get(section) ?? [],
        plan.union.get(section) ?? [],
    );
}

/** A validator's message without the path it names, for the sentence setup writes around it. Never a value or a
 *  reference: the message is the plugin's, and a plugin's messages name keys, not values. */
export function plainObjectText(message: string, section: string, strip: string): string {
    const key = strip === "" ? section : `${section}.${strip}`;
    const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    let text = message
        .replace(new RegExp(escaped, "ig"), "")
        .replace(/[`"'{}]/g, "")
        .replace(/\s+/g, " ")
        .trim()
        .replace(/^[\s:.]+/, "");
    if (text === "" || text.includes(`${section}.`) || /^[A-Za-z0-9_]+\.[A-Za-z0-9_]/.test(text)) {
        text = "did not pass the plugin's check";
    }
    const sentence = text.length > 200 ? `${text.slice(0, 197)}...` : text;
    return /[.?!]$/.test(sentence) ? sentence : `${sentence}.`;
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
    // The value's own path, the map the entry goes in, or the entry itself: a message about another entry of the same
    // map leaves this answer alone.
    const rejected = messages.filter(
        (message) =>
            messageNames(message, field.section, path) ||
            (key !== undefined && messageNames(message, field.section, `${path}.${key}`)),
    );
    if (rejected.length > 0) return { problem: plainProblem(field, rejected[0] ?? "", key) };
    draft[field.section] = nextSection;
    const oldValue =
        key === undefined
            ? getPath(plan.raw[field.section], path)
            : getPath(getPath(plan.raw[field.section], path), key);
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

/** Whether a validator's message names one dotted path whole: "acme.sso.token is required" names `sso.token`, while a
 *  message about `acme.sso.token.slot`, or about a map's sibling key such as `environments.prod.us`, does not. A map key
 *  may hold a dot or a space, so the match is the literal path, with the same name characters `messagePaths` reads. */
export function messageNames(message: string, section: string, path: string): boolean {
    const full = (path === "" ? section : `${section}.${path}`).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`(?:^|[^A-Za-z0-9_.-])${full}(?![A-Za-z0-9_.-])`).test(message);
}

/** The refusal for a path setup will not write: a path it cannot follow, or one under a value it cannot change. */
function cannotChange(field: SetupField): string {
    return `${field.label} cannot be changed here. /jig doctor names the problem.`;
}

function plainProblem(field: SetupField, message: string, key?: string): string {
    // The message names the entry (`api.environments.Staging`) or the field; either way setup says its own label first.
    let text = message;
    for (const at of key === undefined ? [field.path] : [`${field.path}.${key}`, field.path]) {
        const full = `${field.section}.${at}`.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        text = text.replace(new RegExp(`${full}:?`, "ig"), "");
    }
    text = text
        .replace(/[`"'{}]/g, "")
        .replace(/\s+/g, " ")
        .trim();
    if (text === "" || text.includes(`${field.section}.`) || /\b[A-Za-z0-9_]+\.[A-Za-z0-9_]/.test(text)) {
        text = "did not pass the plugin's check";
    }
    const sentence = `${field.label} ${text}`.replace(/[.?!]?$/, ".");
    return sentence.length > 240 ? `${sentence.slice(0, 237)}...` : sentence;
}
