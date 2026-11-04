// Reading what Jira sends back. Jira's answers differ by version and by edition, so every reader here accepts a missing
// or oddly shaped value and gives an empty one, and only the code that needs a field decides that its absence is an error.
import { oneLine, shortList } from "../../jig-core/src/kit/text.ts";
import { InputError, isObject } from "../../jig-core/src/kit/values.ts";

export type Obj = Record<string, unknown>;

/** Shared with the other plugins (jig-core's `kit/values.ts`). A mistake in a call's input is an InputError, a
 *  TypeError that jig-core reads as "invalid input"; tool.ts keeps a TypeError from a bug here from being mistaken for one. */
export { InputError, isObject };

/** Shared with the other plugins (jig-core's `kit/text.ts`), so a fix lands once. */
export { oneLine, shortList };
export const obj = (value: unknown): Obj => (isObject(value) ? value : {});
export const arr = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
export const str = (value: unknown): string => (typeof value === "string" ? value : "");
export const int = (value: unknown): number =>
    typeof value === "number" && Number.isFinite(value) ? Math.trunc(value) : 0;

/** A message from anything that was thrown. */
export function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

/** The name Jira shows for an option, a status, a priority or a user: `name`, else `value`, else `displayName`. */
export function nameOf(value: unknown): string {
    const found = obj(value);
    return str(found.name) || str(found.value) || str(found.displayName) || str(value);
}

/** A person as Jira describes one. Jira Cloud identifies people by `accountId`; Data Center by `name` and `key`. */
export interface User {
    accountId: string;
    username: string;
    key: string;
    /** Empty where the site hides it: Jira Cloud shows an email address only when the person allows it. */
    email: string;
    displayName: string;
    active: boolean;
}

export function userOf(value: unknown): User {
    const user = obj(value);
    return {
        accountId: str(user.accountId),
        username: str(user.name),
        key: str(user.key),
        email: str(user.emailAddress),
        displayName: str(user.displayName) || str(user.name) || str(user.accountId),
        active: user.active !== false,
    };
}

/** The identifier to give back to Jira for this person: an account id on Cloud, the user name on Data Center. */
export function userId(user: User): string {
    return user.accountId || user.username || user.key;
}

/**
 * True when two descriptions are of the same person, by any identifier they share: account id, user name, key or email
 * address. Case does not matter: Data Center user names and email addresses are not case-sensitive, and account ids are
 * random strings, so two of them never differ only in case.
 */
export function sameUser(a: User, b: User): boolean {
    const ids = (user: User): string[] =>
        [user.accountId, user.username, user.key, user.email].filter((id) => id !== "").map((id) => id.toLowerCase());
    const mine = ids(a);
    return ids(b).some((id) => mine.includes(id));
}

/** Someone known only by the text a caller gave: it may be an account id, a user name, a key or an email address. */
export function userNamed(text: string): User {
    return { accountId: text, username: text, key: text, email: text, displayName: text, active: true };
}

/** `2026-10-12T14:03:22.123+0000` as `2026-10-12`. */
export const day = (stamp: unknown): string => str(stamp).slice(0, 10);

/** `2026-10-12T14:03:22.123+0000` as `2026-10-12 14:03`. */
export const minute = (stamp: unknown): string => str(stamp).slice(0, 16).replace("T", " ");

/** One value of any field on one line: the names of objects, lists joined, long text cut. */
export function describeValue(value: unknown): string {
    if (value === null || value === undefined || value === "") return "(empty)";
    if (typeof value === "string") return oneLine(value, 120);
    if (typeof value === "number" || typeof value === "boolean") return String(value);
    if (Array.isArray(value)) return value.length === 0 ? "(empty)" : oneLine(value.map(describeValue).join(", "), 200);
    const found = obj(value);
    for (const key of ["name", "value", "displayName", "key"]) {
        if (str(found[key]) !== "") return oneLine(str(found[key]), 120);
    }
    return oneLine(JSON.stringify(value), 200);
}

/**
 * A field value in a form that compares equal whether Jira sent a whole object (`{ "id": "2", "name": "High" }`) or the
 * call gave only its name (`{ "name": "High" }`): an object counts as its name, value, account id, key or id.
 */
export function comparable(value: unknown): string {
    if (value === null || value === undefined) return "";
    if (typeof value === "string") return value.replace(/\r\n/g, "\n").trim();
    if (typeof value === "number" || typeof value === "boolean") return String(value);
    if (Array.isArray(value)) return JSON.stringify(value.map(comparable).sort());
    const found = obj(value);
    for (const key of ["name", "value", "accountId", "key", "id"]) {
        if (found[key] !== undefined && found[key] !== null) return comparable(found[key]);
    }
    return JSON.stringify(value);
}
