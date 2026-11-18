// What setup still needs, from the states Jig already knows, the plugin validators, the plugin's own questions and the
// company's defaults. It reads the person's file once and works out one question per missing field. A credential is asked
// for as WHERE it is kept, never as a value. Nothing here writes or talks to Pi.
import { lstatSync, readFileSync, readlinkSync, realpathSync, statSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import type { LoadedConfig, SecretBackend, SectionCheck } from "./config.ts";
import type { DetectName } from "./detect.ts";
import type { OnboardingEntry, OnboardingMethod, OnboardingSetup } from "./contract-onboarding.ts";
import type { ProposalItem } from "./contract-onboarding.ts";
import { decisionsFile, proposalFields, readDeclined } from "./setup-proposal.ts";
import type { SectionQuestions } from "./setup-section.ts";
import { sectionQuestions } from "./setup-section.ts";
import { introOf, loginsOf } from "./setup-questions.ts";
import { onboardingOrder } from "./onboarding.ts";
import { shorten } from "./secret-status.ts";
import { sectionState } from "./section-state.ts";
import { isObject } from "./setup-values.ts";

/** The part of jig-core the plan reads. `JigState` fits it once the defaults are gathered; a test can build one. */
export interface SetupState {
    personal: LoadedConfig;
    sectionChecks: ReadonlyMap<string, SectionCheck>;
    /** The company's defaults, the active company's on top: the same map `layered()` uses. */
    defaults: ReadonlyMap<string, unknown>;
    replace: ReadonlyMap<string, readonly string[]>;
    oneOf: ReadonlyMap<string, readonly (readonly string[])[]>;
    union: ReadonlyMap<string, readonly string[]>;
    configPath: string;
    /** Pi's environment, for an `env:` choice. */
    env: NodeJS.ProcessEnv;
    platform: NodeJS.Platform;
    /** Finds a program on PATH without starting it, so setup offers only stores this machine has. */
    pathLookup: (program: string, env: NodeJS.ProcessEnv) => string | undefined;
    /** The stores that can resolve a reference now: the user's, a company's, less disabled. */
    enabledBackends: readonly SecretBackend[];
    /** The person's veto list; never written or removed by setup. */
    disabledBackends: readonly SecretBackend[];
    /** The backends a company turned on; its preference is the first of these. */
    companyBackends: readonly SecretBackend[];
    /** The commands a `cmd:` reference may name. */
    commands: Readonly<Record<string, readonly string[]>>;
    /** The active company's onboarding list, when it wrote one: its order, labels and hints. */
    onboarding?: OnboardingEntry;
    /** A section the person asked to change even when it is valid; `jig setup <section>` sets it. */
    requestedSection?: string;
    /** The sign-in methods plugin sections registered. */
    onboardingMethods?: ReadonlyMap<string, readonly OnboardingMethod[]>;
    /** What each plugin section said it needs, by section. */
    sectionSetup?: ReadonlyMap<string, OnboardingSetup>;
    /** True while a company plugin is active: a method a company makes usable is offered only then. */
    companyActive?: boolean;
    /** The transports a company plugin registered in code, which a method that goes through a transport may offer. */
    pluginTransports?: readonly string[];
}

export type SetupFieldKind = "text" | "number" | "boolean" | "reference" | "pick" | "proposal" | "entry" | "object";

/** One question inside a new object: its `path` is relative to the object, and its answer is kept with the others. */
export interface SetupObjectField {
    path: string;
    label: string;
    question: string;
    kind: "text" | "pick" | "reference";
    placeholder?: string;
    reason: string;
    /** An empty answer leaves this key out of the object. */
    optional?: true;
    /** The answer is a simple list: one entry per line, or separated by commas. */
    list?: true;
    /** For a pick: the plain answers. */
    choices?: readonly string[];
    /** For a credential: where the person may keep it. */
    reference?: SetupReferenceChoice;
}

/** One shape a new object may take. A form with a `when` is asked only while the section's value there matches. */
export interface SetupObjectForm {
    label?: string;
    who?: string;
    when?: { path: string; equals: string };
    /** Written into every object of this form without asking, by path inside the object. */
    fixed?: Readonly<Record<string, string | number | boolean>>;
    fields: SetupObjectField[];
}

/** How one named object is asked: its name, and the forms it may take. */
export interface SetupObjectSpec {
    keyLabel: string;
    keyPlaceholder?: string;
    forms: SetupObjectForm[];
    /** Ask for another object after this one is accepted. */
    repeat?: boolean;
}

/** One question. `current` is for the placeholder, never a secret and never a raw reference. */
export interface SetupField {
    section: string;
    path: string;
    label: string;
    question: string;
    placeholder?: string;
    kind: SetupFieldKind;
    current?: string | number | boolean;
    reason: string;
    /** For a credential: where the person may keep it, and which choice is the company's. */
    reference?: SetupReferenceChoice;
    /** For a pick: the plain answers, from the company's list. */
    choices?: readonly string[];
    /** For a proposal: the entry the company proposes. */
    proposal?: ProposalItem;
    /** A fixed answer, from a company-only method; setup shows it and does not ask. */
    fixed?: string;
    /** The company marks it optional: an empty answer leaves it unset, and the doctor does not ask for it. */
    optional?: true;
    /** The answer is a simple list: one entry per line, or separated by commas. */
    list?: true;
    /** An empty answer keeps this value: it is set and passes, and setup only asks again so it can change. */
    keep?: true;
    /** For an entry: the two questions of one key and value of the map at `path`. */
    entry?: {
        keyLabel: string;
        keyPlaceholder?: string;
        valueLabel: string;
        valuePlaceholder?: string;
        detect?: DetectName;
        repeat?: boolean;
    };
    /** For an object: the name question and the shapes one object of the map at `path` may take. */
    object?: SetupObjectSpec;
}

export interface SetupReferenceChoice {
    /** The stores to offer, the company's or the current place first. */
    stores: SecretBackend[];
    /** The store marked "(company default)", when a company gave a default reference. */
    preferred?: SecretBackend;
    /** The store the current reference uses, marked "(current)". */
    current?: SecretBackend;
    /** The stores that are already on; a choice outside this adds one to `secrets.backends`. */
    enabled: SecretBackend[];
    /** The stores the person turned off; they are not offered, and setup says so. */
    disabled: SecretBackend[];
    commands: Readonly<Record<string, readonly string[]>>;
    /** A reference *shape* per store, from the company's list, never a value. */
    suggested?: Readonly<Partial<Record<SecretBackend, string>>>;
    /** What the company says to do to add it, per store. */
    addHints?: Readonly<Partial<Record<SecretBackend, string>>>;
    /** A file is the normal place for this credential: it is offered first, as "A file", and no warning is asked. */
    fileExpected?: true;
}

export interface SetupMethod {
    id: string;
    label: string;
    who?: string;
    /** The company's choice, or the first visible method: the one setup offers first. */
    default: boolean;
    /** True when the company's onboarding entry named this method as its default. */
    companyDefault?: true;
    /** The method the section's current values select, by required path set. */
    current?: boolean;
    fields: SetupField[];
    /** Why a wildcard produced no fields, when the plan cannot ask for a name yet. */
    notes?: string[];
}

export interface SetupSection {
    name: string;
    label: string;
    fields: SetupField[];
    /** The sign-in methods this section's plugin declared; setup asks the question before these fields. */
    methods?: SetupMethod[];
    /** True when setup asks which method the person signs in with. */
    askMethod: boolean;
    /** Things setup cannot ask for here, such as a credential or a value that is a list. */
    notes: string[];
}

export interface SetupPlan {
    /** The path in the settings, which may be a link. */
    file: string;
    /** The regular file read and written: the link's target, or the same path when it is not a link. */
    target: string;
    /** True when `file` is a link and `target` is where it points. */
    link: boolean;
    exists: boolean;
    before: string;
    mode: number;
    raw: Record<string, unknown>;
    sections: SetupSection[];
    /** File-level notes, when there is nothing to ask but something to say. */
    notes: string[];
    /** What the company and the plugins say before the questions, from their `info` items. */
    intro: string[];
    /** Logins the lists name, the program each needs and the command that performs it: setup shows it, never runs it,
     *  and says when the program is not installed. */
    logins: Array<{ label: string; tool: string; command: string; why?: string }>;
    defaults: ReadonlyMap<string, unknown>;
    checks: ReadonlyMap<string, SectionCheck>;
    /** Proposal IDs the person has declined, and the file where a no is kept. */
    declined: ReadonlySet<string>;
    decisionsFile: string;
    replace: ReadonlyMap<string, readonly string[]>;
    oneOf: ReadonlyMap<string, readonly (readonly string[])[]>;
    union: ReadonlyMap<string, readonly string[]>;
}

export type SetupPlanResult = { plan: SetupPlan } | { problem: string };

/** A change the person accepted: one field, its plain label, and what was there before. */
export interface SetupChange {
    section: string;
    path: string;
    label: string;
    oldValue?: unknown;
    value: unknown;
    /** A plain phrase for a reference's place, such as "pass entry work/jira-token". Never a reference. */
    note?: string;
    /** The stores to turn on in `secrets.backends`, when the chosen places are not on yet. */
    enableBackends?: readonly SecretBackend[];
    /** A map entry's key: set it, rather than the whole value at `path`. */
    key?: string;
    /** Append this value to the list at `path`, rather than replacing it. */
    append?: boolean;
}

/** Whether the company's list names any answer in this section, so setup asks its questions first. */
function companyNames(entry: OnboardingEntry | undefined, section: string): boolean {
    return (entry?.items ?? []).some(
        (item) => item.kind !== "info" && item.kind !== "login" && item.kind !== "proposal" && item.section === section,
    );
}

/** The plan: read the file, then build one question per field that is missing for each section in play. */
export function buildSetupPlan(state: SetupState): SetupPlanResult {
    if (state.configPath === "") {
        return { problem: "Pi has not told Jig where its settings are. Restart Pi, then run /jig setup again." };
    }
    let exists = false;
    let before = "";
    let mode = 0o600;
    let target = state.configPath;
    let link = false;
    try {
        const entry = lstatSync(state.configPath);
        if (entry.isSymbolicLink()) {
            link = true;
            try {
                target = realpathSync(state.configPath);
            } catch {
                let written = "";
                try {
                    written = readlinkSync(state.configPath);
                } catch {
                    // The link is there; its text is not readable.
                }
                const shown =
                    written === ""
                        ? "a missing target"
                        : shorten(
                              path.isAbsolute(written)
                                  ? written
                                  : path.resolve(path.dirname(state.configPath), written),
                              homedir(),
                          );
                return {
                    problem: `Your settings file is a link to ${shown}, which does not exist. Fix the link, then run /jig setup again.`,
                };
            }
            const info = statSync(target);
            if (!info.isFile()) {
                return {
                    problem: `Your settings file is a link to ${shorten(target, homedir())}, which is not a file. Setup changes nothing.`,
                };
            }
            exists = true;
            mode = info.mode & 0o777;
            before = readFileSync(target, "utf8");
        } else if (entry.isFile()) {
            exists = true;
            mode = entry.mode & 0o777;
            before = readFileSync(state.configPath, "utf8");
        } else {
            return { problem: "Your Jig settings are not a file. /jig doctor names the problem." };
        }
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
            return { problem: "Your Jig settings could not be read. /jig doctor names the problem." };
        }
    }
    const linkNote = link
        ? `Your settings file is a link to ${shorten(target, homedir())}; that file will be changed.`
        : undefined;

    let raw: unknown = {};
    if (exists) {
        try {
            // A byte-order mark is not part of the JSON, and `config.ts` ignores it too.
            raw = JSON.parse(before.replace(/^\uFEFF/, ""));
        } catch {
            return {
                problem:
                    "Your Jig settings are not valid JSON. /jig doctor names the problem; fix it, then run /jig setup again.",
            };
        }
    }
    if (!isObject(raw)) {
        return { problem: "Your Jig settings are not one object. /jig doctor names the problem." };
    }

    const candidates: Array<{ section: SetupSection; priority: number; order: number }> = [];
    let order = 0;
    for (const name of state.sectionChecks.keys()) {
        order++;
        const now = sectionState(state.personal, name);
        const requested = state.requestedSection === name;
        // A section nobody needs to change waits, and a section that is not set is offered in setup's plugin list; a
        // company's list may still name an answer in either, and then setup asks for it.
        if (!requested && !companyNames(state.onboarding, name) && (now === "loaded" || now === "not set")) continue;
        const questions: SectionQuestions = sectionQuestions(state, name, raw, requested);
        if (questions.fields.length === 0 && questions.notes.length === 0 && !questions.askMethod) continue;
        candidates.push({
            section: {
                name,
                label: questions.label,
                fields: questions.fields,
                ...(questions.methods === undefined ? {} : { methods: questions.methods }),
                askMethod: questions.askMethod,
                notes: questions.notes,
            },
            priority: now === "company defaults incomplete" ? 0 : 1,
            order,
        });
    }

    // A company's proposals ask before writing an entry into a section the person owns.
    const entry = state.onboarding;
    const decisions = decisionsFile(state.configPath);
    const declined = readDeclined(decisions);
    if (entry !== undefined) {
        for (const proposal of proposalFields(entry, state, raw, declined)) {
            const existing = candidates.find((candidate) => candidate.section.name === proposal.section.name);
            if (existing === undefined) candidates.push({ ...proposal, priority: 0 });
            else existing.section.fields.push(...proposal.section.fields);
        }
    }

    // The sections the person is being asked about, in the company's order first, then as the plugins are registered.
    const lists = candidates.map((candidate) => state.sectionSetup?.get(candidate.section.name)?.items ?? []);
    const intro = introOf(entry, lists);
    const logins = loginsOf(entry, lists);
    if (entry !== undefined) {
        const positions = onboardingOrder(entry);
        candidates.sort(
            (left, right) =>
                (positions.get(left.section.name) ?? Number.MAX_SAFE_INTEGER) -
                    (positions.get(right.section.name) ?? Number.MAX_SAFE_INTEGER) ||
                left.priority - right.priority ||
                left.order - right.order,
        );
    } else {
        candidates.sort((left, right) => left.priority - right.priority || left.order - right.order);
    }
    return {
        plan: {
            file: state.configPath,
            target,
            link,
            exists,
            before,
            mode,
            raw,
            sections: candidates.map((candidate) => candidate.section),
            notes: linkNote === undefined ? [] : [linkNote],
            intro,
            logins,
            defaults: state.defaults,
            checks: state.sectionChecks,
            declined,
            decisionsFile: decisions,
            replace: state.replace,
            oneOf: state.oneOf,
            union: state.union,
        },
    };
}
