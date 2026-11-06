// The `updates` section: the one switch that turns Jig's background update notice off. It is checked like a plugin's own
// section so a company plugin can set `updates.check: false` as a default; the person's file wins over it.
export const UPDATES_SECTION = "updates";

export interface UpdatesConfig {
    check: boolean;
}

/** The section, or undefined when the file (and its company defaults) do not set it. */
export function readUpdates(value: unknown): UpdatesConfig | undefined {
    if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
    const check = (value as { check?: unknown }).check;
    return { check: check === undefined ? true : check === true };
}

/** A validator for the file's `updates` section and a company's defaults over it. */
export function validateUpdatesSection(raw: unknown): readonly string[] {
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return ["updates must be an object"];
    const errors: string[] = [];
    for (const key of Object.keys(raw)) {
        if (key !== "check") errors.push(`updates.${key} is not a known field`);
    }
    const check = (raw as { check?: unknown }).check;
    if (check !== undefined && typeof check !== "boolean") errors.push("updates.check must be true or false");
    return errors;
}
