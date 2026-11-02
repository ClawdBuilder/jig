// The `pin` deploy method in the catalog, and the read-only `pinned` entry of an environment that has no deploy.
//
// Many teams deploy by changing one version line in a control repository: a chart version, a Hiera line, an image tag in
// a GitOps repository. A pin names that repository, the branch that deploys, and for each file the one line that holds
// the version. Everything that reaches GitHub (the repository, the branch, the file paths) is checked here, once, when the
// session starts; a call names a service and an environment and never a path.
//
//   { "method": "pin", "repo": "acme/deploy-control", "base": "main",
//     "pins": [{ "file": "clusters/staging/orders-api/chart.version", "line": "^(?<version>\\S+)$", "write": "{version}" }],
//     "version": "^\\d+\\.\\d+\\.\\d+$", "ticket": "^PROJ-\\d+$", "holder": "(?<ticket>PROJ-\\d+)",
//     "branch": "deploy/{ticket}-{environment}-{service}", "title": "{ticket}: deploy {service} {version} to {environment}",
//     "merge": "person", "apply": "job" }
//
// A pattern is JavaScript regular expression text. The ones that check a value from a call (`version`, `ticket`,
// `values`) must match the whole value; `line`, `holder` and `runsAs` are searched in a line.
import { isObject } from "../values.ts";

/** A regular expression from the catalog, with the text it was written as. */
export interface Pattern {
    source: string;
    regex: RegExp;
}

/** A place a version is written: a file of the control repository and the one line of it that holds the version. */
export interface PinFile {
    file: string;
    /** Matches exactly one line of the file. Its named group `version` is the version; other named groups are kept values. */
    line: Pattern;
    /** The named groups of `line`, in the order written. */
    groups: readonly string[];
}

/** What a read needs: where the pin is and how to read it. `pinned` is exactly this. */
export interface PinSource {
    /** `owner/name` on GitHub. */
    repo: string;
    /** The branch that deploys. */
    base: string;
    pins: readonly PinFile[];
    /** What a version looks like. */
    version?: Pattern;
    /** Group `ticket`, matched on the first pin's current line: who holds the environment now. */
    holder?: Pattern;
    /** Group `version`: what the runtime reports for a pinned version (`1.4.3-0` runs as `1.4.3`). */
    runsAs?: Pattern;
}

export interface PinDeployFile extends PinFile {
    /** The new line. Placeholders: `{version}`, `{ticket}`, `{service}`, `{environment}` and the groups of `line`. */
    write: string;
}

/** The `deploy` entry with `method: "pin"`. */
export interface PinDeploy extends PinSource {
    method: "pin";
    pins: readonly PinDeployFile[];
    /** The `ticket` parameter's pattern. Required when a template uses `{ticket}`. */
    ticket?: Pattern;
    /** The groups of `line` a call may set, each with its pattern. A group not set keeps the current line's value. */
    values: ReadonlyMap<string, Pattern>;
    branch: string;
    title: string;
    /** `person`: a person merges the pull request. `tool`: the tool may merge it, asking each time. */
    merge: "person" | "tool";
    /** `job`: the environment's CI job deploys what `base` pins. `itself`: the platform applies a merge by itself. */
    apply: "job" | "itself";
}

/** The reserved placeholders of every template. */
export const RESERVED = ["version", "ticket", "service", "environment"] as const;

const SOURCE_FIELDS = ["repo", "base", "pins", "version", "holder", "runsAs"];
const DEPLOY_FIELDS = ["method", ...SOURCE_FIELDS, "ticket", "values", "branch", "title", "merge", "apply"];
const PIN_FIELDS = ["file", "line", "write"];
const PINNED_PIN_FIELDS = ["file", "line"];

const REPO = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}\/[A-Za-z0-9._-]{1,100}$/;
const FILE = /^[A-Za-z0-9._@+=,-]+(?:\/[A-Za-z0-9._@+=,-]+)*$/;
const IDENTIFIER = /^[A-Za-z][A-Za-z0-9]{0,29}$/;
const MAX_PATTERN = 300;
const MAX_PINS = 4;
const MAX_VALUES = 8;
const MAX_TEMPLATE = 300;
const MAX_TITLE = 200;
const CONTROL = /[\u0000-\u001f\u007f]/;

/** Characters allowed in a value that a call gives: printable ASCII, so nothing breaks a line or a path. */
export const VALUE_TEXT = /^[ -~]{1,200}$/;

/** A branch or a tag name GitHub accepts, in the plain subset this plugin writes: no `..`, `//`, `/.` or `.lock`. */
export function isRefName(name: string): boolean {
    return (
        /^[A-Za-z0-9][A-Za-z0-9._/-]{0,199}$/.test(name) &&
        !name.includes("..") &&
        !name.includes("//") &&
        !name.includes("/.") &&
        !/[./]$/.test(name) &&
        !name.endsWith(".lock")
    );
}

/** The names of the named groups in a pattern's text. A lookbehind (`(?<=`, `(?<!`) is not a group. */
export function groupNames(source: string): string[] {
    const names: string[] = [];
    let inClass = false;
    for (let at = 0; at < source.length; at++) {
        const char = source[at];
        if (char === "\\") at++;
        else if (inClass) inClass = char !== "]";
        else if (char === "[") inClass = true;
        else if (char === "(" && source[at + 1] === "?" && source[at + 2] === "<") {
            const next = source[at + 3];
            if (next === "=" || next === "!") continue;
            const end = source.indexOf(">", at + 3);
            if (end > 0) names.push(source.slice(at + 3, end));
        }
    }
    return names;
}

/** The `{name}` placeholders of a template, in order. */
export function placeholders(template: string): string[] {
    return [...template.matchAll(/\{([A-Za-z][A-Za-z0-9]*)\}/g)].map((match) => match[1] as string);
}

/** A template with each `{name}` that `values` knows replaced. */
export function fill(template: string, values: Readonly<Record<string, string>>): string {
    return template.replace(/\{([A-Za-z][A-Za-z0-9]*)\}/g, (whole, name: string) =>
        Object.hasOwn(values, name) ? (values[name] as string) : whole,
    );
}

/** Whether a value matches a pattern from end to end (the patterns for values are anchored when they are read). */
export function matchesWhole(pattern: Pattern, value: string): boolean {
    return VALUE_TEXT.test(value) && pattern.regex.test(value);
}

function compile(raw: unknown, at: string, errors: string[], whole: boolean): Pattern | undefined {
    if (typeof raw !== "string" || raw === "" || raw.length > MAX_PATTERN || CONTROL.test(raw)) {
        errors.push(`${at}: must be a regular expression of 1 to ${MAX_PATTERN} characters on one line`);
        return undefined;
    }
    try {
        return { source: raw, regex: new RegExp(whole ? `^(?:${raw})$` : raw) };
    } catch {
        errors.push(`${at}: is not a valid regular expression`);
        return undefined;
    }
}

function checkFields(raw: Record<string, unknown>, allowed: readonly string[], at: string, errors: string[]): void {
    for (const key of Object.keys(raw)) if (!allowed.includes(key)) errors.push(`${at}.${key}: unknown field`);
}

function requiredText(raw: unknown, pattern: RegExp, at: string, what: string, errors: string[]): string | undefined {
    if (raw === undefined) {
        errors.push(`${at}: required, ${what}`);
        return undefined;
    }
    if (typeof raw === "string" && pattern.test(raw)) return raw;
    errors.push(`${at}: must be ${what}`);
    return undefined;
}

/** Reads one entry of `pins`. `write` is read only for a `pin` deploy, where it is required. */
function checkFile(
    raw: unknown,
    at: string,
    deploy: boolean,
    errors: string[],
): (PinFile & { write?: string }) | undefined {
    if (!isObject(raw)) {
        errors.push(`${at}: must be an object with file and line${deploy ? " and write" : ""}`);
        return undefined;
    }
    const before = errors.length;
    checkFields(raw, deploy ? PIN_FIELDS : PINNED_PIN_FIELDS, at, errors);
    const file = requiredText(
        raw.file,
        FILE,
        `${at}.file`,
        "a path in the repository, such as clusters/staging/orders-api/chart.version",
        errors,
    );
    if (file?.split("/").some((part) => part === "." || part === "..")) {
        errors.push(`${at}.file: must not contain . or .. as a folder`);
    }
    const line = raw.line === undefined ? undefined : compile(raw.line, `${at}.line`, errors, false);
    if (raw.line === undefined)
        errors.push(`${at}.line: required, a pattern that matches exactly one line of the file`);
    const groups = line === undefined ? [] : groupNames(line.source);
    if (line !== undefined && !groups.includes("version")) {
        errors.push(`${at}.line: must have a named group (?<version>...) that holds the version`);
    }
    for (const group of groups) {
        if (group !== "version" && (RESERVED as readonly string[]).includes(group)) {
            errors.push(`${at}.line: the group name ${group} is a placeholder of its own`);
        } else if (!IDENTIFIER.test(group)) {
            errors.push(`${at}.line: a group name is letters and digits, starting with a letter`);
        }
    }
    let write: string | undefined;
    if (deploy) {
        if (
            typeof raw.write !== "string" ||
            raw.write === "" ||
            raw.write.length > MAX_TEMPLATE ||
            CONTROL.test(raw.write)
        ) {
            errors.push(`${at}.write: required, the new line as text on one line, such as {version}`);
        } else {
            write = raw.write;
            const known = [...RESERVED, ...groups];
            for (const name of placeholders(write)) {
                if (!known.includes(name)) errors.push(`${at}.write: unknown placeholder {${name}}`);
            }
            if (!placeholders(write).includes("version")) {
                errors.push(`${at}.write: must contain {version}, or the line would not change with the version`);
            }
        }
    }
    if (errors.length > before || file === undefined || line === undefined) return undefined;
    return { file, line, groups, ...(write === undefined ? {} : { write }) };
}

/** The part both entries share: the repository, the branch, the files and the patterns that read them. */
function checkSource(
    raw: Record<string, unknown>,
    at: string,
    deploy: boolean,
    errors: string[],
): (Omit<PinSource, "pins"> & { pins: Array<PinFile & { write?: string }> }) | undefined {
    const before = errors.length;
    const repo = requiredText(
        raw.repo,
        REPO,
        `${at}.repo`,
        "a GitHub repository as owner/name, such as acme/deploy-control",
        errors,
    );
    const base = requiredText(
        raw.base,
        /^[^\s]{1,200}$/,
        `${at}.base`,
        "the branch that deploys, such as main",
        errors,
    );
    if (base !== undefined && !isRefName(base)) errors.push(`${at}.base: must be a plain branch name, such as main`);

    const pins: Array<PinFile & { write?: string }> = [];
    if (!Array.isArray(raw.pins) || raw.pins.length === 0 || raw.pins.length > MAX_PINS) {
        errors.push(
            `${at}.pins: ${raw.pins === undefined ? "required, " : "must be "}a list of 1 to ${MAX_PINS} places the version is written`,
        );
    } else {
        raw.pins.forEach((entry, index) => {
            const read = checkFile(entry, `${at}.pins[${index}]`, deploy, errors);
            if (read === undefined) return;
            if (pins.some((other) => other.file === read.file)) {
                errors.push(`${at}.pins[${index}].file: a file may appear once; one pattern must match its one line`);
            } else pins.push(read);
        });
    }

    const version = raw.version === undefined ? undefined : compile(raw.version, `${at}.version`, errors, true);
    if (deploy && raw.version === undefined) {
        errors.push(`${at}.version: required, a pattern for what a version looks like`);
    }
    const holder = raw.holder === undefined ? undefined : compile(raw.holder, `${at}.holder`, errors, false);
    if (holder !== undefined && !groupNames(holder.source).includes("ticket")) {
        errors.push(`${at}.holder: must have a named group (?<ticket>...)`);
    }
    const runsAs = raw.runsAs === undefined ? undefined : compile(raw.runsAs, `${at}.runsAs`, errors, false);
    if (runsAs !== undefined && !groupNames(runsAs.source).includes("version")) {
        errors.push(`${at}.runsAs: must have a named group (?<version>...)`);
    }

    if (errors.length > before || repo === undefined || base === undefined) return undefined;
    return {
        repo,
        base,
        pins,
        ...(version === undefined ? {} : { version }),
        ...(holder === undefined ? {} : { holder }),
        ...(runsAs === undefined ? {} : { runsAs }),
    };
}

/** Checks a template of the branch or the title: only the four placeholders, and what is left is a usable name or line. */
function checkTemplate(raw: unknown, at: string, title: boolean, errors: string[]): string | undefined {
    if (typeof raw !== "string" || raw === "" || raw.length > MAX_TEMPLATE || CONTROL.test(raw)) {
        errors.push(
            `${at}: required, text on one line with placeholders from ${RESERVED.map((name) => `{${name}}`).join(", ")}`,
        );
        return undefined;
    }
    const before = errors.length;
    for (const name of placeholders(raw)) {
        if (!(RESERVED as readonly string[]).includes(name)) errors.push(`${at}: unknown placeholder {${name}}`);
    }
    if (errors.length > before) return undefined;
    // With each placeholder as one plain letter, what remains must still be a name (or a line) that can be used.
    const sample = fill(raw, { version: "x", ticket: "x", service: "x", environment: "x" });
    if (!title && !isRefName(sample)) {
        errors.push(
            `${at}: must make a plain branch name: letters, digits, . _ - and /, with the placeholders filled in`,
        );
        return undefined;
    }
    if (title && (sample.trim() === "" || sample.length > MAX_TITLE)) {
        errors.push(`${at}: must make a title of up to ${MAX_TITLE} characters`);
        return undefined;
    }
    return raw;
}

/** The `deploy` entry with `method: "pin"`. The catalog has seen that its method is `pin`. */
export function checkPin(raw: Record<string, unknown>, at: string, errors: string[]): PinDeploy | undefined {
    const before = errors.length;
    checkFields(raw, DEPLOY_FIELDS, at, errors);
    const source = checkSource(raw, at, true, errors);

    const ticket = raw.ticket === undefined ? undefined : compile(raw.ticket, `${at}.ticket`, errors, true);
    const branch = checkTemplate(raw.branch, `${at}.branch`, false, errors);
    const title = checkTemplate(raw.title, `${at}.title`, true, errors);

    const values = new Map<string, Pattern>();
    if (raw.values !== undefined) {
        const groups = new Set((source?.pins ?? []).flatMap((pin) => pin.groups));
        if (!isObject(raw.values) || Object.keys(raw.values).length > MAX_VALUES) {
            errors.push(
                `${at}.values: must be an object of up to ${MAX_VALUES} named groups of a line, each with its pattern`,
            );
        } else {
            for (const [name, pattern] of Object.entries(raw.values)) {
                if (name === "version" || !groups.has(name)) {
                    errors.push(
                        `${at}.values.${name.slice(0, 30)}: must be a named group of a pin's line, other than version`,
                    );
                    continue;
                }
                const read = compile(pattern, `${at}.values.${name}`, errors, true);
                if (read !== undefined) values.set(name, read);
            }
        }
    }

    const merge = raw.merge === undefined ? "person" : raw.merge;
    if (merge !== "person" && merge !== "tool") errors.push(`${at}.merge: must be person (the default) or tool`);
    const apply = raw.apply;
    if (apply !== "job" && apply !== "itself") {
        errors.push(`${at}.apply: required, job (the environment's CI job deploys what the branch pins) or itself`);
    }

    const templates = [branch, title, ...(source?.pins ?? []).map((pin) => pin.write)];
    if (
        templates.some((text) => text !== undefined && placeholders(text).includes("ticket")) &&
        raw.ticket === undefined
    ) {
        errors.push(`${at}.ticket: required, because a template uses {ticket}`);
    }

    if (errors.length > before || source === undefined || branch === undefined || title === undefined) return undefined;
    if (merge !== "person" && merge !== "tool") return undefined;
    if (apply !== "job" && apply !== "itself") return undefined;
    const pins = source.pins.map((pin) => ({ ...pin, write: pin.write as string }));
    return {
        method: "pin",
        ...source,
        pins,
        ...(ticket === undefined ? {} : { ticket }),
        values,
        branch,
        title,
        merge,
        apply,
    };
}

/** The `pinned` entry of an environment with no deploy: the same places, read only. */
export function checkPinned(raw: unknown, at: string, errors: string[]): PinSource | undefined {
    if (!isObject(raw)) {
        errors.push(`${at}: must be an object with repo, base and pins`);
        return undefined;
    }
    const before = errors.length;
    checkFields(raw, SOURCE_FIELDS, at, errors);
    const source = checkSource(raw, at, false, errors);
    if (errors.length > before || source === undefined) return undefined;
    return source;
}

/** Whether a call must carry a `ticket`: some template of the pin uses it. */
export function usesTicket(pin: PinDeploy): boolean {
    return [pin.branch, pin.title, ...pin.pins.map((file) => file.write)].some((text) =>
        placeholders(text).includes("ticket"),
    );
}

/** A regular expression that matches the branches the template makes, for any ticket and any version. */
export function branchPattern(template: string, service: string, environment: string): RegExp {
    const literal = (text: string): string => text.replace(/[.*+?^${}()|[\]\\/-]/g, "\\$&");
    const parts = template.split(/(\{[A-Za-z][A-Za-z0-9]*\})/);
    const body = parts
        .map((part) => {
            const name = /^\{([A-Za-z][A-Za-z0-9]*)\}$/.exec(part)?.[1];
            if (name === "service") return literal(service);
            if (name === "environment") return literal(environment);
            if (name === "ticket" || name === "version") return "[A-Za-z0-9._-]+?";
            return literal(part);
        })
        .join("");
    return new RegExp(`^${body}$`);
}
