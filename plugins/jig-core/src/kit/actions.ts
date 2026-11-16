// One shape for an action-based tool: its action table, the refusal for an unknown action, the usage line and the
// action list in the schema. Every plugin's actions go through here, so the words the model reads cannot drift.
export interface ActionSpec {
    /** A few words for the tool's action list. */
    summary: string;
    /** Parameters the action needs. */
    required?: readonly string[];
    /** Parameters the action also accepts. */
    optional?: readonly string[];
}

export type ActionTable = Readonly<Record<string, ActionSpec>>;

/** `{paths, message, repo?}`: required names bare, optional ones marked with `?`. */
function signature(spec: ActionSpec): string {
    return `{${[...(spec.required ?? []), ...(spec.optional ?? []).map((name) => `${name}?`)].join(", ")}}`;
}

export function usageLine(tool: string, action: string, spec: ActionSpec): string {
    return `Usage: ${tool} ${action} ${signature(spec)}`;
}

/** The one refusal for an action a tool does not have, ending in a Usage line that lists the valid actions. */
export function unknownAction(tool: string, action: unknown, actions: readonly string[]): string {
    let listed = [...actions];
    while (listed.length > 1 && listed.join(", ").length > 100) listed = listed.slice(0, -1);
    const suffix = listed.length < actions.length ? ", ..." : "";
    return `${tool}: unknown action ${JSON.stringify(String(action).slice(0, 40))}. Usage: ${tool} <action> (${listed.join(", ")}${suffix})`;
}

/**
 * Refuses a call whose parameters do not fit its action, and returns the action. A parameter whose value is
 * `undefined` counts as absent. The checks run in this order: the action, the parameters it does not use, the missing
 * required ones. Each message ends with the usage line, so the model can correct the call at once.
 */
export function checkParams(tool: string, table: ActionTable, params: object): string {
    const input = params as Record<string, unknown>;
    const action = input.action;
    if (typeof action !== "string" || !Object.hasOwn(table, action)) {
        throw new Error(unknownAction(tool, action, Object.keys(table)));
    }
    const spec = table[action] as ActionSpec;
    const usage = usageLine(tool, action, spec);
    const accepted = new Set<string>([
        "action",
        ...(spec.required ?? []),
        ...(spec.optional ?? []).map((name) => name),
    ]);
    for (const [name, value] of Object.entries(input)) {
        if (value !== undefined && !accepted.has(name))
            throw new Error(`${tool} ${action} does not use ${name}. ${usage}`);
    }
    const missing = (spec.required ?? []).filter((name) => input[name] === undefined);
    if (missing.length > 0) throw new Error(`${tool} ${action} needs ${missing.join(", ")}. ${usage}`);
    return action;
}

/** One line per action with its summary, in table order, for the `action` parameter's description. */
export function describeActions(table: ActionTable): string {
    return Object.entries(table)
        .map(([action, spec]) => `- ${action}: ${spec.summary}`)
        .join("\n");
}

/** The one sentence for a preview whose world changed before the write was sent. `detail` says what moved. */
export function previewChanged(label: string, detail?: string): string {
    return `${label}: changed since the preview${detail === undefined ? "" : ` (${detail})`}. Nothing was changed; run it again to see the new preview.`;
}

/** An action list for a schema description, without a summary per action. */
export function actionList(actions: readonly string[]): string {
    return actions.join(", ");
}
