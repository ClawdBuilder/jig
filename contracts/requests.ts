// Requests from a reader: turn a tool or a skill on or off for this session, or reload Pi when it is idle. A reader (the
// Context panel of the Herdr app files) writes one request file, `<state dir>/requests/<file name of the session>.json`, by a
// temporary file and a rename; the session takes it (a rename, so a newer request is never lost), applies what it names
// and knows, and writes the outcome into its status file as `lastRequest`. Nothing else can be asked: a request never
// approves a call and never changes jig-core's rules, which still decide every call of a tool turned on here.
import { randomBytes } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync } from "node:fs";
import path from "node:path";

export const REQUEST_SCHEMA = 1;
/** A request file larger than this is refused unread. */
export const MAX_REQUEST_BYTES = 64 * 1024;
/** The custom entry that keeps this session's switches, so a reload or a resume keeps them. */
export const SWITCHES_ENTRY = "jig-session.switches";

/** The folder of the request files: `<state dir>/requests`. */
export const requestsDir = (state: string): string => path.join(state, "requests");

export interface Request {
    schema: typeof REQUEST_SCHEMA;
    /** The reader's id for this request, echoed in `lastRequest`. */
    id: string | null;
    /** Tool name to on (true) or off (false). */
    tools: Record<string, boolean>;
    /** Skill name to on or off. */
    skills: Record<string, boolean>;
    /** Reload Pi (extensions, skills, prompts, context files) as soon as it is idle. */
    reload: boolean;
}

export interface Outcome {
    id: string | null;
    ok: boolean;
    message: string;
    at: string;
    /** `waiting` until Pi reloads, then `done`. Absent when no reload was asked. */
    reload?: "waiting" | "done";
}

const ID = /^[A-Za-z0-9._:-]{1,100}$/;
const NAME = /^[A-Za-z0-9_.:/-]{1,128}$/;
type Rec = Record<string, unknown>;
const isRec = (value: unknown): value is Rec => typeof value === "object" && value !== null && !Array.isArray(value);

/** A request file's text as a request, or the reason it is refused. Fields it does not know are ignored. */
export function parseRequest(text: string): { request?: Request; error?: string } {
    let raw: unknown;
    try {
        raw = JSON.parse(text);
    } catch {
        return { error: "the request is not JSON" };
    }
    if (!isRec(raw)) return { error: "the request is not an object" };
    if (raw.schema !== REQUEST_SCHEMA) return { error: `the request's schema is not ${REQUEST_SCHEMA}` };
    const id = typeof raw.id === "string" && ID.test(raw.id) ? raw.id : null;
    const switches = (field: string): Record<string, boolean> | string => {
        const value = raw[field];
        if (value === undefined) return {};
        if (!isRec(value)) return `"${field}" must map names to true or false`;
        const out: Record<string, boolean> = {};
        for (const [name, on] of Object.entries(value)) {
            if (typeof on !== "boolean" || !NAME.test(name)) return `"${field}" must map names to true or false`;
            out[name] = on;
        }
        return out;
    };
    const tools = switches("tools");
    const skills = switches("skills");
    if (typeof tools === "string") return { error: tools };
    if (typeof skills === "string") return { error: skills };
    if (raw.reload !== undefined && typeof raw.reload !== "boolean") return { error: '"reload" must be true or false' };
    return { request: { schema: REQUEST_SCHEMA, id, tools, skills, reload: raw.reload === true } };
}

/**
 * Takes the request file when there is one: renames it to a name of this process, reads it and removes it. A reader that
 * writes a newer request meanwhile writes a new file, taken at the next look. Returns the text, `null` for a file too large
 * to read, or undefined when there is none.
 */
export function takeRequest(file: string): string | null | undefined {
    const taken = `${file}.${process.pid}.${randomBytes(4).toString("hex")}.taking`;
    try {
        renameSync(file, taken);
    } catch {
        return undefined;
    }
    try {
        if (statSync(taken).size > MAX_REQUEST_BYTES) return null;
        return readFileSync(taken, "utf8");
    } catch {
        return undefined;
    } finally {
        rmSync(taken, { force: true });
    }
}

/** Makes the requests folder, private, so a reader can write into it. */
export function ensureRequestsDir(dir: string): void {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
}

/**
 * Removes request files no session will take: those whose session has no status file (`live` says which names have one),
 * and leftovers older than a minute (`.tmp` a reader left, `.taking` of a Pi that stopped). `keep` is never removed.
 */
export function sweepRequests(dir: string, live: (name: string) => boolean, keep: string, now = Date.now()): string[] {
    let names: string[];
    try {
        names = readdirSync(dir);
    } catch {
        return [];
    }
    const removed: string[] = [];
    for (const name of names) {
        if (name === keep) continue;
        const file = path.join(dir, name);
        let old = false;
        try {
            old = now - statSync(file).mtimeMs > 60_000;
        } catch {
            continue;
        }
        const stray = name.endsWith(".json") ? !live(name) : old;
        if (stray) {
            rmSync(file, { force: true });
            removed.push(name);
        }
    }
    return removed;
}

/** What the switches need of Pi. */
export interface SwitchHost {
    /** Tools that can be declared to the model: `pi.getAllTools()` less the `hidden` ones. */
    toolNames(): string[];
    activeTools(): string[];
    setActiveTools(names: string[]): void;
    /** The loaded skills' names. */
    skillNames(): string[];
}

export interface Saved {
    tools: Record<string, boolean>;
    skillsOff: string[];
}

/** The session's own switches: the tools and skills turned on or off by request. */
export class Switches {
    /** Each tool's last switch by request, applied again after a reload or a resume. */
    tools: Record<string, boolean> = {};
    readonly skillsOff = new Set<string>();

    reset(): void {
        this.tools = {};
        this.skillsOff.clear();
    }

    saved(): Saved {
        return { tools: { ...this.tools }, skillsOff: [...this.skillsOff].sort() };
    }

    /** Takes the switches the session saved last (`SWITCHES_ENTRY` entries of its branch). */
    restore(entries: readonly unknown[]): boolean {
        this.reset();
        for (let i = entries.length - 1; i >= 0; i--) {
            const entry = entries[i];
            if (!isRec(entry) || entry.type !== "custom" || entry.customType !== SWITCHES_ENTRY) continue;
            const data = isRec(entry.data) ? entry.data : {};
            for (const [name, on] of Object.entries(isRec(data.tools) ? data.tools : {}))
                if (typeof on === "boolean" && NAME.test(name)) this.tools[name] = on;
            for (const name of Array.isArray(data.skillsOff) ? data.skillsOff : [])
                if (typeof name === "string" && NAME.test(name)) this.skillsOff.add(name);
            return true;
        }
        return false;
    }

    /** Applies the saved tool switches to the active set; tools that are not there are left out. */
    applyTools(host: SwitchHost): void {
        const known = new Set(host.toolNames());
        const active = new Set(host.activeTools());
        let changed = false;
        for (const [name, on] of Object.entries(this.tools)) {
            if (!known.has(name) || active.has(name) === on) continue;
            if (on) active.add(name);
            else active.delete(name);
            changed = true;
        }
        if (changed) host.setActiveTools([...active]);
    }

    /**
     * Applies a request's switches. Unknown names are ignored and named in the message; nothing else changes. Returns
     * whether anything changed (to save) and the message for `lastRequest`.
     */
    apply(request: Request, host: SwitchHost): { ok: boolean; changed: boolean; message: string } {
        const said: string[] = [];
        const unknown: string[] = [];
        let changed = false;

        const known = new Set(host.toolNames());
        const before = host.activeTools();
        const active = new Set(before);
        const asked: Array<[string, boolean]> = [];
        for (const [name, on] of Object.entries(request.tools)) {
            if (!known.has(name)) {
                unknown.push(name);
                continue;
            }
            asked.push([name, on]);
            if (on) active.add(name);
            else active.delete(name);
        }
        if (asked.length > 0) {
            if (active.size !== before.length || before.some((name) => !active.has(name)))
                host.setActiveTools([...active]);
            const now = new Set(host.activeTools());
            const refused: string[] = [];
            for (const [name, on] of asked) {
                if (now.has(name) !== on) {
                    refused.push(name);
                    continue;
                }
                if (this.tools[name] !== on) changed = true;
                this.tools[name] = on;
                said.push(`${name} ${on ? "on" : "off"}`);
            }
            if (refused.length > 0) said.push(`Pi kept ${refused.join(", ")} as it was`);
        }

        const skills = new Set(host.skillNames());
        for (const [name, on] of Object.entries(request.skills)) {
            if (!skills.has(name)) {
                unknown.push(name);
                continue;
            }
            if (this.skillsOff.has(name) === !on) {
                said.push(`skill ${name} already ${on ? "on" : "off"}`);
                continue;
            }
            if (on) this.skillsOff.delete(name);
            else this.skillsOff.add(name);
            changed = true;
            said.push(`skill ${name} ${on ? "on" : "off"} from the next turn`);
        }

        if (unknown.length > 0) said.push(`ignored, not in this session: ${unknown.join(", ")}`);
        const asked_any = Object.keys(request.tools).length + Object.keys(request.skills).length > 0;
        const nothingKnown =
            asked_any && unknown.length === Object.keys(request.tools).length + Object.keys(request.skills).length;
        return { ok: !nothingKnown, changed, message: said.join("; ") };
    }

    /** Leaves the skills that are off out of a turn's prompt options (`before_agent_start`). */
    filterSkills(options: { skills?: Array<{ name: string }> }): void {
        if (this.skillsOff.size === 0 || !Array.isArray(options.skills)) return;
        options.skills = options.skills.filter((skill) => !this.skillsOff.has(skill.name));
    }
}
