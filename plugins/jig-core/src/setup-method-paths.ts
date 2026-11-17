// The path arithmetic of a sign-in method's fields: a `*` segment stands for one dynamic name, and a field is allowed
// when its final object exists or the method declares a `requires` that does. Pure path work, kept out of setup-plan.ts
// so its length stays where the ratchet holds it.
import type { OnboardingMethod } from "./contract.ts";
import { getPath, isObject, safeSegment } from "./setup-values.ts";

/** Expands one `*` path segment against the configured objects: `services.*.ci.auth` -> each service name.
 *  Only object parents are expanded; a string mapping and a dotted key are left for a person to name. */
export function expandMethodPath(path: string, root: unknown): string[] {
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
    return paths;
}

/** Whether an expanded field path is allowed: its final object exists, or the method's declared `requires` does. */
export function methodPathAllowed(
    fieldPath: string,
    expanded: string,
    method: OnboardingMethod,
    root: unknown,
): boolean {
    const original = fieldPath.split(".");
    const dynamic = original.indexOf("*");
    if (dynamic === -1) return true;
    const expandedParts = expanded.split(".");
    const wildcardObject = original
        .slice(0, dynamic)
        .concat(expandedParts[dynamic] ?? "")
        .join(".");
    if (method.requires !== undefined) {
        return isObject(getPath(getPath(root, wildcardObject), method.requires));
    }
    return isObject(getPath(root, expanded.split(".").slice(0, -1).join(".")));
}
