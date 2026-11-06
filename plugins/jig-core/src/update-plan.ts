// What `jig update` would do, from facts read before the first change: the target release, the copies installed, the Pi
// version, and the company ranges that capped the target. It changes nothing and runs nothing.
import { compareVersions, meetsMinimum } from "./pi-version.ts";
import type { PiRequirement } from "./pi-version.ts";
import type { CompanyRange, SelectedTarget } from "./update-versions.ts";

export interface UpdateCopy {
    version?: string;
    source?: string;
    scope?: "user" | "project";
    folder?: string;
}

export interface UpdatePlanInput {
    name: string;
    current: string;
    target: SelectedTarget;
    piVersion?: string;
    piCopy?: UpdateCopy;
    globalVersion?: string;
}

export interface UpdatePlan {
    name: string;
    current: string;
    target: string;
    newest: string;
    /** The Pi install this update needs, or undefined when the installed Pi is in range. */
    pi?: { from: string; to: string };
    /** What to tell the person about Pi, including the tested-version warning. */
    piNotes: string[];
    piCopy?: { from?: string; to: string; needed: boolean };
    global?: { from?: string; to: string; needed: boolean };
    cappedBy: CompanyRange[];
    warnings: string[];
    /** Anything to do at all? */
    changes: boolean;
}

/** The Pi pair a release states, or undefined when it is missing or malformed. */
export function statedRequirement(target: SelectedTarget): PiRequirement | undefined {
    const pi = target.release.jig?.agents?.pi;
    if (typeof pi?.minimum !== "string" || typeof pi?.tested !== "string") return undefined;
    if (!/^\d+\.\d+\.\d+$/.test(pi.minimum) || !/^\d+\.\d+\.\d+$/.test(pi.tested)) return undefined;
    return { minimum: pi.minimum, tested: pi.tested };
}

/** Whether Pi's Jig entry is a plain npm source with no version pin. */
export function movablePiSource(source: string | undefined, name: string): { version?: string } | undefined {
    if (source === undefined || !source.startsWith("npm:")) return undefined;
    const spec = source.slice(4).trim();
    if (spec === name) return {};
    if (spec.startsWith(`${name}@`)) return { version: spec.slice(name.length + 1) };
    return undefined;
}

/** Builds the plan, or refuses before anything changes. */
export function planUpdate(input: UpdatePlanInput): { plan: UpdatePlan } | { problem: string } {
    const requirement = statedRequirement(input.target);
    if (requirement === undefined) {
        return { problem: `Jig ${input.target.version} does not say which Pi version it needs. Nothing was changed.` };
    }
    if (input.piVersion === undefined) {
        return { problem: "Jig cannot tell which Pi version is installed. Nothing was changed." };
    }
    const piNotes: string[] = [];
    let pi: UpdatePlan["pi"];
    if (!meetsMinimum(input.piVersion, requirement.minimum)) {
        pi = { from: input.piVersion, to: requirement.tested };
        piNotes.push(
            `Jig ${input.target.version} needs Pi ${requirement.minimum} or later; this Pi is ${input.piVersion}.`,
        );
    } else if (compareVersions(input.piVersion, requirement.tested) > 0) {
        piNotes.push(
            `Pi ${input.piVersion} is newer than ${requirement.tested}, the version Jig is tested with. Jig will not block it.`,
        );
    }

    const copy = input.piCopy;
    if (copy === undefined) {
        return { problem: "Jig is not installed in Pi, so there is no Pi copy to update. Nothing was changed." };
    }
    if (copy.scope === "project") {
        return {
            problem:
                "Pi loads Jig from this folder's project packages. jig update changes only user packages; move Jig to user scope first. Nothing was changed.",
        };
    }
    const source = movablePiSource(copy.source, input.name);
    if (source === undefined) {
        return {
            problem: `Pi's Jig copy is not a plain npm source (${copy.source ?? "no source"}). Install it yourself with: pi install npm:${input.name}@${input.target.version}`,
        };
    }
    if (source.version !== undefined) {
        return {
            problem: `Pi's Jig copy is pinned to ${source.version}. jig update does not move a pinned copy. Install it with: pi install npm:${input.name}@${input.target.version}`,
        };
    }

    const piCopy = {
        ...(copy.version === undefined ? {} : { from: copy.version }),
        to: input.target.version,
        needed: copy.version !== input.target.version,
    };
    const global = {
        ...(input.globalVersion === undefined ? {} : { from: input.globalVersion }),
        to: input.target.version,
        needed: input.globalVersion !== input.target.version,
    };
    return {
        plan: {
            name: input.name,
            current: input.current,
            target: input.target.version,
            newest: input.target.newest,
            ...(pi === undefined ? {} : { pi }),
            piNotes,
            piCopy,
            global,
            cappedBy: input.target.cappedBy,
            warnings:
                piCopy.needed || global.needed ? [] : ["Both copies are already on this version; nothing to install."],
            changes: pi !== undefined || piCopy.needed || global.needed,
        },
    };
}

/** The plain lines `--check` prints, and the confirmation uses. */
export function describePlan(plan: UpdatePlan): string[] {
    const lines = [`Jig ${plan.current} -> ${plan.target}`];
    if (plan.target !== plan.newest) {
        const holders = plan.cappedBy.map((entry) => `${entry.package} (${entry.range})`).join(", ");
        lines.push(`Stopped at ${plan.target}, the newest inside the company range from ${holders}.`);
    }
    if (plan.pi !== undefined) {
        lines.push(`Pi ${plan.pi.from} -> ${plan.pi.to}: Jig ${plan.target} needs the newer Pi.`);
    }
    for (const note of plan.piNotes) lines.push(note);
    if (plan.piCopy?.needed === true) {
        lines.push(`Pi's Jig copy ${plan.piCopy.from ?? "(version unknown)"} -> ${plan.piCopy.to}.`);
    }
    if (plan.global?.needed === true) {
        lines.push(`The jig command ${plan.global.from ?? "(version unknown)"} -> ${plan.global.to}.`);
    }
    for (const warning of plan.warnings) lines.push(warning);
    return lines;
}
