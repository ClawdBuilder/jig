// The tools a stage switches on. A stage may name tools (`"tools": ["deploy"]`): when the work enters the stage they are
// added to Pi's active set, and when it leaves they are taken out again, but only the ones this plugin added, and never one
// the user switched on meanwhile (`jig-session`'s switches). A deferred tool can be activated like any other, so a stage
// can bring in a tool that `tools.deferred` keeps out of the context the rest of the time.
//
// What was added is kept in the session (a custom entry), so a reload or a resume knows which tools are the stage's and
// which were on anyway.

/** The custom entry that keeps the stage this session last set tools for, and the tools it added. */
export const STAGE_TOOLS_ENTRY = "jig-workflow.stage-tools";
/** `jig-session`'s custom entry with the tools the user switched on or off. Read only. */
export const SWITCHES_ENTRY = "jig-session.switches";

/** The stage the work is in, as far as its tools go. `key` names the ticket, the workflow and the stage. */
export interface StageInPlay {
    key: string;
    stage: string;
    tools: readonly string[];
}

/** What the stage tools need of Pi and the session. */
export interface ToolHost {
    /** Every tool that can be activated: registered and not `hidden`. */
    toolNames(): string[];
    activeTools(): string[];
    setActiveTools(names: string[]): void;
    /** The session's entries on the current branch, oldest first. */
    entries(): readonly unknown[];
    /** Keeps a custom entry in the session. */
    save(data: SavedStageTools): void;
    notify(text: string): void;
}

export interface SavedStageTools {
    stage: string | null;
    added: string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The latest custom entry of a type on the branch, or undefined. */
function latest(entries: readonly unknown[], customType: string): Record<string, unknown> | undefined {
    for (let i = entries.length - 1; i >= 0; i--) {
        const entry = entries[i];
        if (isRecord(entry) && entry.type === "custom" && entry.customType === customType)
            return isRecord(entry.data) ? entry.data : {};
    }
    return undefined;
}

/** The tools the user switched on (true) or off (false) through `jig-session`, as it saved them last. */
export function userSwitches(entries: readonly unknown[]): Map<string, boolean> {
    const data = latest(entries, SWITCHES_ENTRY);
    const tools = isRecord(data?.tools) ? data.tools : {};
    return new Map(
        Object.entries(tools).flatMap(([name, on]) => (typeof on === "boolean" ? [[name, on] as const] : [])),
    );
}

/** The stage tools this session saved last. */
export function savedStageTools(entries: readonly unknown[]): SavedStageTools | undefined {
    const data = latest(entries, STAGE_TOOLS_ENTRY);
    if (data === undefined) return undefined;
    const added = Array.isArray(data.added)
        ? data.added.filter((name): name is string => typeof name === "string")
        : [];
    return { stage: typeof data.stage === "string" ? data.stage : null, added };
}

/** The session's stage tools: which stage they were set for, and which tools this plugin added. */
export class StageTools {
    private key: string | null = null;
    private added: string[] = [];
    private readonly noticed = new Set<string>();
    /** Set by a start: the first prompt checks again, after every plugin's start (a plugin that defers its tools runs later). */
    private settling = false;

    /** What it added, for a test or a status line. */
    get current(): SavedStageTools {
        return { stage: this.key, added: [...this.added] };
    }

    /**
     * Brings the active set in line with the stage. `starting` is a session start (new, resumed or reloaded): what the
     * session saved is read back, and the tools it added for a stage it is still in are made active again unless the user
     * switched them off. The next call checks that once more, since other plugins start after this one.
     */
    sync(host: ToolHost, stage: StageInPlay | undefined, starting: boolean): void {
        const entries = host.entries();
        const settling = starting || this.settling;
        this.settling = starting;
        if (starting) {
            const saved = savedStageTools(entries);
            this.key = saved?.stage ?? null;
            this.added = saved?.added ?? [];
        }
        const switches = userSwitches(entries);
        const key = stage?.key ?? null;
        if (key === this.key) {
            if (settling) this.restore(host, switches);
            return;
        }
        this.move(host, stage, switches);
    }

    /** The same stage after a start: the tools it added that are off again are switched back on, unless the user turned them off. */
    private restore(host: ToolHost, switches: ReadonlyMap<string, boolean>): void {
        const known = new Set(host.toolNames());
        const active = host.activeTools();
        const missing = this.added.filter(
            (name) => known.has(name) && !active.includes(name) && switches.get(name) !== false,
        );
        if (missing.length > 0) host.setActiveTools([...active, ...missing]);
    }

    /** Leaves the stage it set tools for, and enters `stage`. */
    private move(host: ToolHost, stage: StageInPlay | undefined, switches: ReadonlyMap<string, boolean>): void {
        const known = new Set(host.toolNames());
        const before = host.activeTools();
        const wanted: string[] = [];
        for (const name of stage?.tools ?? []) {
            if (known.has(name)) wanted.push(name);
            else if (!this.noticed.has(name)) {
                this.noticed.add(name);
                host.notify(
                    `jig-workflow: the stage ${stage?.stage ?? ""} names the tool ${name}, which this session does not have (ignored)`,
                );
            }
        }
        // Leaving: what this plugin added goes, unless the next stage wants it too or the user switched it on.
        const leaving = new Set(this.added.filter((name) => !wanted.includes(name) && switches.get(name) !== true));
        const next = before.filter((name) => !leaving.has(name));
        // Entering: a tool that is on already is the user's (or was on anyway), unless this plugin added it for the last stage.
        const ours = wanted.filter((name) => !before.includes(name) || this.added.includes(name));
        for (const name of wanted) if (!next.includes(name)) next.push(name);
        if (next.length !== before.length || next.some((name) => !before.includes(name))) host.setActiveTools(next);
        // Pi may keep a tool off (an allow-list on its command line): only what is active now counts as added.
        const now = new Set(host.activeTools());
        this.key = stage?.key ?? null;
        this.added = ours.filter((name) => now.has(name));
        host.save({ stage: this.key, added: [...this.added] });
    }
}
