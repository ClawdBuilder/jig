// The secret part of `/jig doctor`: which stores are on, every reference the effective settings name, and what each one's
// status is. A reference is found by walking the loaded sections and the company's defaults for a string that is one of
// the six shapes; a value is never read. A missing one comes with the store's own command to add it, in plain words.
import { accessSync, constants, existsSync, statSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { effectiveBackends } from "./config.ts";
import type { SecretBackend } from "./config.ts";
import type { DoctorContext, DoctorLine, DoctorOptions } from "./doctor.ts";
import { probeSecret, shorten, storeName } from "./secret-status.ts";
import type { SecretProbe, SecretProbeOptions } from "./secret-status.ts";
import { parseSecretReference } from "./secrets.ts";

/** The most references one report lists. A configuration with more is cut with a line that says so. */
const MAX_REFERENCES = 40;
/** The most values walked while looking for references, and the deepest. Settings are small; this is a guard. */
const MAX_VALUES = 2000;
const MAX_DEPTH = 16;

interface FoundReference {
    section: string;
    path: string;
    ref: string;
    backend: SecretBackend;
    rest: string;
    label: string;
}

/** Every reference in the effective settings, with a plain label for each. Strings that are not references are skipped. */
export function collectReferences(context: DoctorContext): { refs: FoundReference[]; truncated: boolean } {
    const refs: FoundReference[] = [];
    let seen = 0;
    let truncated = false;

    const walk = (value: unknown, section: string, at: string, depth: number): void => {
        if (truncated) return;
        if (seen++ > MAX_VALUES || depth > MAX_DEPTH) {
            truncated = true;
            return;
        }
        if (typeof value === "string") {
            const parsed = parseSecretReference(value);
            if (parsed === undefined) return;
            if (refs.length >= MAX_REFERENCES) {
                truncated = true;
                return;
            }
            refs.push({
                section,
                path: at,
                ref: value,
                backend: parsed.backend,
                rest: parsed.rest,
                label: plainLabel(section, at),
            });
            return;
        }
        if (Array.isArray(value)) {
            for (const [index, item] of value.entries()) walk(item, section, `${at}[${index}]`, depth + 1);
            return;
        }
        if (typeof value === "object" && value !== null) {
            for (const [key, item] of Object.entries(value))
                walk(item, section, at === "" ? key : `${at}.${key}`, depth + 1);
        }
    };

    for (const [section, value] of context.sections) walk(value, section, "", 0);
    return { refs, truncated };
}

/** Every string in the effective sections, for "does anything here use GitHub?" without running a program. */
export function sectionTexts(context: DoctorContext): string[] {
    const out: string[] = [];
    const walk = (value: unknown, depth: number): void => {
        if (out.length >= MAX_VALUES || depth > MAX_DEPTH) return;
        if (typeof value === "string") {
            out.push(value);
            return;
        }
        if (Array.isArray(value)) {
            for (const item of value) walk(item, depth + 1);
            return;
        }
        if (typeof value === "object" && value !== null) {
            for (const item of Object.values(value)) walk(item, depth + 1);
        }
    };
    for (const value of context.sections.values()) walk(value, 0);
    return out;
}

/** A short name a person reads: "Jira token", not "jira.auth.token". */
export function plainLabel(section: string, at: string): string {
    const parts = at
        .split(/[.[\]]+/)
        .filter((part) => part !== "" && !/^\d+$/.test(part))
        .map(humanize);
    const words = [humanize(section), ...parts].filter((word, index, all) => word !== "" && word !== all[index - 1]);
    const label = words.join(" ");
    return label.charAt(0).toUpperCase() + label.slice(1);
}

function humanize(word: string): string {
    const spaced = word
        .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
        .replace(/[_-]+/g, " ")
        .trim()
        .toLowerCase();
    if (spaced === "url") return "URL";
    if (spaced === "id") return "ID";
    if (spaced === "api") return "API";
    if (spaced === "sso") return "SSO";
    if (spaced === "mcp") return "MCP";
    return spaced;
}

/** The secret checks: stores, the pass folder, every reference, and the commands they name. */
export function checkSecrets(context: DoctorContext, options: DoctorOptions): DoctorLine[] {
    const lines: DoctorLine[] = [];
    const { on, byCompany, off } = effectiveBackends(context.personal.config.secrets, context.company);
    if (on.length === 0) {
        lines.push({
            id: "secrets.backends",
            group: "secrets",
            level: "fail",
            title: "Secret stores",
            detail: "No store is turned on, so no reference can be read.",
            fix: "Turn on the store you keep your credentials in, in your Jig settings (secrets.backends).",
        });
    } else {
        const who = byCompany.length === 0 ? "" : ` (${byCompany.join(", ")} turned on by a company plugin)`;
        const disabled = off.length === 0 ? "" : `; turned off: ${off.join(", ")}`;
        lines.push({
            id: "secrets.backends",
            group: "secrets",
            level: "ok",
            title: "Secret stores",
            detail: `${on.join(", ")}${who}${disabled}`,
        });
    }

    const passDir = passStoreDir(context);
    if (on.includes("pass")) {
        if (passDir === "") {
            lines.push({
                id: "secrets.pass",
                group: "secrets",
                level: "warn",
                title: "pass store",
                detail: "Jig could not work out which folder pass reads.",
                fix: "Set secrets.pass.storeDir in your Jig settings, or set PASSWORD_STORE_DIR.",
            });
        } else if (!existsSync(passDir)) {
            lines.push({
                id: "secrets.pass",
                group: "secrets",
                level: "warn",
                title: "pass store",
                detail: `The folder pass reads does not exist yet: ${shorten(passDir, home(options))}`,
                fix: "Create it with pass init <your GPG key>.",
            });
        } else {
            lines.push({
                id: "secrets.pass",
                group: "secrets",
                level: "ok",
                title: "pass store",
                detail: shorten(passDir, home(options)),
            });
        }
    }
    if (context.personal.config.secrets.pass.unlockAtStart === true && !on.includes("pass")) {
        lines.push({
            id: "secrets.unlock",
            group: "secrets",
            level: "warn",
            title: "Unlock at start",
            detail: "It is on, but pass is not one of the stores that are on, so nothing unlocks.",
            fix: "Turn pass on, or turn unlockAtStart off.",
        });
    }

    const { refs, truncated } = collectReferences(context);
    if (refs.length === 0) {
        lines.push({
            id: "secrets.refs",
            group: "secrets",
            level: "skip",
            title: "Secret references",
            detail: "None are in use in your settings.",
        });
        return lines;
    }

    const lookup = lookupFor(options);
    const used = new Set(refs.map((found) => found.backend));
    if (used.has("pass") && lookup("pass", context.env) === undefined) {
        lines.push({
            id: "secrets.program.pass",
            group: "secrets",
            level: "fail",
            title: "pass is not installed",
            detail: "Your settings read a secret from pass, but its command is not on PATH.",
            fix: "Install pass (on Debian or Ubuntu: sudo apt install pass), then run /jig doctor again.",
        });
    }
    if (used.has("op") && lookup("op", context.env) === undefined) {
        lines.push({
            id: "secrets.program.op",
            group: "secrets",
            level: "fail",
            title: "1Password's command is not installed",
            detail: "Your settings read a secret from 1Password, but the op command is not on PATH.",
            fix: "Install the 1Password command-line tool, then run /jig doctor again.",
        });
    }

    const checkedCommands = new Set<string>();
    for (const found of refs) {
        if (!on.includes(found.backend)) {
            lines.push({
                id: referenceId(found),
                group: "secrets",
                level: "fail",
                title: found.label,
                detail: `Your ${found.label} is set to use ${found.backend}, but that store is turned off.`,
                fix: `Turn ${found.backend} back on in your Jig settings (secrets.backends).`,
            });
            continue;
        }
        if (found.backend === "pass" && passDir === "") {
            lines.push(notChecked(found, "Jig could not find the pass folder"));
            continue;
        }
        if (found.backend === "pass" && lookup("pass", context.env) === undefined) {
            lines.push(notChecked(found, "pass is not installed"));
            continue;
        }
        if (found.backend === "op" && lookup("op", context.env) === undefined) {
            lines.push(notChecked(found, "1Password's command is not installed"));
            continue;
        }
        if (found.backend === "cmd") {
            const line = checkCommand(found, context, lookup, checkedCommands);
            if (line !== undefined) {
                lines.push(line);
                continue;
            }
        }
        lines.push(referenceLine(found, probeSecret(found.ref, probeOptions(context, options)), context, options));
    }
    if (truncated) {
        lines.push({
            id: "secrets.refs.truncated",
            group: "secrets",
            level: "skip",
            title: "More references",
            detail: `Only the first ${MAX_REFERENCES} references were checked.`,
        });
    }
    return lines;
}

/** How many things a person has to act on, cheaply: no program is started, and no store is opened. */
export function countQuickIssues(context: DoctorContext): number {
    const { on } = effectiveBackends(context.personal.config.secrets, context.company);
    let count = context.personal.problems.length + context.personal.incomplete.size;
    if (context.recordsProblem !== undefined) count++;
    const { refs } = collectReferences(context);
    const options: DoctorOptions = {};
    for (const found of refs) {
        if (!on.includes(found.backend)) {
            count++;
            continue;
        }
        // cmd, op and keychain are not probed without a program, so they never add to the nudge.
        if (found.backend !== "pass" && found.backend !== "env" && found.backend !== "file") continue;
        if (found.backend === "pass" && passStoreDir(context) === "") continue;
        const probe = probeSecret(found.ref, probeOptions(context, options));
        if (probe.status === "missing" || probe.status === "invalid" || probe.status === "locked") count++;
    }
    return count;
}

/** Finds a program on PATH without starting it. */
export function findOnPath(
    program: string,
    env: NodeJS.ProcessEnv,
    platform: NodeJS.Platform = process.platform,
): string | undefined {
    const folders = (env.PATH ?? env.Path ?? "").split(path.delimiter).filter((folder) => folder !== "");
    const extensions = platform === "win32" ? (env.PATHEXT ?? ".EXE;.CMD;.BAT;.COM").split(";").filter(Boolean) : [""];
    for (const folder of folders) {
        for (const extension of extensions) {
            const candidate = path.join(folder, program + extension);
            try {
                if (statSync(candidate).isFile()) {
                    accessSync(candidate, constants.X_OK);
                    return candidate;
                }
            } catch {
                // Not here, or not executable: try the next one.
            }
        }
    }
    return undefined;
}

function lookupFor(options: DoctorOptions): (program: string, env: NodeJS.ProcessEnv) => string | undefined {
    return options.pathLookup ?? ((program, env) => findOnPath(program, env, options.platform ?? process.platform));
}

function checkCommand(
    found: FoundReference,
    context: DoctorContext,
    lookup: (program: string, env: NodeJS.ProcessEnv) => string | undefined,
    checked: Set<string>,
): DoctorLine | undefined {
    const declared = context.commands[found.rest];
    if (declared === undefined) {
        return {
            id: referenceId(found),
            group: "secrets",
            level: "fail",
            title: found.label,
            detail: `Your ${found.label} names a command that is not declared.`,
            fix: `Declare "${found.rest}" in secrets.commands, or choose another command.`,
        };
    }
    if (checked.has(found.rest)) return undefined;
    checked.add(found.rest);
    const program = declared[0];
    if (program === undefined || program === "") {
        return {
            id: referenceId(found),
            group: "secrets",
            level: "fail",
            title: found.label,
            detail: `The command "${found.rest}" has no program to run.`,
            fix: `Declare the program for "${found.rest}" in secrets.commands.`,
        };
    }
    if (lookup(program, context.env) === undefined) {
        return {
            id: referenceId(found),
            group: "secrets",
            level: "fail",
            title: found.label,
            detail: `The command "${found.rest}" uses ${program}, which is not installed.`,
            fix: `Install ${program}, or declare another command for "${found.rest}".`,
        };
    }
    return undefined;
}

function referenceLine(
    found: FoundReference,
    probe: SecretProbe,
    context: DoctorContext,
    options: DoctorOptions,
): DoctorLine {
    const title = found.label;
    switch (probe.status) {
        case "found":
            return { id: referenceId(found), group: "secrets", level: "ok", title, detail: foundDetail(found, probe) };
        case "missing":
            return {
                id: referenceId(found),
                group: "secrets",
                level: "fail",
                title,
                detail: missingDetail(found),
                ...(probe.fix === undefined ? {} : { fix: probe.fix }),
            };
        case "locked":
            return {
                id: referenceId(found),
                group: "secrets",
                level: "warn",
                title,
                detail: `Your ${title} is in ${storeName(found.backend)}, but the store is locked.`,
                fix: `Unlock ${storeName(found.backend)} with its own tool, then run /jig doctor again.`,
            };
        case "invalid":
            return {
                id: referenceId(found),
                group: "secrets",
                level: "fail",
                title,
                detail: `Your ${title} cannot be used: ${probe.detail}.`,
                fix: `Change it in ${shorten(context.configPath, home(options))}.`,
            };
        default:
            return {
                id: referenceId(found),
                group: "secrets",
                level: "skip",
                title,
                detail: `Your ${title} is in ${storeName(found.backend)}; Jig does not read it to check it.`,
            };
    }
}

function foundDetail(found: FoundReference, probe: SecretProbe): string {
    if (found.backend === "pass") return "Found in pass (it may ask to unlock).";
    if (found.backend === "env") return "Found in this session's environment.";
    if (found.backend === "file") return "Found; the first line is read when a tool needs it.";
    return probe.detail === undefined ? "Found." : `${probe.detail}.`;
}

function missingDetail(found: FoundReference): string {
    if (found.backend === "pass") return `Your ${found.label} is missing from pass.`;
    if (found.backend === "env") return `Your ${found.label} is not set in the environment Pi runs in.`;
    if (found.backend === "file") return `Your ${found.label} is missing: the file does not exist or is empty.`;
    return `Your ${found.label} is missing from ${storeName(found.backend)}.`;
}

function notChecked(found: FoundReference, why: string): DoctorLine {
    return {
        id: referenceId(found),
        group: "secrets",
        level: "skip",
        title: found.label,
        detail: `Not checked: ${why}.`,
    };
}

function probeOptions(context: DoctorContext, options: DoctorOptions): SecretProbeOptions {
    return {
        env: context.env,
        passStoreDir: passStoreDir(context),
        agentDir: context.agentDir,
        ...(options.platform === undefined ? {} : { platform: options.platform }),
        home: home(options),
    };
}

function passStoreDir(context: DoctorContext): string {
    try {
        return context.secrets.passStoreDir();
    } catch {
        return "";
    }
}

function home(options: DoctorOptions): string {
    return options.home ?? homedir();
}

function referenceId(found: FoundReference): string {
    const at = found.path === "" ? "value" : found.path;
    return `secrets.ref.${found.section}.${at}`.replace(/[^\w.]+/g, ".");
}
