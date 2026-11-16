// A company's proposed entry for a section the person owns (startChecks, git.accounts, secrets.pass): setup asks once,
// writes it only on a yes, and remembers a no in the agent folder's onboarding.json. The person can always edit or empty
// the list afterwards; this file never writes a section without that answer.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { OnboardingEntry, OnboardingItem } from "./contract.ts";
import type { SetupField, SetupPlan, SetupSection, SetupState, SetupChange } from "./setup-plan.ts";
import { parsePassBinding } from "./config.ts";
import { layered } from "./section-defaults.ts";
import { parseStartChecks } from "./start-checks.ts";
import { validateAccounts } from "./kit/accounts.ts";
import { setValuePath } from "./setup-write.ts";

export interface ProposalItem {
    kind: "proposal";
    section: string;
    path?: string;
    key?: string;
    value: unknown;
    label: string;
    why?: string;
}

const PATH = /^[A-Za-z0-9_][A-Za-z0-9_-]*(\.[A-Za-z0-9_][A-Za-z0-9_-]*)*$/;
const SECTIONS = new Set(["startChecks", "git", "secrets"]);
const MAX_VALUE = 4_000;
const PASS_BINDING_KEYS = ["storeDir", "gnupgHome", "unlockAtStart"] as const;

/** Why one `secrets.pass` key and value is not a pass binding; empty when it is. */
export function validatePassBinding(key: string, value: unknown): string[] {
    if (!(PASS_BINDING_KEYS as readonly string[]).includes(key)) {
        return [`secrets.pass.${key.slice(0, 80)}: must be one of ${PASS_BINDING_KEYS.join(", ")}`];
    }
    const errors: string[] = [];
    parsePassBinding({ [key]: value }, "secrets.pass", (where, message) => errors.push(`${where}: ${message}`));
    return errors;
}

function oneLine(value: unknown, max: number): value is string {
    return (
        typeof value === "string" && value.trim() !== "" && value.length <= max && !/[\u0000-\u001f\u007f]/.test(value)
    );
}

/** Checks one proposed entry, adding plain messages for its errors. Called by `checkOnboarding`. */
export function checkProposal(item: Record<string, unknown>, at: string, errors: string[]): void {
    if (!SECTIONS.has(String(item.section))) {
        errors.push(`${at}.section: a proposal may name startChecks, git or secrets`);
    }
    if (item.path !== undefined && (typeof item.path !== "string" || !PATH.test(item.path))) {
        errors.push(`${at}.path: a dotted path inside the section`);
    }
    if (item.key !== undefined && !oneLine(item.key, 200)) errors.push(`${at}.key: one line of at most 200 characters`);
    if (!oneLine(item.label, 120)) errors.push(`${at}.label: needed, one line`);
    if (item.why !== undefined && !oneLine(item.why, 400)) errors.push(`${at}.why: one line of at most 400 characters`);
    let encoded: string;
    try {
        encoded = JSON.stringify(item.value);
    } catch {
        encoded = "";
    }
    if (item.value === undefined || encoded === "" || encoded.length > MAX_VALUE) {
        errors.push(`${at}.value: needed, and at most ${MAX_VALUE} characters of JSON`);
    }
    if (item.section === "startChecks") {
        if (item.path !== undefined || item.key !== undefined)
            errors.push(`${at}: a startChecks proposal is one list entry, so it has no path or key`);
        else parseStartChecks([item.value], `${at}.value`, (_, message) => errors.push(message));
    }
    if (item.section === "git" && (item.path !== "accounts" || item.key === undefined)) {
        errors.push(`${at}: a git proposal is an accounts entry, with path "accounts" and a key`);
    } else if (item.section === "git" && item.key !== undefined) {
        for (const message of validateAccounts({ [String(item.key)]: item.value })) errors.push(message);
    }
    if (item.section === "secrets") {
        if (item.path !== "pass" || item.key === undefined) {
            errors.push(`${at}: a secrets proposal is a pass binding, with path "pass" and a key`);
        } else for (const message of validatePassBinding(String(item.key), item.value)) errors.push(message);
    }
}

/** The sections a proposal can name, for `/jig setup <section>` and the setup plan. */
export function proposalSections(entry: OnboardingEntry | undefined): Set<string> {
    return new Set((entry?.items ?? []).flatMap((item) => (item.kind === "proposal" ? [item.section] : [])));
}

/** The stable identity of a proposal: what it writes, so a changed value asks again. */
export function proposalId(item: ProposalItem): string {
    return JSON.stringify([item.section, item.path ?? null, item.key ?? null, item.value]);
}

/** Where a no is kept: beside jig.json, never in it, in the agent folder. */
export function decisionsFile(configPath: string): string {
    return path.join(path.dirname(configPath), "onboarding.json");
}

/** The proposal IDs the person has declined. A missing or unreadable file means none. */
export function readDeclined(file: string): Set<string> {
    try {
        const parsed = JSON.parse(readFileSync(file, "utf8")) as { declined?: unknown };
        return new Set(
            Array.isArray(parsed.declined)
                ? parsed.declined.filter((entry): entry is string => typeof entry === "string")
                : [],
        );
    } catch {
        return new Set();
    }
}

/** Records a no. A write failure is not fatal: setup still does not add the entry. */
export function recordDeclined(file: string, id: string): void {
    const declined = readDeclined(file);
    declined.add(id);
    try {
        writeFileSync(file, `${JSON.stringify({ declined: [...declined].sort() }, null, 2)}\n`, { mode: 0o600 });
    } catch {
        // The answer still holds for this run; the next run may ask again.
    }
}

function atPath(raw: Record<string, unknown>, dotted: string): unknown {
    let current: unknown = raw;
    for (const part of dotted === "" ? [] : dotted.split(".")) {
        if (typeof current !== "object" || current === null || Array.isArray(current)) return undefined;
        current = (current as Record<string, unknown>)[part];
    }
    return current;
}

/** Whether the entry is already there, so setup does not ask again after a yes or a person's own edit. */
export function proposalPresent(raw: Record<string, unknown>, item: ProposalItem): boolean {
    const value = atPath(
        raw,
        item.path === undefined || item.path === "" ? item.section : `${item.section}.${item.path}`,
    );
    if (item.key !== undefined)
        return typeof value === "object" && value !== null && !Array.isArray(value) && Object.hasOwn(value, item.key);
    return Array.isArray(value) && value.some((entry) => JSON.stringify(entry) === JSON.stringify(item.value));
}

/** The proposal fields for one plan, in the company's order, skipping declined and already-present ones. */
export function proposalFields(
    entry: OnboardingEntry,
    state: SetupState,
    raw: Record<string, unknown>,
    declined: ReadonlySet<string>,
): Array<{ section: SetupSection; order: number }> {
    const candidates = new Map<string, { section: SetupSection; order: number }>();
    for (const [index, item] of entry.items.entries()) {
        if (item.kind !== "proposal") continue;
        if (declined.has(proposalId(item)) || proposalPresent(raw, item)) continue;
        let candidate = candidates.get(item.section);
        if (candidate === undefined) {
            candidate = {
                section: {
                    name: item.section,
                    label: item.section === "startChecks" ? "Start checks" : item.section,
                    fields: [],
                    notes: [],
                },
                order: 10_000 + index,
            };
            candidates.set(item.section, candidate);
        }
        candidate.section.fields.push({
            section: item.section,
            path: item.path ?? "",
            label: item.label,
            question:
                item.section === "secrets" && (item.key === "storeDir" || item.key === "gnupgHome")
                    ? `${item.label} — this changes where your secrets are read from.`
                    : item.label,
            kind: "proposal",
            reason: item.why ?? "The company's list proposes this entry; you decide.",
            proposal: item,
        });
    }
    return [...candidates.values()];
}

/** The same parsers the loader uses for a proposed section, so setup refuses a value that would break jig.json. */
function sectionProblems(item: ProposalItem, next: Record<string, unknown>): string[] {
    if (item.section === "startChecks") {
        const errors: string[] = [];
        parseStartChecks(next.startChecks, "startChecks", (where, message) => errors.push(`${where}: ${message}`));
        return errors;
    }
    if (item.section === "git") return validateAccounts(next.accounts);
    if (item.section === "secrets") {
        const errors: string[] = [];
        parsePassBinding(next.pass, "secrets.pass", (where, message) => errors.push(`${where}: ${message}`));
        return errors;
    }
    return [];
}

/** Writes one accepted proposal into the draft and returns its change, or a plain refusal. */
export function applyProposal(
    plan: SetupPlan,
    draft: Record<string, unknown>,
    field: SetupField,
): { change: SetupChange } | { problem: string } {
    const item = field.proposal;
    if (item === undefined) return { problem: "This proposal is incomplete; run jig setup again." };
    const existing = draft[item.section];
    if (existing !== undefined && (typeof existing !== "object" || existing === null || Array.isArray(existing))) {
        return { problem: `${item.section} is not in a shape setup can change here. /jig doctor names the problem.` };
    }
    const next = structuredClone(existing === undefined ? {} : existing) as Record<string, unknown>;
    if (item.key !== undefined) {
        const parent = item.path === undefined ? next : atPath(next, item.path);
        const object =
            typeof parent === "object" && parent !== null && !Array.isArray(parent)
                ? (parent as Record<string, unknown>)
                : {};
        object[item.key] = item.value;
        if (item.path === undefined) Object.assign(next, object);
        else setValuePath(next, item.path, object);
    } else {
        const target = atPath(next, item.path ?? "");
        const list = Array.isArray(target) ? target : [];
        list.push(item.value);
        if (item.path === undefined || item.path === "") next[item.section] = list;
        else setValuePath(next, item.path, list);
    }
    const proposalProblems = sectionProblems(item, next);
    if (proposalProblems.length > 0) return { problem: `${item.label}: ${proposalProblems[0]}` };
    const check = plan.checks.get(item.section);
    if (check !== undefined) {
        const merged = layered(
            plan.defaults.get(item.section),
            next,
            plan.replace.get(item.section) ?? [],
            plan.oneOf.get(item.section) ?? [],
            plan.union.get(item.section) ?? [],
        );
        const problems = check(merged);
        if (problems.length > 0) return { problem: `${item.label}: ${problems[0]}` };
    }
    draft[item.section] = next;
    return {
        change: {
            section: item.section,
            path: item.path ?? "",
            ...(item.key === undefined ? {} : { key: item.key }),
            ...(item.key === undefined ? { append: true } : {}),
            value: item.value,
            label: item.label,
        },
    };
}

/** One proposal's question: a yes writes it, a no is recorded and it is not asked again. */
export async function askProposal(
    plan: SetupPlan,
    field: SetupField,
    draft: Record<string, unknown>,
    changes: SetupChange[],
    ui: {
        confirm(title: string, message: string): Promise<boolean>;
        notify(text: string, level: "info" | "warning" | "error"): void;
    },
): Promise<"ok" | "cancel"> {
    const item = field.proposal;
    if (item === undefined) return "cancel";
    if (!(await ui.confirm(field.question, field.reason))) {
        recordDeclined(plan.decisionsFile, proposalId(item));
        ui.notify(`Not added: ${item.label}. Setup will not ask again.`, "info");
        return "ok";
    }
    const result = applyProposal(plan, draft, field);
    if ("change" in result) {
        changes.push(result.change);
        return "ok";
    }
    ui.notify(result.problem, "warning");
    return "ok";
}

/** The unanswered proposals in a plan; `--yes` names this count and writes none of them. */
export function pendingProposalCount(plan: SetupPlan): number {
    return plan.sections.flatMap((section) => section.fields).filter((field) => field.kind === "proposal").length;
}
