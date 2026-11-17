// One named object of a map: its name, then one form's questions, then another if the person wants one. The answers are
// kept here and written as one change only when the last one is accepted, so a name is never half set up. A credential
// inside the object goes through the same "where is it kept" flow as any other, and still waits for the object.
import type { SetupChange, SetupField, SetupObjectField, SetupObjectForm, SetupPlan } from "./setup-plan.ts";
import type { SetupUi } from "./setup.ts";
import type { JigState } from "./state.ts";
import type { SecretBackend } from "./config.ts";
import { applyObject, keyProblem, listValues } from "./setup-answer.ts";
import { chooseReference, probeChosen } from "./setup-reference-ask.ts";
import { layered } from "./section-defaults.ts";
import { getPath, isObject } from "./setup-values.ts";

/** The names in the map this item adds to, from the person's answers over the company's defaults. */
function objectNames(plan: SetupPlan, field: SetupField, draft: Record<string, unknown>): string[] {
    const value = getPath(mergedSection(plan, field.section, draft), field.path);
    return isObject(value) ? Object.keys(value) : [];
}

function mergedSection(plan: SetupPlan, section: string, draft: Record<string, unknown>): unknown {
    const rawSection = isObject(draft[section]) ? (draft[section] as Record<string, unknown>) : {};
    return layered(
        plan.defaults.get(section),
        rawSection,
        plan.replace.get(section) ?? [],
        plan.oneOf.get(section) ?? [],
        plan.union.get(section) ?? [],
    );
}

/** The forms that apply now: those whose `when` matches, otherwise the ones with no `when`, which are the fallback. */
function applicableForms(
    forms: readonly SetupObjectForm[],
    plan: SetupPlan,
    section: string,
    draft: Record<string, unknown>,
): SetupObjectForm[] {
    const merged = mergedSection(plan, section, draft);
    const matched = forms.filter((form) => {
        if (form.when === undefined) return false;
        const value = getPath(merged, form.when.path);
        return value !== undefined && String(value) === form.when.equals;
    });
    return matched.length > 0 ? matched : forms.filter((form) => form.when === undefined);
}

/** A plain label for one form's line in the kind question. */
function formLabel(form: SetupObjectForm): string {
    const label = form.label ?? "This kind";
    return form.who === undefined ? label : `${label} — ${form.who}`;
}

/** A label in the middle of a sentence, such as "mongo connection" in "Which kind of mongo connection?". */
function midSentence(label: string): string {
    return /^[A-Z][a-z]/.test(label) ? `${label[0]?.toLowerCase() ?? ""}${label.slice(1)}` : label;
}

/** What asking one object came to: it was written, its name or its kind must be asked again, or the person cancelled. */
type AddOutcome = "added" | "retry" | "cancel" | "nothing";

/** One named object, from its name to the change that writes it; `repeat` asks for another. */
export async function askObject(
    state: JigState,
    plan: SetupPlan,
    field: SetupField,
    draft: Record<string, unknown>,
    changes: SetupChange[],
    ui: SetupUi,
): Promise<"ok" | "cancel"> {
    const spec = field.object;
    if (spec === undefined) return "cancel";
    let names = objectNames(plan, field, draft);
    if (names.length > 0) ui.notify(`Already set up: ${names.join(", ")}.`, "info");
    ui.notify(`${field.label}: ${field.reason}`, "info");
    for (;;) {
        const name = await askName(ui, field, names);
        if (name === "cancel") return "cancel";
        if (name === "stop") return "ok";
        const outcome = await addObject(state, plan, field, draft, changes, ui, name);
        if (outcome === "cancel") return "cancel";
        if (outcome === "nothing") return "ok";
        if (outcome === "retry") continue;
        if (spec.repeat !== true) return "ok";
        names = objectNames(plan, field, draft);
        const again = await ui.confirm(`Add another ${field.label}?`, "One more name and its own answers.");
        if (!again) return "ok";
    }
}

/** One object: choose the form that applies, ask its fields and write the answer as one change. */
async function addObject(
    state: JigState,
    plan: SetupPlan,
    field: SetupField,
    draft: Record<string, unknown>,
    changes: SetupChange[],
    ui: SetupUi,
    name: string,
): Promise<AddOutcome> {
    const spec = field.object;
    if (spec === undefined) return "cancel";
    for (;;) {
        const forms = applicableForms(spec.forms, plan, field.section, draft);
        if (forms.length === 0) {
            ui.notify(
                `The settings already decide this, so there is nothing to ask for ${midSentence(field.label)}.`,
                "info",
            );
            return "nothing";
        }
        const form = forms.length === 1 ? forms[0] : await pickForm(ui, field, forms);
        if (form === undefined) return "cancel";
        const answer = await fillForm(state, plan, field, draft, ui, form, name);
        if (answer === "cancel") return "cancel";
        if (answer === "retry") return "retry";
        if (answer === "form") continue;
        changes.push(answer.change);
        return "added";
    }
}

/** The name of the new object: one line, a safe key, and one that is not already there. A map already set up can be left
 *  as it is, because this question only ever adds one more. */
async function askName(ui: SetupUi, field: SetupField, names: readonly string[]): Promise<string | "stop" | "cancel"> {
    const spec = field.object;
    if (spec === undefined) return "cancel";
    for (;;) {
        const text = await ui.input(spec.keyLabel, spec.keyPlaceholder);
        if (text === undefined) return "cancel";
        const name = text.trim();
        if (name === "") {
            if (names.length > 0) {
                ui.notify(`${field.label} left as it is.`, "info");
                return "stop";
            }
            ui.notify(`Please enter a value for ${spec.keyLabel}`, "warning");
            continue;
        }
        const problem = keyProblem(name, spec.keyLabel);
        if (problem !== undefined) {
            ui.notify(problem, "warning");
            continue;
        }
        if (names.includes(name)) {
            ui.notify(`${name} is already set up here; use another name, or edit it in your settings file.`, "warning");
            continue;
        }
        return name;
    }
}

/** Which of several forms one object takes. One form is asked without a question. */
async function pickForm(
    ui: SetupUi,
    field: SetupField,
    forms: readonly SetupObjectForm[],
): Promise<SetupObjectForm | undefined> {
    const labels = forms.map(formLabel);
    const picked = await ui.select(`Which kind of ${midSentence(field.label)}?`, labels);
    if (picked === undefined) return undefined;
    const index = labels.indexOf(picked);
    return index < 0 ? undefined : forms[index];
}

/** One form's questions and the write: a refusal asks the field it names again, or the name, or the kind. */
async function fillForm(
    state: JigState,
    plan: SetupPlan,
    field: SetupField,
    draft: Record<string, unknown>,
    ui: SetupUi,
    form: SetupObjectForm,
    name: string,
): Promise<{ change: SetupChange } | "cancel" | "retry" | "form"> {
    const values = new Map<string, unknown>();
    // Each credential's store, by its field: a retry that picks another store keeps only the one it settles on.
    const enable = new Map<string, SecretBackend>();
    let asking = 0;
    let again = -1;
    for (;;) {
        if (again >= 0) {
            // Only the field the refusal names is asked again: the others' answers are kept.
            const index = again;
            again = -1;
            if ((await askObjectField(state, ui, field, form, index, values, enable)) === "cancel") return "cancel";
        } else {
            while (asking < form.fields.length) {
                if ((await askObjectField(state, ui, field, form, asking, values, enable)) === "cancel")
                    return "cancel";
                asking++;
            }
        }
        const result = applyObject(plan, draft, field, name, Object.fromEntries(values));
        if ("change" in result) {
            if (enable.size > 0) result.change.enableBackends = [...new Set(enable.values())];
            return { change: result.change };
        }
        // The name or the map itself was refused: ask the name again.
        if (result.at === undefined) {
            ui.notify(result.problem, "warning");
            return "retry";
        }
        const at = form.fields.findIndex(
            (sub) =>
                sub.path === result.at ||
                sub.path.startsWith(`${result.at}.`) ||
                result.at?.startsWith(`${sub.path}.`) === true,
        );
        // A path this form does not ask belongs to another kind of object: ask which kind again.
        if (at < 0) {
            ui.notify(result.problem, "warning");
            return "form";
        }
        const label = (form.fields[at]?.label ?? result.at).replace(/[?.]$/, "");
        ui.notify(`${label}: ${result.problem}`, "warning");
        again = at;
    }
}

/** One question of a form: its answer is kept for the object and written with the rest. */
async function askObjectField(
    state: JigState,
    ui: SetupUi,
    field: SetupField,
    form: SetupObjectForm,
    index: number,
    values: Map<string, unknown>,
    enable: Map<string, SecretBackend>,
): Promise<"ok" | "cancel"> {
    const sub = form.fields[index];
    if (sub === undefined) return "ok";
    if (sub.kind === "text") return askObjectText(ui, sub, values);
    if (sub.kind === "pick") {
        const choices = sub.choices ?? [];
        const picked = await ui.select(`${sub.label}: ${sub.reason}`, [...choices]);
        if (picked === undefined || !choices.includes(picked)) return "cancel";
        values.set(sub.path, picked);
        return "ok";
    }
    // A credential inside the object: where it is kept, never a value. It is checked now and written with the object.
    const credential: SetupField = {
        section: field.section,
        path: `${field.path}.${sub.path}`,
        label: sub.label,
        question: sub.question,
        kind: "reference",
        reason: sub.reason,
        ...(sub.reference === undefined ? {} : { reference: sub.reference }),
    };
    const outcome = await chooseReference(credential, ui, async (chosen) => {
        const probe = await probeChosen(state, ui, chosen.store, chosen.reference);
        if (probe === "retry") return "retry";
        if (probe === "cancel") return "cancel";
        values.set(sub.path, chosen.reference);
        if (sub.reference !== undefined && !sub.reference.enabled.includes(chosen.store))
            enable.set(sub.path, chosen.store);
        return "ok";
    });
    return outcome === "cancel" ? "cancel" : "ok";
}

/** One text answer of a form, asked again when it is empty and required; a list becomes a list of entries. */
async function askObjectText(
    ui: SetupUi,
    sub: Pick<SetupObjectField, "path" | "label" | "question" | "reason" | "placeholder" | "optional" | "list">,
    values: Map<string, unknown>,
): Promise<"ok" | "cancel"> {
    for (;;) {
        ui.notify(sub.reason, "info");
        const text = await ui.input(sub.question, sub.optional === true ? undefined : sub.placeholder);
        if (text === undefined) return "cancel";
        const answer = text.trim();
        if (answer === "") {
            if (sub.optional === true) {
                ui.notify(`${sub.label} left unset (optional).`, "info");
                values.delete(sub.path);
                return "ok";
            }
            ui.notify(`Please enter a value for ${sub.label}.`, "warning");
            continue;
        }
        values.set(sub.path, sub.list === true ? listValues(answer) : answer);
        return "ok";
    }
}
