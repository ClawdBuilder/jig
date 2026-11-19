// The doctor's one line for the Jig plugins that are off, and what a session hands the doctor so it can print the same
// line the terminal does.
import type { DoctorContext, DoctorLine } from "./doctor.ts";
import { FEATURES } from "./plugin-table.ts";

/**
 * For `doctorContext`: the table's plugins whose section is off in this session, minus any section registered since the
 * session started (`registered`: a plugin may register late). A session does not know which settings file holds a
 * filter, so it names none. The sandbox is never in the line, as in the terminal: the sandbox check says what it says.
 * A table plugin without a section is jig-core, which is always loaded here.
 */
export function sessionFiltered(
    off: ReadonlySet<string> | undefined,
    registered: ReadonlyMap<string, unknown>,
): Pick<DoctorContext, "filtered"> {
    const features = Object.entries(FEATURES).flatMap(([plugin, { feature, section }]) =>
        plugin !== "jig-sandbox" && section !== undefined && off?.has(section) === true && !registered.has(section)
            ? [{ feature, section }]
            : [],
    );
    return features.length === 0
        ? {}
        : { filtered: { features, alwaysOn: [], offSections: features.map((entry) => entry.section) } };
}

/** "Off: api, jira, logs." as one skip line, with the settings file or files that hold the filters when they are known. */
export function offLine(filtered: DoctorContext["filtered"]): DoctorLine[] {
    const off = [...(filtered?.alwaysOn ?? []), ...(filtered?.features ?? [])];
    if (off.length === 0) return [];
    const files = new Set(off.flatMap((entry) => (entry.settings === undefined ? [] : [entry.settings])));
    return [
        {
            id: "config.filtered.off",
            group: "config",
            level: "skip",
            title: `Off: ${off
                .map((entry) => entry.feature)
                .sort()
                .join(", ")}.`,
            detail:
                off.length === 1
                    ? "This plugin is not loaded. Its section in jig.json is kept and applies again when it is on."
                    : "These plugins are not loaded. Their sections in jig.json are kept and apply again when they are on.",
            ...(files.size === 0
                ? {}
                : { fix: `Turn one on by removing its filter in ${[...files].sort().join(" or ")}.` }),
        },
    ];
}
