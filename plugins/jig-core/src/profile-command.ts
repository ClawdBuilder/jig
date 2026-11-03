// `/profile`: shows which company is active and why, and `/profile <name>` chooses one for this session. The choice is an entry
// in the session file (never shown to the model), so a reload, which the command runs when the agent is idle, and a resume
// keep it. `/profile auto` drops it; `/profile none` turns every company off.
import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { PROFILES_SECTION, profileEntries } from "./profiles.ts";
import type { JigState } from "./state.ts";

export const PROFILE_ENTRY = "jig-profile";

/** The profile this session chose with `/profile`, from the last entry on the branch. Undefined when there is none. */
export function restoreSessionProfile(ctx: ExtensionContext): string | undefined {
    let branch: readonly unknown[];
    try {
        branch = ctx.sessionManager.getBranch();
    } catch {
        return undefined;
    }
    for (let i = branch.length - 1; i >= 0; i--) {
        const entry = branch[i] as { type?: string; customType?: string; data?: { name?: unknown } } | undefined;
        if (entry?.type !== "custom" || entry.customType !== PROFILE_ENTRY) continue;
        return typeof entry.data?.name === "string" ? entry.data.name : undefined;
    }
    return undefined;
}

/** The one line `/jig` shows. */
export function profileLine(state: JigState): string {
    const { selection } = state.profile;
    const label =
        selection.profile === undefined
            ? "none"
            : selection.profile === selection.plugin
              ? selection.profile
              : `${selection.profile} (${selection.plugin})`;
    return `Profile: ${label}: ${selection.why}`;
}

/** The lines `/profile` shows. */
export function profileLines(state: JigState): string[] {
    const { selection } = state.profile;
    const lines = [profileLine(state)];
    const configured = state.personal.sections.has(PROFILES_SECTION)
        ? profileEntries(state.personal.sections.get(PROFILES_SECTION))
        : [];
    if (configured.length > 0) {
        lines.push(
            `Profiles in jig.json: ${configured
                .map(
                    (entry) =>
                        `${entry.label} -> ${entry.plugin}${state.companies.has(entry.plugin) ? "" : " (not loaded)"}${entry.label === selection.profile ? " [active]" : ""}`,
                )
                .join(", ")}`,
        );
    }
    if (state.companies.size > 0) {
        lines.push(
            `Company plugins loaded: ${[...state.companies.values()]
                .map((company) => `${company.name} (${company.name === selection.plugin ? "active" : "dormant"})`)
                .join(", ")}`,
        );
    }
    if (state.profile.merged.size > 0) {
        lines.push(`Skills with company rules: ${[...state.profile.merged.keys()].join(", ")}`);
    }
    for (const note of state.profile.notes) lines.push(`Note: ${note}`);
    if (state.profile.session !== undefined)
        lines.push("Chosen for this session. /profile auto goes back to jig.json.");
    lines.push("Usage: /profile, /profile <name>, /profile none, /profile auto");
    return lines;
}

export function registerProfileCommand(pi: ExtensionAPI, state: JigState): void {
    pi.registerCommand("profile", {
        description: "Which company's setup is active and why; /profile <name> chooses one for this session",
        getArgumentCompletions: (prefix) => {
            const names = [
                "auto",
                "none",
                ...profileEntries(state.personal.sections.get(PROFILES_SECTION)).map((entry) => entry.label),
            ];
            const matches = names.filter((name) => name.startsWith(prefix));
            return matches.length === 0 ? null : matches.map((name) => ({ value: name, label: name }));
        },
        handler: async (args, ctx) => {
            const word = args.trim();
            if (word === "") return show(ctx, profileLines(state));
            if (/\s/.test(word)) return show(ctx, ["Usage: /profile, /profile <name>, /profile none, /profile auto"]);
            const known = profileEntries(state.personal.sections.get(PROFILES_SECTION)).map((entry) => entry.label);
            if (word !== "auto" && word !== "none" && !known.includes(word)) {
                return show(ctx, [
                    `No profile "${word.slice(0, 40)}" in jig.json. ${known.length === 0 ? "It has no profiles." : `Profiles: ${known.join(", ")}.`}`,
                ]);
            }
            const name = word === "auto" ? undefined : word;
            state.profile.session = name;
            pi.appendEntry(PROFILE_ENTRY, { name: name ?? null });
            // The plugins read their sections when a session starts, so the new company takes effect with a reload.
            if (typeof ctx.reload !== "function") {
                return show(ctx, [`Profile set to ${word} for this session. Reload (/reload) to apply it.`]);
            }
            ctx.ui.notify(`Profile set to ${word}; reloading.`, "info");
            await ctx.waitForIdle();
            await ctx.reload();
        },
    });
}

function show(ctx: ExtensionCommandContext, lines: string[]): void {
    ctx.ui.notify(lines.join("\n"), "info");
}
