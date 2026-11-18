// One question at a time: a plain sentence about why, the answer, and a plain refusal that asks again. A credential is
// asked for as WHERE it is kept, never as a value; a sign-in method is one choice whose fields are then asked; an entry
// is one key and one value of a map; an object is one name and the answers of one form. Nothing here writes or says
// where a secret is.
import { detectedLine } from "./detect.ts";
import { applyAnswer, applyEntry, applyValue } from "./setup-answer.ts";
import { askObject } from "./setup-ask-object.ts";
import { beginSwitch, endSwitch } from "./setup-method-switch.ts";
import { askProposal } from "./setup-proposal.ts";
import { chooseReference, probeChosen } from "./setup-reference-ask.ts";
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
    if (field.kind === "object") return askObject(state, plan, field, draft, changes, ui);
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
    const mark = beginSwitch(plan, section.name, draft, changes);
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
    endSwitch(plan, section, method, mark, draft, changes, ui);
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
        const again = await ui.confirm("Add another entry?", "One more key and value, written the same way.");
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
    const outcome = await chooseReference(field, ui, async (chosen) => {
        const answer = applyAnswer(plan, draft, field, chosen.reference);
        if ("problem" in answer) {
            ui.notify(answer.problem, "warning");
            return "retry";
        }
        if (!("change" in answer)) return "cancel";
        const change = answer.change;
        change.note = chosen.note;
        if (choice !== undefined && !choice.enabled.includes(chosen.store)) change.enableBackends = [chosen.store];
        const probe = await probeChosen(state, ui, chosen.store, chosen.reference);
        if (probe === "retry") return "retry";
        if (probe === "cancel") return "cancel";
        if (probe === "not-found") change.note = `${change.note} (not found yet)`;
        changes.push(change);
        return "ok";
    });
    return outcome === "cancel" ? "cancel" : "ok";
}
