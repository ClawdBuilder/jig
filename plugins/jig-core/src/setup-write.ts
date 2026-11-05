// The last part of `/jig setup`: the plain summary, the exact JSON behind its choice, and the write gate that re-reads,
// backs up beside the file, and replaces it whole and atomically. It never decides what to ask; setup-plan.ts does.
import { randomBytes } from "node:crypto";
import { readFileSync, realpathSync } from "node:fs";
import { createFileDurably, replaceFileDurably } from "./kit/files.ts";
import type { SecretBackend } from "./config.ts";
import type { SetupChange, SetupPlan } from "./setup-plan.ts";
import { parseSecretReference } from "./secrets.ts";

/** One plain line per change, then the notes setup could not act on. No JSON and no reference syntax. */
export function summaryLines(plan: SetupPlan, changes: readonly SetupChange[]): string[] {
    const lines = changes.map(
        (change) =>
            `${change.label}: ${change.note ?? displayValue(change.value)} (${
                change.oldValue === undefined ? "new" : "changed"
            })`,
    );
    const enabling = [
        ...new Set(changes.flatMap((change) => (change.enableBackend === undefined ? [] : [change.enableBackend]))),
    ];
    const backendLines = enabling.map((store) => `Turn on ${BACKEND_LABEL[store]} as a place Jig reads from.`);
    return [...plan.notes, ...lines, ...backendLines, ...plan.sections.flatMap((section) => section.notes)];
}

const BACKEND_LABEL: Record<SecretBackend, string> = {
    op: "1Password",
    keychain: "the macOS Keychain",
    pass: "pass",
    env: "an environment variable",
    file: "a file",
    cmd: "a tool that owns the login",
};

/** The JSON of exactly the changed fields, for the "Show the exact change" choice and nowhere else. */
export function exactChangeLines(changes: readonly SetupChange[]): string[] {
    const grouped: Record<string, unknown> = {};
    for (const change of changes) {
        if (!isObject(grouped[change.section])) grouped[change.section] = {};
        setValuePath(grouped[change.section] as Record<string, unknown>, change.path, change.value);
    }
    return JSON.stringify(grouped, null, 4).split("\n");
}

/** The write gate: re-read, refuse a changed file, back up beside it, then replace it whole and atomically. */
export class SetupRefused extends Error {}

export interface SetupWriteResult {
    file: string;
    backup?: string;
    changes: number;
}

export function writeSetup(plan: SetupPlan, changes: readonly SetupChange[], now: Date): SetupWriteResult {
    if (changes.length === 0) throw new SetupRefused("There is nothing to save.");

    if (plan.link) {
        let nowTarget: string;
        try {
            nowTarget = realpathSync(plan.file);
        } catch {
            throw new SetupRefused(
                "Your settings file is a link whose target cannot be read, so nothing was written. Run jig setup again.",
            );
        }
        if (nowTarget !== plan.target) {
            throw new SetupRefused(
                "Your settings file is a link that now points somewhere else, so nothing was written. Run jig setup again.",
            );
        }
    }

    let current: string | undefined;
    try {
        current = readFileSync(plan.target, "utf8");
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
            throw new SetupRefused("Your settings file could not be read, so nothing was written.");
        }
    }
    if (plan.exists && current !== plan.before) {
        throw new SetupRefused(
            "Your settings file changed while setup was open, so nothing was written. Run jig setup again.",
        );
    }
    if (!plan.exists && current !== undefined) {
        throw new SetupRefused(
            "Your settings file was created while setup was open, so nothing was written. Run jig setup again.",
        );
    }

    const after = structuredClone(plan.raw);
    for (const change of changes) {
        if (change.path === "") {
            // A top-level value, such as the `profile` that says which company setup applies.
            after[change.section] = change.value;
            continue;
        }
        if (!isObject(after[change.section])) after[change.section] = {};
        setValuePath(after[change.section] as Record<string, unknown>, change.path, change.value);
    }
    const enabling = [
        ...new Set(changes.flatMap((change) => (change.enableBackend === undefined ? [] : [change.enableBackend]))),
    ];
    if (enabling.length > 0) {
        if (after.secrets !== undefined && !isObject(after.secrets)) {
            throw new SetupRefused("Your settings have a secrets section setup cannot change. /jig doctor names it.");
        }
        const secrets = isObject(after.secrets) ? after.secrets : {};
        if (secrets.backends !== undefined && !Array.isArray(secrets.backends)) {
            throw new SetupRefused("Your settings have a secret store list setup cannot change. /jig doctor names it.");
        }
        const backends = Array.isArray(secrets.backends)
            ? secrets.backends.filter((value): value is string => typeof value === "string")
            : [];
        const disabled = Array.isArray(secrets.disabledBackends)
            ? secrets.disabledBackends.filter((value): value is string => typeof value === "string")
            : [];
        for (const store of enabling) {
            if (disabled.includes(store)) {
                throw new SetupRefused("You turned that store off, so setup does not turn it on.");
            }
            if (!backends.includes(store)) backends.push(store);
        }
        secrets.backends = backends;
        after.secrets = secrets;
    }

    let backup: string | undefined;
    if (plan.exists) {
        const stamp = now.toISOString().replace(/[:.]/g, "-");
        backup = `${plan.target}.${stamp}.${randomBytes(3).toString("hex")}.bak`;
        createFileDurably(backup, plan.before, plan.mode === 0 ? 0o600 : plan.mode);
    }
    replaceFileDurably(
        plan.target,
        `${JSON.stringify(after, null, indentOf(plan.before))}\n`,
        plan.exists ? (plan.mode === 0 ? 0o600 : plan.mode) : 0o600,
    );
    return { file: plan.target, ...(backup === undefined ? {} : { backup }), changes: changes.length };
}

function displayValue(value: unknown): string {
    if (typeof value === "boolean") return value ? "yes" : "no";
    if (typeof value === "number") return String(value);
    const text = String(value);
    if (isReference(text)) return "a value Jig reads when needed";
    return text
        .replace(/[\u0000-\u001f\u007f]/g, " ")
        .replace(/[{}]/g, "")
        .slice(0, 160);
}

function indentOf(before: string): number {
    return /\n {2}"/.test(before) && !/\n {4}"/.test(before) ? 2 : 4;
}

/** Sets a dotted path in a JSON object, creating the objects above it. `setup-plan.ts` uses it for a draft too. */
export function setValuePath(target: Record<string, unknown>, path: string, value: unknown): void {
    const parts = path.split(".");
    let at = target;
    for (const part of parts.slice(0, -1)) {
        if (!isObject(at[part])) at[part] = {};
        at = at[part] as Record<string, unknown>;
    }
    at[parts.at(-1) ?? path] = value;
}

function isObject(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isReference(value: unknown): boolean {
    return typeof value === "string" && parseSecretReference(value) !== undefined;
}
