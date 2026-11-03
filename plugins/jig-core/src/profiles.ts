// Profiles: which company's setup applies to the work at hand. The `profiles` and `profile` sections of jig.json name the
// profiles and say when each applies (a folder, a git remote); a company plugin registers under a name (`profiles.register`
// in the API), and a profile points at it with `plugin`. This file checks the sections and chooses; state.ts applies the
// choice (docs/profiles.md in this plugin says what applying means).
//
// The choice, first rule that fits:
//   1. `/profile <name>` in this session (kept as an entry in the session file, so a reload keeps it)
//   2. `"profile": "<name>"` in jig.json (`"none"` means no company)
//   3. `"profile": "auto"` (the default): the first profile whose `when.folders` matches the working folder or whose
//      `when.remotes` matches the folder's `origin` remote
//   4. with no `profiles` section at all and exactly one company registered: that company, as before profiles existed
//   5. otherwise no company
import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { isObject } from "./kit/values.ts";

export const PROFILES_SECTION = "profiles";
export const PROFILE_SECTION = "profile";

const LABEL = /^[A-Za-z0-9][A-Za-z0-9._-]{0,39}$/;
const PLUGIN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const MAX_PROFILES = 50;
const MAX_PATTERNS = 50;
const MAX_PATTERN_CHARS = 300;

/** One entry of `profiles` as checked. */
export interface ProfileEntry {
    /** The name of the profile, the key in the file: what `/profile` takes. */
    label: string;
    /** The company plugin it points at: the name that plugin registered under. */
    plugin: string;
    folders: string[];
    remotes: string[];
}

/** Why a company is active, for `/profile`. */
export type SelectionReason = "session" | "explicit" | "folder" | "remote" | "sole" | "none";

export interface Selection {
    reason: SelectionReason;
    /** The profile's name (the sole company's registered name for `sole`); undefined when none is active. */
    profile: string | undefined;
    /** The registered company name; undefined when none is active. */
    plugin: string | undefined;
    /** A sentence that says why, with the pattern that matched. */
    why: string;
}

export function validateProfilesSection(raw: unknown): string[] {
    if (!isObject(raw))
        return [`${PROFILES_SECTION} must be an object of profiles, such as { "acme": { "plugin": "jig-acme" } }`];
    const errors: string[] = [];
    const names = Object.keys(raw);
    if (names.length > MAX_PROFILES) return [`${PROFILES_SECTION} may hold at most ${MAX_PROFILES} profiles`];
    for (const label of names) {
        const at = `${PROFILES_SECTION}.${label.replace(/[^\x20-\x7e]/g, "?").slice(0, 40)}`;
        if (!LABEL.test(label) || label === "auto" || label === "none") {
            errors.push(
                `${at}: a profile name is letters, digits, dots, dashes and underscores, and is not "auto" or "none"`,
            );
            continue;
        }
        const entry = raw[label];
        if (!isObject(entry)) {
            errors.push(
                `${at} must be an object such as { "plugin": "jig-acme", "when": { "folders": ["~/work/acme/**"] } }`,
            );
            continue;
        }
        for (const key of Object.keys(entry))
            if (key !== "plugin" && key !== "when") errors.push(`${at}.${key}: unknown field`);
        if (typeof entry.plugin !== "string" || !PLUGIN.test(entry.plugin)) {
            errors.push(`${at}.plugin must be the name the company plugin registered under, such as "jig-acme"`);
        }
        if (entry.when === undefined) continue;
        if (!isObject(entry.when)) {
            errors.push(`${at}.when must be an object such as { "folders": ["~/work/acme/**"] }`);
            continue;
        }
        for (const key of Object.keys(entry.when)) {
            if (key !== "folders" && key !== "remotes") errors.push(`${at}.when.${key}: unknown field`);
        }
        for (const key of ["folders", "remotes"] as const) {
            const list = entry.when[key];
            if (list === undefined) continue;
            if (
                !Array.isArray(list) ||
                list.length > MAX_PATTERNS ||
                list.some((item) => typeof item !== "string" || item === "" || item.length > MAX_PATTERN_CHARS)
            ) {
                errors.push(`${at}.when.${key} must be a list of at most ${MAX_PATTERNS} patterns (text, not empty)`);
            }
        }
    }
    return errors;
}

export function validateProfileSection(raw: unknown): string[] {
    if (typeof raw === "string" && (raw === "auto" || raw === "none" || LABEL.test(raw))) return [];
    return [`${PROFILE_SECTION} must be "auto", "none" or the name of a profile`];
}

/** The checked `profiles` section, in file order. Call it with a section that passed `validateProfilesSection`. */
export function profileEntries(section: unknown): ProfileEntry[] {
    if (!isObject(section)) return [];
    const out: ProfileEntry[] = [];
    for (const [label, entry] of Object.entries(section)) {
        if (!isObject(entry) || typeof entry.plugin !== "string") continue;
        const when = isObject(entry.when) ? entry.when : {};
        const list = (value: unknown): string[] =>
            Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
        out.push({ label, plugin: entry.plugin, folders: list(when.folders), remotes: list(when.remotes) });
    }
    return out;
}

// ---- matching -----------------------------------------------------------------------------------------------------------

/** `*` is any run of characters but `/`, `**` any run at all, `?` one character but `/`; a pattern ending `/**` also
 *  matches the folder itself. Case-insensitive on the remote, exact on folders (callers decide). */
export function globToRegExp(pattern: string, flags = ""): RegExp {
    let out = "";
    for (let i = 0; i < pattern.length; i++) {
        const ch = pattern[i] as string;
        if (ch === "*" && pattern[i + 1] === "*") {
            // "/**" at the end also matches the folder itself
            if (pattern[i - 1] === "/" && i + 2 === pattern.length) out = `${out.slice(0, -1)}(?:/.*)?`;
            else out += ".*";
            i++;
        } else if (ch === "*") out += "[^/]*";
        else if (ch === "?") out += "[^/]";
        else out += ch.replace(/[\\^$.*+?()[\]{}|]/g, "\\$&");
    }
    return new RegExp(`^${out}$`, flags);
}

function expandHome(pattern: string, home: string): string {
    if (pattern === "~") return home;
    return pattern.startsWith("~/") ? path.join(home, pattern.slice(2)) : pattern;
}

/** The first folder pattern that matches `cwd` (itself or its real path), or undefined. */
export function matchFolder(patterns: readonly string[], cwd: string, home: string = homedir()): string | undefined {
    if (cwd === "") return undefined;
    const forms = new Set([path.resolve(cwd)]);
    try {
        forms.add(realpathSync(cwd));
    } catch {
        // The folder is gone: the plain form is all there is.
    }
    for (const pattern of patterns) {
        const regexp = globToRegExp(path.resolve(expandHome(pattern, home)).replace(/\\/g, "/"));
        for (const form of forms) if (regexp.test(form.replace(/\\/g, "/"))) return pattern;
    }
    return undefined;
}

/** `git@github.com:acme-org/orders.git`, `https://user@github.com/acme-org/orders.git` and `ssh://git@host:22/a/b` become
 *  `github.com:acme-org/orders`, `github.com:acme-org/orders` and `host:a/b`. Undefined for a local path or nonsense. */
export function normalizeRemote(url: string): string | undefined {
    const text = url.trim();
    const scp = /^(?:[^@/\s]+@)?([^:/\s]+):(?!\/\/)(.+)$/.exec(text);
    let host: string;
    let rest: string;
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(text)) {
        try {
            const parsed = new URL(text);
            host = parsed.hostname;
            rest = parsed.pathname;
        } catch {
            return undefined;
        }
    } else if (scp !== null) {
        host = scp[1] as string;
        rest = scp[2] as string;
    } else return undefined;
    rest = rest
        .replace(/^\/+/, "")
        .replace(/\/+$/, "")
        .replace(/\.git$/, "");
    return host === "" || rest === "" ? undefined : `${host}:${rest}`.toLowerCase();
}

/** The first remote pattern (`github.com:acme-org/*`) that matches the normalized remote, or undefined. */
export function matchRemote(patterns: readonly string[], remote: string | undefined): string | undefined {
    if (remote === undefined) return undefined;
    return patterns.find((pattern) => globToRegExp(pattern.toLowerCase(), "i").test(remote));
}

// ---- reading the remote without a process or the network ------------------------------------------------------------------

/** The folder that holds `.git/config` for `cwd`, going up the tree; a worktree's `.git` file leads to the shared folder. */
function gitConfigFile(cwd: string): string | undefined {
    let dir = path.resolve(cwd);
    for (let depth = 0; depth < 64; depth++) {
        const dot = path.join(dir, ".git");
        try {
            const stat = statSync(dot);
            if (stat.isDirectory()) return path.join(dot, "config");
            if (stat.isFile()) {
                const pointer = /^gitdir:\s*(.+)$/m.exec(readFileSync(dot, "utf8"));
                if (pointer === null) return undefined;
                const gitdir = path.resolve(dir, (pointer[1] as string).trim());
                const common = path.join(gitdir, "commondir");
                if (!existsSync(common)) return path.join(gitdir, "config");
                return path.join(path.resolve(gitdir, readFileSync(common, "utf8").trim()), "config");
            }
        } catch {
            // No .git here: look one level up.
        }
        const parent = path.dirname(dir);
        if (parent === dir) return undefined;
        dir = parent;
    }
    return undefined;
}

/** The `origin` URL of the repository `cwd` is in, read from `.git/config`: `include`s and `insteadOf` are not followed. */
export function originOf(cwd: string): string | undefined {
    if (cwd === "") return undefined;
    try {
        const file = gitConfigFile(cwd);
        if (file === undefined) return undefined;
        let inOrigin = false;
        for (const raw of readFileSync(file, "utf8").split(/\r?\n/)) {
            const line = raw.trim();
            if (line.startsWith("[")) inOrigin = /^\[remote\s+"origin"\]/i.test(line);
            else if (inOrigin) {
                const url = /^url\s*=\s*(.+)$/i.exec(line);
                if (url !== null) return (url[1] as string).trim();
            }
        }
    } catch {
        // An unreadable config is no remote.
    }
    return undefined;
}

// ---- choosing -----------------------------------------------------------------------------------------------------------

export interface ChooseInput {
    /** The checked `profiles` section, or undefined when the file has none. */
    profiles: readonly ProfileEntry[] | undefined;
    /** The `profile` section: "auto" (the default), "none" or a name. */
    setting: string;
    /** `/profile <name>` of this session, if any. */
    session: string | undefined;
    /** The names company plugins registered under. */
    registered: readonly string[];
    cwd: string;
    home?: string;
}

/** Chooses the active profile. Never throws; a bad setting gives no company and says why. */
export function chooseProfile(input: ChooseInput): Selection {
    const entries = input.profiles ?? [];
    const loaded = (entry: ProfileEntry): boolean => input.registered.includes(entry.plugin);
    const none = (why: string): Selection => ({ reason: "none", profile: undefined, plugin: undefined, why });
    const take = (name: string, reason: SelectionReason, how: string): Selection => {
        const entry = entries.find((candidate) => candidate.label === name);
        if (entry === undefined) return none(`${how}, but jig.json has no profile "${name}": no company is active`);
        if (!loaded(entry)) {
            return none(`${how}, but its plugin "${entry.plugin}" is not loaded: no company is active`);
        }
        return { reason, profile: entry.label, plugin: entry.plugin, why: how };
    };

    if (input.session !== undefined) {
        if (input.session === "none")
            return {
                reason: "session",
                profile: undefined,
                plugin: undefined,
                why: "you switched the company off with /profile none",
            };
        return take(input.session, "session", `you chose "${input.session}" with /profile`);
    }
    if (input.setting === "none")
        return { reason: "explicit", profile: undefined, plugin: undefined, why: 'jig.json says "profile": "none"' };
    if (input.setting !== "auto") return take(input.setting, "explicit", `jig.json says "profile": "${input.setting}"`);

    if (input.profiles === undefined) {
        const sole = input.registered.length === 1 ? input.registered[0] : undefined;
        if (sole !== undefined) {
            return {
                reason: "sole",
                profile: sole,
                plugin: sole,
                why: `no profiles are configured and "${sole}" is the only company plugin loaded`,
            };
        }
        return none(
            input.registered.length === 0
                ? "no company plugin is loaded"
                : `no profiles are configured and ${input.registered.length} company plugins are loaded: add a profiles section to jig.json`,
        );
    }
    const remote = normalizeRemote(originOf(input.cwd) ?? "");
    for (const entry of entries) {
        if (!loaded(entry)) continue;
        const folder = matchFolder(entry.folders, input.cwd, input.home);
        if (folder !== undefined) {
            return {
                reason: "folder",
                profile: entry.label,
                plugin: entry.plugin,
                why: `the working folder matches "${folder}" of profile "${entry.label}"`,
            };
        }
        const pattern = matchRemote(entry.remotes, remote);
        if (pattern !== undefined) {
            return {
                reason: "remote",
                profile: entry.label,
                plugin: entry.plugin,
                why: `the origin remote ${remote} matches "${pattern}" of profile "${entry.label}"`,
            };
        }
    }
    return none(
        entries.length === 0
            ? "the profiles section is empty"
            : `neither the working folder nor its origin remote${remote === undefined ? " (none found)" : ""} matches a profile`,
    );
}
