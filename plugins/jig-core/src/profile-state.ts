// Applying profiles to the running state: which registered companies are active, what the active one contributes, the
// merged skills and the per-turn skill list. profiles.ts decides which company; this file does what follows. The three
// seams: `settleProfile` (called when jig.json has been read), `syncSkills` (session start, and the first turn that sees a
// different skill list) and `beforeTurn` (the `before_agent_start` hook).
import { emptyAdditions, mergeAdditions } from "./config.ts";
import type { CompanyAdditions } from "./config.ts";
import { errorMessage } from "./errors.ts";
import { applyToPrompt, syncOverlays } from "./overlays.ts";
import type { SkillRef } from "./overlays.ts";
import { chooseProfile, PROFILE_SECTION, PROFILES_SECTION, profileEntries } from "./profiles.ts";
import type { Selection } from "./profiles.ts";
import type { JigState } from "./state.ts";

/** A company plugin that registered with `profiles.register`, and everything it gave through its view of the API. */
export interface CompanyEntry {
    name: string;
    displayName: string;
    overlays: string | undefined;
    skills: string[];
    onChange: ((active: boolean) => void) | undefined;
    additions: CompanyAdditions;
    defaults: Map<string, unknown>;
    statusLines: Map<string, () => readonly string[]>;
    /** What `onChange` was last told; undefined before the first time. */
    announced: boolean | undefined;
}

export interface ProfileState {
    selection: Selection;
    /** `/profile <name>` of this session (restored from the session file when it starts). */
    session: string | undefined;
    /** Skill name to the merged SKILL.md the prompt uses. */
    merged: Map<string, string>;
    notes: string[];
    /** What the last merge was made from, so a turn merges again only when the skill list is different. */
    syncKey: string;
}

export function newProfileState(): ProfileState {
    return {
        selection: { reason: "none", profile: undefined, plugin: undefined, why: "profiles are not read yet" },
        session: undefined,
        merged: new Map(),
        notes: [],
        syncKey: "",
    };
}

/** The company entry that is active now, if any. */
export function activeCompany(state: JigState): CompanyEntry | undefined {
    const plugin = state.profile.selection.plugin;
    return plugin === undefined ? undefined : state.companies.get(plugin);
}

/** The company defaults that lie under the user's sections now: those of plugins that never registered, then the active company's. */
export function effectiveDefaults(state: JigState): Map<string, unknown> {
    const defaults = new Map(state.sectionDefaults);
    for (const [name, value] of activeCompany(state)?.defaults ?? []) defaults.set(name, value);
    return defaults;
}

/** Rebuilds `state.company` (what policy and secrets read): the additions of plugins that never registered, and the active company's. */
export function refreshCompany(state: JigState): void {
    const active = activeCompany(state);
    state.company = mergeAdditions(
        active === undefined ? [state.globalCompany] : [state.globalCompany, active.additions],
    );
    state.invalidatePolicy();
}

export function newCompanyEntry(name: string, displayName: string): CompanyEntry {
    return {
        name,
        displayName,
        overlays: undefined,
        skills: [],
        onChange: undefined,
        additions: emptyAdditions(),
        defaults: new Map(),
        statusLines: new Map(),
        announced: undefined,
    };
}

/**
 * Chooses the active company from what jig.json says (read just now), and makes the state follow. Returns true when the
 * choice is not the one the file was read with: the caller reads the file again, because the company's section defaults lie
 * under it. Companies whose active state changed are told once the caller has read the file the second time (`announce`).
 */
export function settleProfile(state: JigState): boolean {
    const { sections, invalid } = state.personal;
    const bad = [PROFILES_SECTION, PROFILE_SECTION].find((name) => invalid.has(name));
    const before = state.profile.selection.plugin;
    let selection: Selection;
    if (bad !== undefined) {
        selection = {
            reason: "none",
            profile: undefined,
            plugin: undefined,
            why: `the "${bad}" section of jig.json is not valid (see /jig), so no company is active`,
        };
    } else {
        const setting = sections.get(PROFILE_SECTION);
        selection = chooseProfile({
            profiles: sections.has(PROFILES_SECTION) ? profileEntries(sections.get(PROFILES_SECTION)) : undefined,
            setting: typeof setting === "string" ? setting : "auto",
            session: state.profile.session,
            registered: [...state.companies.keys()],
            cwd: state.workingDir === "" ? process.cwd() : state.workingDir,
        });
    }
    state.profile.selection = selection;
    refreshCompany(state);
    return selection.plugin !== before;
}

/** Tells each company plugin whether it is active, the first time and whenever it changes. A plugin's failure is a start-up problem. */
export function announce(state: JigState): void {
    for (const company of state.companies.values()) {
        const active = state.profile.selection.plugin === company.name;
        if (company.announced === active) continue;
        company.announced = active;
        try {
            company.onChange?.(active);
        } catch (error) {
            state.startupProblems.push(`${company.name}: onChange failed: ${errorMessage(error)}`);
        }
    }
}

/** The names of skills that belong to companies that are not active. */
function dormantSkills(state: JigState): Set<string> {
    const active = activeCompany(state);
    const dormant = new Set<string>();
    for (const company of state.companies.values())
        if (company !== active) for (const name of company.skills) dormant.add(name);
    for (const name of active?.skills ?? []) dormant.delete(name);
    return dormant;
}

/**
 * Writes the merged copies for the active company from the generic skills Pi loaded. Does nothing when the same skills were
 * merged already. With no active company or no overlays, the merged set is empty (the copies of an earlier company stay on
 * disk; they are not in the prompt).
 */
export function syncSkills(state: JigState, skills: readonly SkillRef[]): void {
    const active = activeCompany(state);
    const profile = state.profile.selection.profile;
    if (active === undefined || profile === undefined || active.overlays === undefined) {
        state.profile.merged = new Map();
        state.profile.notes = [];
        state.profile.syncKey = "";
        return;
    }
    const key = `${profile}\n${active.overlays}\n${skills
        .map((skill) => `${skill.name}=${skill.filePath}`)
        .sort()
        .join("\n")}`;
    if (key === state.profile.syncKey) return;
    const result = syncOverlays(profile, { folder: active.overlays, display: active.displayName }, skills);
    state.profile.merged = result.merged;
    state.profile.notes = result.notes;
    state.profile.syncKey = key;
}

/** The skills Pi lists as commands (`skill:<name>`), as far as Pi tells at session start. */
export function loadedSkills(state: JigState): SkillRef[] {
    try {
        return state.pi
            .getCommands()
            .filter((command) => command.source === "skill" && /^skill:[a-z0-9-]+$/.test(command.name))
            .map((command) => ({ name: command.name.slice("skill:".length), filePath: command.sourceInfo.path }));
    } catch {
        return [];
    }
}

/** `before_agent_start`: the skill list of this turn. Edits the options' list by assigning a new one (Pi's skill objects stay as they are). */
export function beforeTurn(state: JigState, options: { skills?: SkillRef[] }): void {
    if (!Array.isArray(options.skills)) return;
    try {
        const generic = options.skills.filter(
            (skill) => typeof skill?.name === "string" && typeof skill.filePath === "string",
        );
        syncSkills(state, generic);
        options.skills = applyToPrompt(options.skills, state.profile.merged, dormantSkills(state));
    } catch (error) {
        const problem = `skill overlays failed: ${errorMessage(error)}`;
        if (!state.startupProblems.includes(problem)) state.startupProblems.push(problem);
    }
}
