// One question at a time: a plain sentence about why, the answer, and a plain refusal that asks again. A credential is
// asked for as WHERE it is kept, never as a value; a sign-in method is one choice whose fields are then asked; an entry
// is one key and one value of a map. Nothing here writes or says where a secret is.
import { run as runProgram } from "./exec.ts";
import { homedir } from "node:os";
import type { SecretBackend } from "./config.ts";
import { probeSecret } from "./secret-status.ts";
import type { SecretProbe } from "./secret-status.ts";
import { detectedLine } from "./detect.ts";
import { applyAnswer, applyEntry, applyValue } from "./setup-answer.ts";
import { askProposal } from "./setup-proposal.ts";
import { buildReference, describeReference, storeChoiceLabel, storeLabel } from "./setup-reference.ts";
import type { ReferenceParts } from "./setup-reference.ts";
import type { SetupChange, SetupField, SetupMethod, SetupPlan, SetupSection } from "./setup-plan.ts";
import type { SetupUi } from "./setup.ts";
import type { JigState } from "./state.ts";
import { getPath } from "./setup-values.ts";

/** The line for one sign-in method: its plain label, whose it is, and whether it is the one in use. */
export function methodLabel(method: SetupMethod): string {
    const who = method.who === undefined ? "" : ` — ${method.who}`;
    const mark = method.current === true ? " (current)" : method.companyDefault === true ? " (company default)" : "";
    return `${method.label}${who}${mark}`;
}

/** One question at a time; a rejection is a plain sentence, then the same question again. */
export async function ask(
    state: JigState,
    plan: SetupPlan,
    field: SetupField,
    draft: Record<string, unknown>,
    changes: SetupChange[],
    ui: SetupUi,
    found: (field: SetupField) => string | undefined,
): Promise<"ok" | "cancel"> {
    if (field.kind === "proposal") return askProposal(plan, field, draft, changes, ui);
    if (field.kind === "reference") return askReference(state, plan, field, draft, changes, ui);
    if (field.kind === "entry") return askEntry(plan, field, draft, changes, ui, found);
    const detected = found(field);
    const hint = detected ?? field.placeholder ?? (field.current === undefined ? undefined : `Now: ${field.current}`);
    // An optional question already ends in its own parenthetical, so it gets no second one for the example: the
    // question carries the example, and Enter either keeps the value or says it is left unset.
    const typed = field.optional === true ? undefined : hint;
    if (field.kind === "pick") {
        const choices = field.choices ?? [];
        if (detected !== undefined) ui.notify(detectedLine(detected), "info");
        const ordered: string[] =
            detected === undefined ? [...choices] : [detected, ...choices.filter((choice) => choice !== detected)];
        const picked = await ui.select(`${field.label}: ${field.reason}`, ordered);
        if (picked === undefined || !choices.includes(picked)) return "cancel";
        const result = applyAnswer(plan, draft, field, picked);
        if ("change" in result) {
            changes.push(result.change);
            return "ok";
        }
        if ("kept" in result) {
            ui.notify(`${field.label} kept.`, "info");
            return "ok";
        }
        ui.notify(result.problem, "warning");
        return "ok";
    }
    for (;;) {
        // The prompt already carries the label; the line above it only says why.
        ui.notify(field.reason, "info");
        if (detected !== undefined) ui.notify(detectedLine(detected), "info");
        const text = await ui.input(field.question, typed);
        if (text === undefined) return "cancel";
        const answer = text.trim() === "" && detected !== undefined ? detected : text;
        // An optional field: an empty answer leaves it unset, and nothing is written for it.
        if (field.optional === true && answer.trim() === "" && field.current === undefined) {
            ui.notify(`${field.label} left unset (optional).`, "info");
            return "ok";
        }
        const result = applyAnswer(plan, draft, field, answer);
        if ("change" in result) {
            changes.push(result.change);
            return "ok";
        }
        if ("kept" in result) {
            ui.notify(`${field.label} kept.`, "info");
            return "ok";
        }
        ui.notify(result.problem, "warning");
    }
}

/** The sign-in question of one section, then that method's fields; a fixed value is shown and written, never asked. */
export async function askMethods(
    state: JigState,
    plan: SetupPlan,
    section: SetupSection,
    draft: Record<string, unknown>,
    changes: SetupChange[],
    ui: SetupUi,
    found: (field: SetupField) => string | undefined,
): Promise<"ok" | "cancel"> {
    const methods = section.methods ?? [];
    if (!section.askMethod || methods.length === 0) return "ok";
    const ordered = [...methods].sort(
        (left, right) =>
            Number(right.current === true) - Number(left.current === true) ||
            Number(right.default) - Number(left.default),
    );
    const labels = ordered.map(methodLabel);
    const picked = await ui.select(`How do you sign in to ${section.label}?`, labels);
    if (picked === undefined) return "cancel";
    const method = ordered[labels.indexOf(picked)];
    if (method === undefined) return "cancel";
    for (const field of method.fields) {
        if (field.fixed !== undefined) {
            const at = getPath(draft[field.section], field.path);
            if (at === field.fixed) continue;
            const result = applyValue(plan, draft, field, field.fixed);
            if ("change" in result) changes.push(result.change);
            else if ("problem" in result) ui.notify(result.problem, "warning");
            else ui.notify(`${field.label}: ${field.fixed} (the company's choice).`, "info");
            continue;
        }
        if ((await ask(state, plan, field, draft, changes, ui, found)) === "cancel") return "cancel";
    }
    return "ok";
}

/** One entry of a map: the key, the value, and the section's own check on the pair. */
async function askEntry(
    plan: SetupPlan,
    field: SetupField,
    draft: Record<string, unknown>,
    changes: SetupChange[],
    ui: SetupUi,
    found: (field: SetupField) => string | undefined,
): Promise<"ok" | "cancel"> {
    const entry = field.entry;
    if (entry === undefined) return "cancel";
    for (;;) {
        ui.notify(`${field.label}: ${field.reason}`, "info");
        const key = await ui.input(entry.keyLabel, entry.keyPlaceholder);
        if (key === undefined) return "cancel";
        if (key.trim() === "" && field.optional === true) {
            ui.notify(`${field.label} left unset (optional).`, "info");
            return "ok";
        }
        if (key.trim() === "") {
            ui.notify(`Please enter a value for ${entry.keyLabel}.`, "warning");
            continue;
        }
        const detected = found(field);
        if (detected !== undefined) ui.notify(detectedLine(detected), "info");
        const value = await ui.input(entry.valueLabel, detected ?? entry.valuePlaceholder);
        if (value === undefined) return "cancel";
        const answer = value.trim() === "" && detected !== undefined ? detected : value;
        if (answer.trim() === "") {
            ui.notify(`Please enter a value for ${entry.valueLabel}.`, "warning");
            continue;
        }
        const result = applyEntry(plan, draft, field, key, answer);
        if ("problem" in result) {
            ui.notify(result.problem, "warning");
            continue;
        }
        if ("change" in result) changes.push(result.change);
        if (entry.repeat !== true) return "ok";
        const again = await ui.confirm("Add another entry?", `Another key and value in ${field.label}.`);
        if (!again) return "ok";
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
        const keep = field.keep === true && typeof field.current === "string" && field.current !== "";
        const labels = [
            ...(keep ? ["Keep the current place"] : []),
            ...choice.stores.map(
                (store) =>
                    `${storeChoiceLabel(store)}${choice.preferred === store ? " (company default)" : ""}${
                        choice.current === store ? " (current)" : ""
                    }`,
            ),
        ];
        const picked = await ui.select(field.question, labels);
        if (picked === undefined || !labels.includes(picked)) return "cancel";
        if (picked === "Keep the current place") {
            ui.notify(`${field.label} kept.`, "info");
            return "ok";
        }
        const store = choice.stores[labels.indexOf(picked) - (keep ? 1 : 0)];
        if (store === undefined) continue;

        if (store === "file") {
            const ok = await ui.confirm(
                "Use a file?",
                "A file is plain text on disk. A password store or 1Password is safer.",
            );
            if (!ok) continue;
        }

        // What the company says to do to add it, shown before the parts are asked, never run.
        const hint = choice.addHints?.[store];
        if (hint !== undefined) ui.notify(`Add it with: ${hint}`, "info");

        // The company's suggestion, when it wrote one for this store: a reference shape, never a value.
        const shape = choice.suggested?.[store];
        if (shape !== undefined) {
            const use = await ui.select(`Use the suggested place in ${storeLabel(store)}?`, [
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
                    `read from ${describeReference(shape)} (the suggested place)`,
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
    if (!("change" in answer)) return "cancel";
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
