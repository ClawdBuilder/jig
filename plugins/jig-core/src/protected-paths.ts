// Protected paths: files that Pi's own file tools (`read`, `write`, `edit`, `grep`, `find`, `ls`) must not touch.
//
// Two kinds, and both are part of the floor, so configuration can add paths and never remove one:
//   secret    no reading and no writing: credential files, such as `~/.ssh` or `gh`'s token file, and Jig's own masking
//             keys and preview pages, which would undo a mask or show text that was never masked;
//   guarded   reading is allowed, writing is not: Pi's agent folder, where `jig.json`, Pi's settings, extensions and
//             Jig's own state live. An agent that could write there could load code or loosen a rule.
//
// A path is matched after `~` is expanded, a relative path is resolved against Pi's folder, `..` is folded away and
// every symlink on the way is followed, so a link in a project that points into `~/.ssh` is caught. A path is
// protected when it equals a protected path or is inside one.
//
// This checks the file tools only. `bash` is the sandbox's job: until the sandbox runs, a shell command can still reach
// these paths.
import { lstatSync, readlinkSync } from "node:fs";
import path from "node:path";
import { PI_PROJECT_PATHS, projectFoldersBelowHome } from "./kit/pi-project-paths.ts";
import { runsLaterPaths } from "./kit/runs-later.ts";
import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

export type ProtectedKind = "secret" | "guarded";

/** Where an entry came from, as `/jig rules` says it. */
export type ProtectedSource = "default" | "personal" | "company";

export interface ProtectedPath {
    /** Absolute, as it is matched. */
    path: string;
    /** For messages: the path with the home folder written as `~`. */
    shown: string;
    kind: ProtectedKind;
    source: ProtectedSource;
    /** What the model should do instead, when the person can: said after a write refusal. */
    advice?: string;
    /** The write asks the person instead of being refused: the path runs later, and a person may want the change. */
    ask?: boolean;
}

/** What differs between systems, so a test can simulate Windows or macOS on Linux. */
export interface PathContext {
    /** Default: this process's platform. `win32` and `darwin` compare paths without regard to case. */
    platform?: NodeJS.Platform;
}

/** Pi's environment, or a copy of it that a test made. */
export type Env = Readonly<Record<string, string | undefined>>;

export interface DefaultsInput extends PathContext {
    /** Pi's agent folder (`getAgentDir()`). Empty when not known: the entries inside it are left out. */
    agentDir: string;
    home: string;
    /** Pi's working folder: the project folder and its parents below the home folder are guarded where Pi loads files. */
    cwd?: string;
    /** Jig's state folder (`paths.stateDir()`). Empty when not known. Two folders in it are secret: the masking keys, and
     *  the preview pages the browser reads when the local server cannot serve them, both of which can hold text that was
     *  never masked. The rest of it stays readable: a spill file is the rest of a result the model was given. */
    stateDir?: string;
    /** Where `XDG_CONFIG_HOME`, `APPDATA` and the variables that move a credential store are read from. */
    env?: Env;
    /** The folders `secrets.pass` of `jig.json` binds `pass` to, as written (absolute, or starting with `~/`). */
    pass?: { storeDir?: string | undefined; gnupgHome?: string | undefined };
}

/** What a tool's input is checked against. */
export interface CheckContext extends PathContext {
    entries: readonly ProtectedPath[];
    /** Pi's working folder: where a relative path starts. */
    cwd: string;
    home: string;
    /** Whether bash may write this absolute path (the sandbox's own answer). Default: the working folder only. */
    canWrite?: (absolute: string) => boolean;
}

export interface Refusal {
    /** One line for the model, naming the protected path and never any file content. */
    reason: string;
    /** The write is not refused outright: the person is asked (and with no screen it is refused). */
    ask?: boolean;
    /** The protected path that stopped the call. Absent when the path was not text. */
    entry?: ProtectedPath;
}

/** The tools this checks, which are the file tools Pi ships. */
export const FILE_TOOLS: ReadonlySet<string> = new Set(["read", "write", "edit", "grep", "find", "ls"]);

// ---- the defaults -------------------------------------------------------------------------------------------------

/** Inside the agent folder: Pi's login and MCP sign-in tokens. */
const AGENT_SECRETS = ["auth.json", "mcp-auth.json"];

/** Inside the home folder. */
const HOME_SECRETS = [
    ".ssh",
    ".gnupg",
    ".password-store",
    ".aws",
    ".kube",
    ".azure",
    ".config/gcloud",
    ".config/gh",
    ".config/glab-cli",
    ".postman",
    ".docker/config.json",
    ".netrc",
    ".git-credentials",
    ".npmrc",
    ".pypirc",
];

/** Where `gh`, `glab` and `gcloud` keep their files when `XDG_CONFIG_HOME` points elsewhere, and on Windows. */
const XDG_SECRETS = ["gh", "glab-cli", "gcloud"];
const APPDATA_SECRETS = ["GitHub CLI", "glab-cli", "gcloud"];

/** The variables that move a credential store away from its usual place in the home folder, and what each one names. A
 *  `list` is split on the platform's path delimiter. `inside` is the one file of the named folder that holds credentials:
 *  the usual `~/.docker` holds more than that file, so only the file is protected there too. */
const MOVED_BY_ENV: ReadonlyArray<{ variable: string; list?: true; inside?: string }> = [
    { variable: "PASSWORD_STORE_DIR" },
    { variable: "GNUPGHOME" },
    { variable: "AWS_CONFIG_FILE" },
    { variable: "AWS_SHARED_CREDENTIALS_FILE" },
    { variable: "KUBECONFIG", list: true },
    { variable: "GH_CONFIG_DIR" },
    { variable: "GLAB_CONFIG_DIR" },
    { variable: "CLOUDSDK_CONFIG" },
    { variable: "DOCKER_CONFIG", inside: "config.json" },
];

function flavour(platform: NodeJS.Platform | undefined): typeof path.posix {
    return (platform ?? process.platform) === "win32" ? path.win32 : path.posix;
}

/** `~` for the home folder, so a message does not spell out where the user lives. */
function abbreviate(absolute: string, home: string, pathApi: typeof path.posix): string {
    if (home === "") return absolute;
    const relative = pathApi.relative(home, absolute);
    if (relative === "") return "~";
    if (relative.startsWith("..") || pathApi.isAbsolute(relative)) return absolute;
    return `~/${relative.split(pathApi.sep).join("/")}`;
}

function entry(
    absolute: string,
    kind: ProtectedKind,
    source: ProtectedSource,
    home: string,
    pathApi: typeof path.posix,
): ProtectedPath {
    return { path: absolute, shown: abbreviate(absolute, home, pathApi), kind, source };
}

/** A guarded entry for code that Pi loads. `note` says what named it, and `/jig rules` and a refusal show it: `~/work/ext (a package in settings.json)`. */
export function guardedEntry(absolute: string, note: string, home: string, platform?: NodeJS.Platform): ProtectedPath {
    const found = entry(absolute, "guarded", "default", home, flavour(platform));
    return { ...found, shown: `${found.shown} (${note})` };
}

/** True when protecting `absolute` would protect the whole home folder, a folder above it, or the root. */
export function coversHome(absolute: string, home: string, platform?: NodeJS.Platform): boolean {
    const pathApi = flavour(platform);
    return (
        absolute === pathApi.parse(absolute).root ||
        (home !== "" && isInside(comparable(home, platform), comparable(absolute, platform), pathApi.sep))
    );
}

/** A secret entry of the defaults that says in `shown` what named it: `/srv/pass (from PASSWORD_STORE_DIR)`. */
function namedEntry(absolute: string, namedBy: string, home: string, pathApi: typeof path.posix): ProtectedPath {
    const found = entry(absolute, "secret", "default", home, pathApi);
    return { ...found, shown: `${found.shown} (from ${namedBy})` };
}

/** The folders `jig.json` binds `pass` to (`secrets.pass`), which `pass` and `gpg` read and Pi's file tools must not. */
export function boundStores(
    pass: NonNullable<DefaultsInput["pass"]>,
    home: string,
    platform?: NodeJS.Platform,
): ProtectedPath[] {
    const pathApi = flavour(platform);
    const out: ProtectedPath[] = [];
    for (const key of ["storeDir", "gnupgHome"] as const) {
        const text = pass[key];
        const named = text === undefined ? undefined : expandProtected(text, home, platform);
        if (named === undefined || coversHome(named, home, platform)) continue;
        out.push(namedEntry(named, `secrets.pass.${key}`, home, pathApi));
    }
    return out;
}

/**
 * The secret paths that the environment moves a store to. `pass` and `gpg` honour `PASSWORD_STORE_DIR` and `GNUPGHOME`,
 * and the cloud and forge tools have variables of their own, so a store that is not where it usually is would escape the
 * built-in list.
 *   - A value counts when it is absolute, or `~/...` (the AWS tools expand that themselves; for another tool it names a
 *     place nobody uses, which costs nothing to protect). An empty or relative value is ignored: a relative one depends
 *     on where the tool runs.
 *   - A value that would protect the whole home folder, or a folder above it, or the root, is ignored too.
 * Each entry says in `shown` which variable named it.
 */
export function relocatedStores(env: Env, home: string, platform?: NodeJS.Platform): ProtectedPath[] {
    const pathApi = flavour(platform);
    const out: ProtectedPath[] = [];
    for (const { variable, list, inside } of MOVED_BY_ENV) {
        const value = env[variable];
        if (value === undefined || value === "") continue;
        for (const text of list === true ? value.split(pathApi.delimiter) : [value]) {
            const named = expandProtected(text, home, platform);
            if (named === undefined) continue;
            const target = inside === undefined ? named : pathApi.join(named, inside);
            if (!coversHome(target, home, platform)) out.push(namedEntry(target, variable, home, pathApi));
        }
    }
    return out;
}

/** What is protected without any configuration. */
export function defaultProtectedPaths(input: DefaultsInput): ProtectedPath[] {
    const pathApi = flavour(input.platform);
    const { home, agentDir } = input;
    const make = (absolute: string, kind: ProtectedKind) => entry(absolute, kind, "default", home, pathApi);
    const out: ProtectedPath[] = [];

    if (agentDir !== "") {
        for (const name of AGENT_SECRETS) out.push(make(pathApi.join(agentDir, name), "secret"));
    }
    if (home !== "") for (const name of HOME_SECRETS) out.push(make(pathApi.join(home, ...name.split("/")), "secret"));

    const xdg = input.env?.XDG_CONFIG_HOME;
    if (xdg !== undefined && pathApi.isAbsolute(xdg)) {
        for (const name of XDG_SECRETS) out.push(make(pathApi.join(xdg, name), "secret"));
    }
    const appData = input.env?.APPDATA;
    if (pathApi === path.win32 && appData !== undefined && pathApi.isAbsolute(appData)) {
        for (const name of APPDATA_SECRETS) out.push(make(pathApi.join(appData, name), "secret"));
    }
    // The bound folders first: when `secrets.pass` and the environment name one folder, the entry says `secrets.pass`.
    if (input.pass !== undefined) out.push(...boundStores(input.pass, home, input.platform));
    if (input.env !== undefined) out.push(...relocatedStores(input.env, home, input.platform));
    // The masking keys would let a reader confirm a masked value, and a preview page holds text that was never masked.
    // Both are read by Jig itself and by the browser, never by Pi's file tools.
    if (input.stateDir !== undefined && input.stateDir !== "") {
        out.push(make(pathApi.join(input.stateDir, "mask"), "secret"));
        out.push(make(pathApi.join(input.stateDir, "previews"), "secret"));
    }
    // The project files Pi loads at its next start, in the working folder and every folder above it below the home folder.
    // A path is guarded whether or not it exists yet: a file made there before the next start would be loaded.
    const projectFolders =
        input.cwd === undefined || input.cwd === "" ? [] : projectFoldersBelowHome(input.cwd, home, input.platform);
    const askAdvice = "Ask the person to allow this, or to make the change themselves outside Pi.";
    if (input.cwd !== undefined && input.cwd !== "") {
        for (const folder of projectFolders) {
            for (const item of PI_PROJECT_PATHS) {
                out.push({
                    ...guardedEntry(
                        pathApi.join(folder, ...item.split("/")),
                        "Pi loads this at its next start",
                        home,
                        input.platform,
                    ),
                    advice: "Ask the person to change it themselves, outside Pi.",
                });
            }
        }
    }
    // Everything else the sandbox locks for bash because it runs later outside the sandbox: the file tools ask.
    for (const item of runsLaterPaths("home", { home, folders: [], platform: input.platform })) {
        if (item.path.includes("/Library/LaunchAgents") && (input.platform ?? process.platform) !== "darwin") continue;
        out.push({
            ...guardedEntry(item.path, "it runs later outside the sandbox", home, input.platform),
            advice: askAdvice,
            ...(item.group === "toolchain" ? { ask: true } : {}),
        });
    }
    for (const item of runsLaterPaths("project", { home, folders: projectFolders, platform: input.platform })) {
        out.push({
            ...guardedEntry(item.path, "it runs later outside the sandbox", home, input.platform),
            advice: askAdvice,
            ...(item.group === "toolchain" ? { ask: true } : {}),
        });
    }
    if (input.cwd !== undefined && input.cwd !== "") {
        const repos: string[] = [];
        const consider = (folder: string, depth: number): void => {
            try {
                if (readdirSync(folder).includes(".git")) repos.push(folder);
                if (depth >= 2) return;
                for (const name of readdirSync(folder)) {
                    if (name.startsWith(".")) continue;
                    const child = pathApi.join(folder, name);
                    try {
                        if (!readdirSync(child).some((entry) => entry === "package.json" || entry === ".git")) continue;
                        consider(child, depth + 1);
                    } catch {
                        // not a folder
                    }
                }
            } catch {
                // not readable
            }
        };
        consider(input.cwd, 0);
        for (const folder of repos) {
            for (const item of runsLaterPaths("repository", { home, folders: [folder], platform: input.platform })) {
                out.push({
                    ...guardedEntry(item.path, "it runs later outside the sandbox", home, input.platform),
                    advice: askAdvice,
                    ...(item.group === "toolchain" ? { ask: true } : {}),
                });
            }
        }
    }
    // Last, so a message about a file inside it names the more specific secret entry first.
    if (agentDir !== "") out.push(make(agentDir, "guarded"));
    return dedupe(out, input.platform);
}

/** `~`, `~/x` or an absolute path, made absolute. Anything else is a relative path, which has no meaning in a list of
 *  protected paths and is refused when the file is read. */
export function expandProtected(text: string, home: string, platform?: NodeJS.Platform): string | undefined {
    const pathApi = flavour(platform);
    if (text === "~") return home === "" ? undefined : home;
    if (text.startsWith("~/") || (pathApi === path.win32 && text.startsWith("~\\"))) {
        return home === "" ? undefined : pathApi.join(home, text.slice(2));
    }
    return pathApi.isAbsolute(text) ? pathApi.resolve(text) : undefined;
}

/** True when `text` is a path a configuration may list: `~`, `~/...` or absolute. */
export function isListablePath(text: string): boolean {
    const home = text === "~" || text.startsWith("~/") || (path.sep === "\\" && text.startsWith("~\\"));
    return home || path.isAbsolute(text);
}

/** Adds entries from configuration after the defaults. A path that is already listed keeps its first (default or
 *  earlier) entry, except that `secret` beats `guarded` for the same path. */
export function mergeProtected(
    base: readonly ProtectedPath[],
    additions: readonly ProtectedPath[],
    platform?: NodeJS.Platform,
): ProtectedPath[] {
    return dedupe([...base, ...additions], platform);
}

function dedupe(list: readonly ProtectedPath[], platform: NodeJS.Platform | undefined): ProtectedPath[] {
    const seen = new Map<string, ProtectedPath>();
    for (const item of list) {
        const key = comparable(item.path, platform);
        const kept = seen.get(key);
        if (kept === undefined || (kept.kind === "guarded" && item.kind === "secret")) seen.set(key, item);
    }
    return [...seen.values()];
}

// ---- resolving a path ---------------------------------------------------------------------------------------------

const UNICODE_SPACES = /[  -   　]/g;

/** Git Bash, MSYS, Cygwin and WSL drive paths in a form native Windows accepts, as Pi does for its own tools. */
function windowsShellPath(text: string): string {
    if (!text.startsWith("/") || text.startsWith("//") || text.includes("\\")) return text;
    const match = text.match(/^\/(?:mnt\/|cygdrive\/)?([a-z])(?:\/(.*))?$/i);
    if (match === null) return text;
    return `${match[1]?.toUpperCase()}:\\${match[2]?.replaceAll("/", "\\") ?? ""}`;
}

/** The path as Pi's own tools read it: a leading `@` dropped, unusual spaces made plain, `~` expanded, a `file:` address
 *  turned into a path, and a relative path started from Pi's working folder. `folded` has its `..` folded away the way
 *  Pi does before it opens a file; `unfolded` keeps them, for the system's own reading of a `..` that follows a link. */
function lexical(
    raw: string,
    cwd: string,
    home: string,
    platform: NodeJS.Platform | undefined,
): { folded: string; unfolded: string } {
    const pathApi = flavour(platform);
    let text = raw.replace(UNICODE_SPACES, " ");
    if (text.startsWith("@")) text = text.slice(1);
    if (pathApi === path.win32) text = windowsShellPath(text);
    if (text === "~") text = home;
    else if (text.startsWith("~/") || (pathApi === path.win32 && text.startsWith("~\\"))) {
        text = pathApi.join(home, text.slice(2));
    }
    if (/^file:\/\//.test(text)) text = fileURLToPath(text);
    const absolute = pathApi.isAbsolute(text);
    return {
        folded: absolute ? pathApi.resolve(text) : pathApi.resolve(cwd, text),
        unfolded: absolute ? text : `${cwd}${pathApi.sep}${text}`,
    };
}

/** Most links followed before a path is given up on. Linux stops at 40. */
const MAX_LINKS = 40;

/**
 * The path with every symlink followed, including links whose target does not exist (a write through a dangling link
 * creates the target). Components that do not exist are kept as written: they are what a write would create.
 */
function followLinks(absolute: string, platform: NodeJS.Platform | undefined): string {
    const pathApi = flavour(platform);
    const root = pathApi.parse(absolute).root;
    let pending = absolute.slice(root.length).split(/[\\/]+/);
    let current = root;
    let links = 0;
    while (pending.length > 0) {
        const part = pending.shift() as string;
        if (part === "" || part === ".") continue;
        if (part === "..") {
            current = pathApi.dirname(current);
            continue;
        }
        const next = pathApi.join(current, part);
        let isLink = false;
        try {
            isLink = lstatSync(next).isSymbolicLink();
        } catch {
            // Not there (or cannot be looked at): the rest is what a write would create, so it stays as written.
            return pathApi.resolve(next, ...pending);
        }
        if (!isLink) {
            current = next;
            continue;
        }
        if (++links > MAX_LINKS) return pathApi.resolve(next, ...pending);
        let target: string;
        try {
            target = readlinkSync(next);
        } catch {
            return pathApi.resolve(next, ...pending);
        }
        if (pathApi.isAbsolute(target)) {
            current = pathApi.parse(target).root;
            pending = [...target.slice(current.length).split(/[\\/]+/), ...pending];
        } else {
            pending = [...target.split(/[\\/]+/), ...pending];
        }
    }
    return current;
}

/** The form paths are compared in: lower case on systems that ignore case, with accents in one fixed form. */
function comparable(absolute: string, platform: NodeJS.Platform | undefined): string {
    const system = platform ?? process.platform;
    return system === "win32" || system === "darwin" ? absolute.normalize("NFC").toLowerCase() : absolute;
}

function isInside(child: string, parent: string, sep: string): boolean {
    return child === parent || child.startsWith(parent.endsWith(sep) ? parent : parent + sep);
}

// ---- the paths a file tool acts on ----------------------------------------------------------------------------------

/**
 * The absolute paths a call to Pi's `write` or `edit` acts on, for a gate: the path as Pi opens it once `~`, `@` and `..`
 * are resolved, and with every link followed (the same path once when there is no link). Empty for any other tool, and
 * for a call with no text path. This is the path logic of the checks below, so a gate and the protected paths cannot read
 * one call in two ways.
 */
export function filePathsOf(
    tool: string,
    input: Readonly<Record<string, unknown>>,
    context: { cwd: string; home: string; platform?: NodeJS.Platform },
): string[] {
    if (tool !== "write" && tool !== "edit") return [];
    const given = input.path;
    if (typeof given !== "string") return [];
    const target = lexical(given, context.cwd, context.home, context.platform);
    const forms = new Set([target.folded, followLinks(target.folded, context.platform)]);
    if (target.unfolded !== target.folded) forms.add(followLinks(target.unfolded, context.platform));
    return [...forms];
}

// ---- the check ----------------------------------------------------------------------------------------------------

/** Every form a path can be reached by: as written once folded, and with its links followed. `unfolded` is the same
 *  path with its `..` still in place, which the system reads differently when a link comes before one. */
function formsOf(folded: string, platform: NodeJS.Platform | undefined, unfolded: string = folded): string[] {
    const forms = new Set([comparable(folded, platform)]);
    forms.add(comparable(followLinks(folded, platform), platform));
    if (unfolded !== folded) forms.add(comparable(followLinks(unfolded, platform), platform));
    return [...forms];
}

type Relation = "inside" | "contains";

/** The first entry of the wanted kinds that `target` is inside, or that `target` contains. Secret entries are tried
 *  before guarded ones, so a message names the more precise reason. */
function find(
    targetForms: readonly string[],
    entries: ReadonlyArray<{ item: ProtectedPath; forms: readonly string[] }>,
    kinds: readonly ProtectedKind[],
    relation: Relation,
    sep: string,
): ProtectedPath | undefined {
    for (const kind of kinds) {
        for (const { item, forms } of entries) {
            if (item.kind !== kind) continue;
            for (const wanted of forms) {
                for (const have of targetForms) {
                    if (relation === "inside" ? isInside(have, wanted, sep) : isInside(wanted, have, sep)) return item;
                }
            }
        }
    }
    return undefined;
}

const SECRET: readonly ProtectedKind[] = ["secret"];
const ANY: readonly ProtectedKind[] = ["secret", "guarded"];

/**
 * What stops a call to one of Pi's file tools, or undefined when nothing does.
 *   read       refused inside a secret path;
 *   grep       refused inside a secret path, and when the folder it searches contains one;
 *   find, ls   refused inside a secret path (names only, so an ancestor is fine);
 *   write      refused inside a secret or guarded path;
 *   edit       the same as write.
 * A path parameter that is not text is refused: it cannot be matched, and Pi's validation would have refused it first.
 */
export function checkFileTool(
    tool: string,
    input: Readonly<Record<string, unknown>>,
    context: CheckContext,
): Refusal | undefined {
    if (!FILE_TOOLS.has(tool)) return undefined;
    const given = input.path;
    const searches = tool === "grep" || tool === "find" || tool === "ls";
    if (given === undefined || given === null) {
        // Pi searches or lists the working folder without a path; a call to read, write or edit needs one, and Pi
        // refuses it for lack of one.
        if (!searches) return undefined;
    } else if (typeof given !== "string") {
        return { reason: `${tool} is refused: its path is not text` };
    }
    const target = lexical(typeof given === "string" ? given : ".", context.cwd, context.home, context.platform);
    const targetForms = formsOf(target.folded, context.platform, target.unfolded);
    const entries = context.entries.map((item) => ({ item, forms: formsOf(item.path, context.platform) }));
    const sep = flavour(context.platform).sep;

    const refuse = (item: ProtectedPath, reason: string): Refusal => ({
        reason: `${tool} is refused: ${reason}`,
        entry: item,
    });
    const secret = (item: ProtectedPath) =>
        refuse(item, `${item.shown} holds credentials, so the file tools neither read nor write it`);

    if (tool === "write" || tool === "edit") {
        // A repository can be nested below the folder Pi runs in, and a worktree's .git is a file. The path is the fact,
        // not whether the repository was found by enumerating folders.
        const slashed = target.folded.split("\\").join("/").toLowerCase();
        if (/(^|\/)\.git\/(config$|hooks(\/|$))/.test(slashed)) {
            return {
                reason: `${tool} is refused: ${abbreviate(target.folded, context.home, flavour(context.platform))} runs later outside the sandbox: git hooks and configuration are guarded. Ask the person to change it themselves, outside Pi.`,
                entry: {
                    path: target.folded,
                    shown: abbreviate(target.folded, context.home, flavour(context.platform)),
                    kind: "guarded",
                    source: "default",
                },
            };
        }
        const hit = find(targetForms, entries, ANY, "inside", sep);
        if (hit === undefined) {
            const api = flavour(context.platform);
            const writable =
                context.canWrite ?? ((absolute: string) => isInside(absolute, api.resolve(context.cwd), sep));
            if (targetForms.some((form) => !writable(form))) {
                return {
                    ask: true,
                    reason: `write needs approval: ${abbreviate(target.folded, context.home, api)} is outside the folders bash can write. Ask the person to allow that folder (they can use /sandbox allow), or make the change themselves.`,
                };
            }
            return undefined;
        }
        if (hit.kind === "secret") return secret(hit);
        if (hit.ask === true) {
            return {
                ask: true,
                reason: `${hit.shown} runs later outside the sandbox: ${hit.advice ?? "ask the person to allow the change"}.`,
                entry: hit,
            };
        }
        return refuse(
            hit,
            `${hit.shown} is guarded: the file tools can read it but not write it${hit.advice === undefined ? "" : `. ${hit.advice}`}`,
        );
    }
    const inside = find(targetForms, entries, SECRET, "inside", sep);
    if (inside !== undefined) return secret(inside);
    if (tool === "grep") {
        const holds = find(targetForms, entries, SECRET, "contains", sep);
        if (holds !== undefined) {
            return refuse(
                holds,
                `the folder to search contains ${holds.shown}, which holds credentials; search a narrower folder`,
            );
        }
    }
    return undefined;
}
