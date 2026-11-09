// `/jig setup`: the questions, the plain summary, and the one confirmation that writes. It is a command, never a tool,
// so the model cannot run it. Every screen is plain words; the only JSON is behind "Show the exact change".
import { homedir } from "node:os";

import { errorMessage } from "./errors.ts";
import { run as runProgram } from "./exec.ts";
import { effectiveBackends } from "./config.ts";
import type { SecretBackend } from "./config.ts";
import { findOnPath } from "./doctor-secrets.ts";
import { activeOnboarding, effectiveDefaults } from "./profile-state.ts";
import { probeSecret, shorten } from "./secret-status.ts";
import type { SecretProbe } from "./secret-status.ts";
import { applyAnswer, buildSetupPlan } from "./setup-plan.ts";
import { buildReference, describeReference, storeChoiceLabel, storeLabel } from "./setup-reference.ts";
import { exactChangeLines, SetupRefused, summaryLines, writeSetup } from "./setup-write.ts";
import type { ReferenceParts } from "./setup-reference.ts";
import type { SetupChange, SetupField, SetupPlan, SetupState } from "./setup-plan.ts";
import type { JigState } from "./state.ts";

/** Runs the whole flow. It writes nothing unless the person confirms the summary. */
/** What a screen has to offer: Pi's UI in a session, a terminal in the `jig` command. */
export interface SetupUi {
    select(title: string, options: string[]): Promise<string | undefined>;
    input(title: string, placeholder?: string): Promise<string | undefined>;
    confirm(title: string, message: string): Promise<boolean>;
    notify(text: string, level: "info" | "warning" | "error"): void;
}

export async function runSetup(state: JigState, ui: SetupUi, requestedSection?: string): Promise<number> {
    const planState = setupStateFrom(state);
    if (requestedSection !== undefined) planState.requestedSection = requestedSection;
    const built = buildSetupPlan(planState);
    if ("problem" in built) {
        ui.notify(built.problem, "warning");
        return 1;
    }
    const plan = built.plan;
    if (plan.sections.length === 0) {
        ui.notify("Nothing needs you right now. jig doctor has the full check.", "info");
        return 0;
    }
    if (plan.intro.length > 0) ui.notify(plan.intro.join("\n"), "info");
    for (const login of plan.logins) {
        ui.notify(
            `${login.label}: run \`${login.command}\` in another terminal.${login.why === undefined ? "" : ` ${login.why}`}`,
            "info",
        );
    }
    const notes = plan.sections.flatMap((section) => section.notes);
    if (plan.sections.every((section) => section.fields.length === 0)) {
        ui.notify([...notes, "Nothing was written."].join("\n"), "info");
        return 0;
    }

    ui.notify("Jig setup asks only what is missing. It never asks for a password or a token.", "info");
    const draft = structuredClone(plan.raw);
    const changes: SetupChange[] = [];

    for (const section of plan.sections) {
        if (section.fields.length === 0) continue;
        const things = section.fields.length === 1 ? "1 thing" : `${section.fields.length} things`;
        const choice = await ui.select(`${section.label} needs ${things}`, [
            "Answer these",
            "Skip this section",
            "Cancel setup",
        ]);
        if (choice === undefined || choice === "Cancel setup") return cancel(ui);
        if (choice === "Skip this section") continue;
        for (const field of section.fields) {
            if ((await ask(state, plan, field, draft, changes, ui)) === "cancel") return cancel(ui);
        }
    }

    if (changes.length === 0) {
        ui.notify([...notes, "Nothing was written."].join("\n"), "info");
        return 0;
    }

    const summary = summaryLines(plan, changes);
    const confirmation = [...summary, "", "A backup is kept next to your settings file."].join("\n");
    ui.notify(summary.join("\n"), "info");
    const review = await ui.select("Review these changes", ["Save these changes", "Show the exact change", "Cancel"]);
    if (review === undefined || review === "Cancel") return cancel(ui);
    if (review === "Show the exact change") {
        ui.notify(["Only these fields change:", ...exactChangeLines(changes)].join("\n"), "info");
        const ok = await ui.confirm("Save these changes?", confirmation);
        if (!ok) return cancel(ui);
    } else {
        const ok = await ui.confirm("Save these changes?", confirmation);
        if (!ok) return cancel(ui);
    }

    try {
        const result = writeSetup(plan, changes, state.now());
        const count = result.changes === 1 ? "1 change" : `${result.changes} changes`;
        const where = shorten(result.file, homedir());
        const lines = [`Saved ${count} to ${where}${plan.link ? " (through your link)" : ""}.`];
        if (result.backup !== undefined) lines.push(`Backup: ${shorten(result.backup, homedir())}`);
        lines.push("Start Pi again, or run /reload in it, to apply.");
        ui.notify(lines.join("\n"), "info");
        return 0;
    } catch (error) {
        ui.notify(
            error instanceof SetupRefused
                ? error.message
                : `Your settings could not be saved. Nothing was written (${errorMessage(error)}).`,
            "error",
        );
        return 1;
    }
}

/** One question at a time; a rejection is a plain sentence, then the same question again. */
async function ask(
    state: JigState,
    plan: SetupPlan,
    field: SetupField,
    draft: Record<string, unknown>,
    changes: SetupChange[],
    ui: SetupUi,
): Promise<"ok" | "cancel"> {
    if (field.kind === "reference") return askReference(state, plan, field, draft, changes, ui);
    if (field.kind === "pick") {
        const choices = field.choices ?? [];
        const picked = await ui.select(`${field.label}: ${field.reason}`, [...choices]);
        if (picked === undefined || !choices.includes(picked)) return "cancel";
        const result = applyAnswer(plan, draft, field, picked);
        if ("change" in result) {
            changes.push(result.change);
            return "ok";
        }
        ui.notify(result.problem, "warning");
        return "ok";
    }
    for (;;) {
        ui.notify(`${field.label}: ${field.reason}`, "info");
        const text = await ui.input(field.question, field.placeholder);
        if (text === undefined) return "cancel";
        const result = applyAnswer(plan, draft, field, text);
        if ("change" in result) {
            changes.push(result.change);
            return "ok";
        }
        ui.notify(result.problem, "warning");
    }
}

/** A credential: where it is kept, then the parts, then a status that never shows a value. */
async function askReference(
    state: JigState,
    plan: SetupPlan,
    field: SetupField,
    draft: Record<string, unknown>,
    changes: SetupChange[],
    ui: SetupUi,
): Promise<"ok" | "cancel"> {
    const choice = field.reference;
    if (choice === undefined || choice.stores.length === 0) {
        ui.notify("No secret store is available for this. /jig doctor names the problem.", "warning");
        return "cancel";
    }
    if (choice.disabled.length > 0) {
        ui.notify(
            `You turned off ${choice.disabled.map(storeLabel).join(", ")}, so ${
                choice.disabled.length === 1 ? "it is" : "they are"
            } not offered.`,
            "info",
        );
    }

    for (;;) {
        const labels = choice.stores.map(
            (store) => `${storeChoiceLabel(store)}${choice.preferred === store ? " (company default)" : ""}`,
        );
        const picked = await ui.select(field.question, labels);
        if (picked === undefined || !labels.includes(picked)) return "cancel";
        const index = labels.indexOf(picked);
        const store = choice.stores[index];
        if (store === undefined) continue;

        if (store === "file") {
            const ok = await ui.confirm(
                "Use a file?",
                "A file is plain text on disk. A password store or 1Password is safer.",
            );
            if (!ok) continue;
        }

        // The company's suggestion, when it wrote one for this store: a reference shape, never a value.
        const shape = choice.suggested?.[store];
        if (shape !== undefined) {
            const use = await ui.select(`${storeLabel(store)}: use the company's suggestion?`, [
                `Use ${describeReference(shape)}`,
                "Build it another way",
            ]);
            if (use === undefined) return "cancel";
            if (use.startsWith("Use ")) {
                const settled = await settleReference(
                    state,
                    plan,
                    field,
                    draft,
                    changes,
                    ui,
                    store,
                    shape,
                    `read from ${describeReference(shape)} (the company's suggestion)`,
                );
                if (settled === "ok" || settled === "cancel") return settled;
            }
        }

        for (;;) {
            const parts = await askParts(store, choice.commands, ui);
            if (parts === undefined) return "cancel";
            const built = buildReference(store, parts, choice.commands);
            if ("problem" in built) {
                ui.notify(built.problem, "warning");
                continue;
            }
            const settled = await settleReference(
                state,
                plan,
                field,
                draft,
                changes,
                ui,
                store,
                built.reference,
                `read from ${built.note}`,
            );
            if (settled === "ok" || settled === "cancel") return settled;
        }
    }
}

/** Checks, probes and records one built reference: "ok", "cancel", or "retry" for another try at this store. */
async function settleReference(
    state: JigState,
    plan: SetupPlan,
    field: SetupField,
    draft: Record<string, unknown>,
    changes: SetupChange[],
    ui: SetupUi,
    store: SecretBackend,
    reference: string,
    note: string,
): Promise<"ok" | "cancel" | "retry"> {
    const choice = field.reference;
    const answer = applyAnswer(plan, draft, field, reference);
    if ("problem" in answer) {
        ui.notify(answer.problem, "warning");
        return "retry";
    }
    const change = answer.change;
    change.note = note;
    if (choice !== undefined && !choice.enabled.includes(store)) change.enableBackend = store;
    for (;;) {
        const probe = await probeSecret(reference, probeOptions(state));
        const status = statusText(store, probe);
        ui.notify(status.text, status.level);
        if (probe.status === "found" || probe.status === "unknown") {
            changes.push(change);
            return "ok";
        }
        if (probe.status === "invalid") {
            ui.notify("That place cannot be used. Choose another.", "warning");
            return "retry";
        }
        if (probe.fix !== undefined) ui.notify(probe.fix, "info");
        const next = await ui.select("Not found yet", ["Check again", "Continue without it", "Cancel setup"]);
        if (next === "Check again") continue;
        if (next === "Continue without it") {
            change.note = `${change.note} (not found yet)`;
            changes.push(change);
            return "ok";
        }
        return "cancel";
    }
}

/** The plain questions for one store. It never asks for a value, and never shows a reference. */
async function askParts(
    store: SecretBackend,
    commands: Readonly<Record<string, readonly string[]>>,
    ui: SetupUi,
): Promise<ReferenceParts | undefined> {
    const ask = async (title: string, placeholder?: string): Promise<string | undefined> => {
        const value = await ui.input(title, placeholder);
        return value === undefined ? undefined : value.trim();
    };
    if (store === "op") {
        const vault = await ask("Which 1Password vault?", "Work");
        if (vault === undefined) return undefined;
        const item = await ask("Which item in that vault?", "Jira");
        if (item === undefined) return undefined;
        const field = await ask("Which field of that item?", "token");
        if (field === undefined) return undefined;
        return { vault, item, field };
    }
    if (store === "keychain") {
        const service = await ask("Which macOS Keychain service?", "example-tool");
        if (service === undefined) return undefined;
        const account = await ask("Which Keychain account?", "jdoe");
        if (account === undefined) return undefined;
        return { service, account };
    }
    if (store === "pass") {
        const entry = await ask("Which entry in your password store?", "work/jira-token");
        return entry === undefined ? undefined : { entry };
    }
    if (store === "env") {
        const name = await ask("Which environment variable?", "JIRA_TOKEN");
        return name === undefined ? undefined : { name };
    }
    if (store === "file") {
        const file = await ask("Which file?", "~/.config/tool/token");
        return file === undefined ? undefined : { file };
    }
    const command = await ui.select("Which command owns that login?", Object.keys(commands));
    return command === undefined ? undefined : { command };
}

/** A found/missing/locked sentence in plain words. It never repeats the reference or a value. */
function statusText(store: SecretBackend, probe: SecretProbe): { text: string; level: "info" | "warning" } {
    const name = storeLabel(store);
    if (probe.status === "found") {
        const extra =
            probe.backend === "op"
                ? " The item is there; the field is not verified."
                : probe.backend === "file"
                  ? " The first line is not read until a tool needs it."
                  : "";
        return {
            text: `Found in ${name}.${extra}${probe.warning === undefined ? "" : ` ${probe.warning}.`}`,
            level: probe.warning === undefined ? "info" : "warning",
        };
    }
    if (probe.status === "missing")
        return { text: `Not in ${name} yet.${probe.fix === undefined ? "" : " Add it with:"}`, level: "warning" };
    if (probe.status === "locked")
        return { text: `Locked: ${probe.detail ?? `the store is locked`}.`, level: "warning" };
    if (probe.status === "invalid") return { text: "That place cannot be used.", level: "warning" };
    return { text: `Not checked: ${probe.detail ?? "Jig cannot check this store."}.`, level: "info" };
}

function probeOptions(state: JigState) {
    return {
        env: state.env,
        passStoreDir: state.secrets.passStoreDir(),
        agentDir: state.agentDir(),
        platform: process.platform,
        home: homedir(),
        run: runProgram,
        cwd: state.workingDir,
    };
}

function cancel(ui: SetupUi): number {
    ui.notify("Nothing was written.", "info");
    return 130;
}

/** The checked part of a running jig-core, with the company's defaults gathered for `layered()`. */
export function setupStateFrom(state: JigState): SetupState {
    const backends = effectiveBackends(state.personal.config.secrets, state.company);
    return {
        personal: state.personal,
        sectionChecks: state.sectionChecks,
        defaults: effectiveDefaults(state),
        replace: state.sectionReplace,
        oneOf: state.sectionOneOf,
        union: state.sectionUnion,
        configPath: state.configPath(),
        env: state.env,
        platform: process.platform,
        pathLookup: (program, env) => findOnPath(program, env, process.platform),
        enabledBackends: backends.on,
        disabledBackends: state.personal.config.secrets.disabledBackends,
        companyBackends: backends.byCompany,
        commands: { ...state.company.secretCommands, ...state.personal.config.secrets.commands },
        onboarding: activeOnboarding(state),
        onboardingMethods: state.onboardingMethods,
    };
}
