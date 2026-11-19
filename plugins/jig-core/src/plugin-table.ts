// The built-in plugins as one table: each plugin's folder, its feature name, the `jig.json` section it registers and
// whether the terminal doctor counts it as always on. The terminal reads it to see which plugins Pi's settings leave out
// (cli/headless.ts); a session reads it to see which sections belong to a plugin that did not load (index.ts), because
// a section kept in `jig.json` for a plugin that is off is not an unknown field.

/** One built-in plugin. */
export interface PluginEntry {
    feature: string;
    section?: string;
    alwaysOn?: boolean;
}

/** Every built-in plugin, its feature name, the section it validates and whether it is always on. */
export const FEATURES: Readonly<Record<string, PluginEntry>> = {
    "jig-core": { feature: "core", alwaysOn: true },
    "jig-sandbox": { feature: "sandbox", section: "sandbox", alwaysOn: true },
    "jig-git": { feature: "git", section: "git", alwaysOn: true },
    "jig-memory": { feature: "memory", section: "memory", alwaysOn: true },
    "jig-session": { feature: "session", section: "session", alwaysOn: true },
    "jig-theme": { feature: "theme", section: "theme", alwaysOn: true },
    "jig-jira": { feature: "jira", section: "jira" },
    "jig-logs": { feature: "logs", section: "logs" },
    "jig-mongo": { feature: "mongo", section: "mongo" },
    "jig-api": { feature: "api", section: "api" },
    "jig-ops": { feature: "ops", section: "ops" },
    "jig-review": { feature: "review", section: "review" },
    "jig-agents": { feature: "agents", section: "agents" },
    "jig-workflow": { feature: "workflow", section: "workflow" },
    "jig-lens": { feature: "lens", section: "lens" },
};

/**
 * The table's sections that no loaded plugin registered: those plugins are off in this session. Plugins register their
 * section in their factory, which Pi runs before `session_start`, so the section of a plugin that loaded is never in it.
 */
export function offSectionsOf(registered: Iterable<string>): Set<string> {
    const loaded = new Set(registered);
    const off = new Set<string>();
    for (const { section } of Object.values(FEATURES)) {
        if (section !== undefined && !loaded.has(section)) off.add(section);
    }
    return off;
}
