// Company defaults for plugin sections of jig.json. A company plugin cannot write your file, so it gives defaults, and
// your own section is laid over them: objects merge key by key, and any other value of yours (a list, a string, a
// number) replaces the company's. The result is checked by the plugin's own validation, like a section you wrote.
//
// A plugin may name keys that replace instead of merge, because an object there is one choice among several (an `auth`
// of `{ transport }` or of `{ token }`): merging yours into the company's would give a mix that is neither. A key is a
// path from the section's root, with `*` for any one name (a map of services, say): `auth`, `backend.auth`,
// `services.*.ci.auth`.
//
// A plugin may also name keys that exclude each other (`oneOf`), such as `backend.auth` and `backend.transport`: when your
// section sets one of them, the company's value for the others is dropped, so the two do not end up side by side.
//
// And it may name lists that add up (`union`), such as the `folders` a company and you both read from: the result is the
// company's entries first, then yours, each once, instead of yours alone. A key is a path, as for `replace`.
//
// A map read in order (`first`) keeps your keys before the company's: an ordered map such as `git.accounts` must try the
// person's specific pattern before a company's broader one.
//
// A `null` is a removal, never a value (RFC 7396's merge patch): the company's map entry of that name is left out, at any
// depth the merge handles. `removedPaths` says which entries your file leaves out, so `/jig` and the doctor can tell you,
// and `withoutRemoved` is what a section comes to with the removals applied: no plugin ever sees a `null`.

function isPlainObject(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Sets an own property, even one called `__proto__`, which a plain assignment would read as the prototype. */
function put(target: Record<string, unknown>, key: string, value: unknown): void {
    Object.defineProperty(target, key, { value, enumerable: true, writable: true, configurable: true });
}

function matches(pattern: readonly string[], path: readonly string[]): boolean {
    return pattern.length === path.length && pattern.every((part, index) => part === "*" || part === path[index]);
}

/** Whether the path at which two objects meet is one the plugin said replaces. */
function replaces(patterns: readonly (readonly string[])[], path: readonly string[]): boolean {
    return patterns.some((pattern) => matches(pattern, path));
}

/** Keys that exclude each other, all in one object: the object's path and the keys' names. */
interface Rivals {
    parent: readonly string[];
    keys: readonly string[];
}

/** The company's keys to leave out at `path`: the rivals of any key your section sets there. A `null` is a removal, not
 *  a choice among the rivals, so it never displaces the company's other keys. */
function displaced(groups: readonly Rivals[], path: readonly string[], mine: Record<string, unknown>): Set<string> {
    const out = new Set<string>();
    for (const group of groups) {
        if (!matches(group.parent, path)) continue;
        const chosen = group.keys.filter((key) => Object.hasOwn(mine, key) && mine[key] !== null);
        if (chosen.length === 0) continue;
        for (const key of group.keys) if (!chosen.includes(key)) out.add(key);
    }
    return out;
}

/** Two lists in one: theirs first, then each of yours that is not already there. */
function united(theirs: readonly unknown[], mine: readonly unknown[]): unknown[] {
    const out = [...theirs];
    const seen = new Set(out.map((entry) => JSON.stringify(entry)));
    for (const entry of mine) {
        const key = JSON.stringify(entry);
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(entry);
    }
    return out;
}

function lay(
    theirs: unknown,
    mine: unknown,
    path: readonly string[],
    patterns: readonly (readonly string[])[],
    groups: readonly Rivals[],
    unions: readonly (readonly string[])[],
    firsts: readonly (readonly string[])[],
): unknown {
    if (mine === undefined) return theirs;
    // A null is a removal, never a value (RFC 7396): the key is handled where its object meets the company's.
    if (mine === null) return theirs;
    if (Array.isArray(theirs) && Array.isArray(mine) && replaces(unions, path)) return united(theirs, mine);
    if (!isPlainObject(theirs) || !isPlainObject(mine)) return mine;
    // Yours takes the place of theirs whole: nothing of the company's stays beside it, and no `null` of yours either.
    if (replaces(patterns, path)) return withoutRemoved(mine);
    const out: Record<string, unknown> = {};
    const dropped = displaced(groups, path, mine);
    for (const [key, value] of Object.entries(theirs)) if (!dropped.has(key)) put(out, key, value);
    for (const [key, value] of Object.entries(mine)) {
        // The person leaves the company's entry out: the key goes, and nothing null reaches a plugin.
        if (value === null) {
            Reflect.deleteProperty(out, key);
            continue;
        }
        put(
            out,
            key,
            lay(
                Object.hasOwn(theirs, key) ? theirs[key] : undefined,
                value,
                [...path, key],
                patterns,
                groups,
                unions,
                firsts,
            ),
        );
    }
    // The person's keys first, then the company's remaining ones: an ordered map is read in that order, and the person's
    // more specific entry must be seen before the company's.
    if (firsts.some((pattern) => matches(pattern, path))) {
        const ordered: Record<string, unknown> = {};
        for (const key of Object.keys(mine)) if (Object.hasOwn(out, key)) put(ordered, key, out[key]);
        for (const key of Object.keys(out)) if (!Object.hasOwn(ordered, key)) put(ordered, key, out[key]);
        return ordered;
    }
    return out;
}

/** `mine` laid over `theirs`. Neither is changed. `replace` lists the paths whose object of yours replaces theirs whole;
 *  each list in `oneOf` holds paths in one object that exclude each other (see `oneOfProblem`); `union` lists the paths of
 *  lists that add up, theirs first. */
export function layered(
    theirs: unknown,
    mine: unknown,
    replace: readonly string[] = [],
    oneOf: readonly (readonly string[])[] = [],
    union: readonly string[] = [],
    first: readonly string[] = [],
): unknown {
    const groups = oneOf.map((paths) => {
        const split = paths.map((path) => path.split("."));
        return { parent: split[0]?.slice(0, -1) ?? [], keys: split.map((parts) => parts.at(-1) ?? "") };
    });
    return lay(
        theirs,
        mine,
        [],
        replace.map((path) => path.split(".")),
        groups,
        union.map((path) => path.split(".")),
        first.map((path) => path.split(".")),
    );
}

/** Why a `oneOf` list is not usable, or undefined: at least two paths, all in the same object. */
export function oneOfProblem(paths: unknown): string | undefined {
    if (!Array.isArray(paths) || paths.length < 2 || paths.some((path) => typeof path !== "string" || path === "")) {
        return 'each oneOf entry is a list of two or more paths, such as ["backend.auth", "backend.transport"]';
    }
    const parents = new Set(paths.map((path: string) => path.split(".").slice(0, -1).join(".")));
    return parents.size === 1 ? undefined : `the paths of a oneOf entry must be in one object: ${paths.join(", ")}`;
}

/** A copy of your section with every `null` entry left out: a removal, never a value. Lists keep their entries as
 *  written (RFC 7396 removes object members only), and so does a value that is not an object. */
export function withoutRemoved(value: unknown): unknown {
    if (!isPlainObject(value)) return value;
    const out: Record<string, unknown> = {};
    for (const [key, inner] of Object.entries(value)) if (inner !== null) put(out, key, withoutRemoved(inner));
    return out;
}

/** The company's map entries that a `null` in your section leaves out, as dotted paths such as `connections.prod`. A
 *  `null` for a name the company does not have is not a removal, and is not listed. */
export function removedPaths(theirs: unknown, mine: unknown): string[] {
    if (!isPlainObject(mine)) return [];
    const out: string[] = [];
    for (const [key, value] of Object.entries(mine)) {
        if (!isPlainObject(theirs) || !Object.hasOwn(theirs, key)) continue;
        if (value === null) out.push(key);
        else for (const inner of removedPaths(theirs[key], value)) out.push(`${key}.${inner}`);
    }
    return out;
}

/** The removal that leaves `path` out: the path itself or a map entry above it, or undefined. Used to keep a question
 *  from undoing a removal. */
export function removedAt(removed: readonly string[], path: string): string | undefined {
    return removed.find((entry) => path === entry || path.startsWith(`${entry}.`));
}

/** For each section with company defaults, what a `null` in your file leaves out: `/jig` and the doctor say it there. */
export function removedBySection(
    defaults: ReadonlyMap<string, unknown>,
    file: Readonly<Record<string, unknown>>,
): Map<string, readonly string[]> {
    const out = new Map<string, readonly string[]>();
    for (const [name, value] of Object.entries(file)) {
        const theirs = defaults.get(name);
        if (theirs === undefined) continue;
        const removed = removedPaths(theirs, value);
        if (removed.length > 0) out.set(name, removed);
    }
    return out;
}

/** A frozen copy of a section and of every value in it: a plugin that changes what it was given changes nothing. A
 *  value that cannot be cloned (no section should hold one) is frozen where it is, so the promise still holds. */
export function frozenSection(value: unknown): unknown {
    let copy = value;
    try {
        copy = structuredClone(value);
    } catch {
        copy = value;
    }
    return deepFreeze(copy);
}

function deepFreeze<T>(value: T): T {
    if (typeof value === "object" && value !== null && !Object.isFrozen(value)) {
        Object.freeze(value);
        for (const inner of Object.values(value)) deepFreeze(inner);
    }
    return value;
}
