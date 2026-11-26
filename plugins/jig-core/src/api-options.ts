// The section options `registerSection` checks before it writes anything: a path list, and a company entry that names
// methods for a section that never declared them. Kept out of api.ts so it stays one step per member.
import type { OnboardingEntry } from "./contract-onboarding.ts";
import type { JigState } from "./engine-state.ts";

/** Refuses a section option that must be a list of non-empty paths, such as `first` or `union`. */
export function checkPathList(value: unknown, section: string, option: string, example: string): void {
    if (value === undefined) return;
    if (!Array.isArray(value) || value.some((path) => typeof path !== "string" || path === "")) {
        throw new TypeError(`registerSection(${section}): ${option} must be a list of paths such as ${example}`);
    }
}

/** A company entry may only name methods for a section that declared them. */
export function checkMethodSections(entry: OnboardingEntry, state: JigState, label: string): void {
    for (const section of Object.keys(entry.methods ?? {})) {
        if (state.sectionChecks.has(section) && !state.onboardingMethods.has(section))
            throw new Error(`${label}: section ${JSON.stringify(section)} has no methods`);
    }
}

/** Keeps a copy of a section's list under its name, or forgets the name when the list is empty or not given. */
export function keepList<T>(
    into: Map<string, readonly T[]>,
    name: string,
    list: readonly T[] | undefined,
    copy: (item: T) => T = (item) => item,
): void {
    if (list === undefined || list.length === 0) into.delete(name);
    else into.set(name, list.map(copy));
}
