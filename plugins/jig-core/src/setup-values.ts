// The plain-object helpers setup shares: walking a dotted path, keeping a write off a scalar or a prototype key, and the
// names a `*` segment may take. They hold no state, so the plan, the answers and the plugin questions can all use them.

export function isObject(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function getPath(value: unknown, path: string): unknown {
    let at = value;
    for (const part of path.split(".")) {
        if (!isObject(at)) return undefined;
        at = at[part];
    }
    return at;
}

/** Whether every existing parent of `path` is an object, so setting the field cannot replace a scalar. */
export function parentIsObject(value: unknown, path: string): boolean {
    if (value === undefined) return true;
    let at: unknown = value;
    for (const part of path.split(".").slice(0, -1)) {
        if (!isObject(at)) return false;
        at = at[part];
        if (at === undefined) return true;
    }
    return true;
}

/** A dynamic name that is safe to put in a dotted path. */
export function safeSegment(name: string): boolean {
    return /^[A-Za-z0-9_][A-Za-z0-9_-]*$/.test(name) && !["__proto__", "constructor", "prototype"].includes(name);
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
