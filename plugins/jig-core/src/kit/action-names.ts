// Action names Jig renamed in 0.4.0, from the hyphenated form to snake_case, as function-calling tools and MCP write them.
// The old names stopped applying in 0.5.5. This map only lets /jig and the doctor name an old name and its replacement;
// it no longer matches a call. Tool names are unchanged.
export const RENAMED_ACTIONS: Readonly<Record<string, Readonly<Record<string, string>>>> = {
    api: { "run-folder": "run_folder", "postman-environments": "postman_environments" },
    mongo: { "index-stats": "index_stats", "create-index": "create_index", "drop-index": "drop_index" },
    ticket: {
        "save-evidence": "save_evidence",
        "add-check": "add_check",
        "list-checks": "list_checks",
        "close-check": "close_check",
    },
    workflow: { "submit-plan": "submit_plan" },
};

/** The name an action has today. Old names are only named by the diagnostics below; they no longer match. */
export function canonicalAction(_tool: string, action: string): string {
    return action;
}

/** The rename behind an old action name, for a message, or undefined when the name is current. */
export function renamedAction(tool: string, action: string | undefined): { from: string; to: string } | undefined {
    if (action === undefined) return undefined;
    const to = RENAMED_ACTIONS[tool]?.[action];
    return to === undefined ? undefined : { from: action, to };
}

/** Every rule and classification rule in a configuration that still names an old action, once each. */
export function renamedInRules(
    rules: readonly { tool: string; action?: string }[],
): Array<{ tool: string; from: string; to: string }> {
    const out: Array<{ tool: string; from: string; to: string }> = [];
    const seen = new Set<string>();
    for (const rule of rules) {
        const renamed = renamedAction(rule.tool, rule.action);
        if (renamed === undefined) continue;
        const key = `${rule.tool}.${renamed.from}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({ tool: rule.tool, ...renamed });
    }
    return out;
}
