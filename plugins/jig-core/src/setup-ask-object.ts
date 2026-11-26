// One named object of a map: its name, then one form's questions, then another if the person wants one. The answers are
// kept here and written as one change only when the last one is accepted, so a name is never half set up. A credential
// inside the object goes through the same "where is it kept" flow as any other, and still waits for the object.
import type { SetupChange, SetupField, SetupObjectField, SetupObjectForm, SetupPlan } from "./setup-plan.ts";
import type { SetupUi } from "./setup.ts";
import type { JigState } from "./engine-state.ts";
import type { SecretBackend } from "./config.ts";
import { applyObject, listValues, objectNameProblem } from "./setup-answer.ts";
import { chooseReference, probeChosen } from "./setup-reference-ask.ts";
import { checkRelay } from "./setup-relay-check.ts";
import { TRANSPORTS_SECTION } from "./transports-section.ts";
import { layered } from "./section-defaults.ts";
import { emptyAnswer, exampleQuestion, skipQuestion } from "./setup-fields.ts";
import { getPath, isObject } from "./setup-values.ts";

/** The names in the map this item adds to, from the person's answers over the company's defaults. The transports a
 *  company plugin registered in code are there too: the name of one is not free. */
export function objectNames(plan: SetupPlan, field: SetupField, draft: Record<string, unknown>): string[] {
    const value = getPath(mergedSection(plan, field.section, draft), field.path);
    const names = isObject(value) ? Object.keys(value) : [];
    return field.section === TRANSPORTS_SECTION ? [...new Set([...names, ...plan.pluginTransports])] : names;
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

/** A plain label in the middle of a sentence, such as "mongo connection" in "Which kind of mongo connection?". */
export function midSentence(label: string): string {
    return /^[A-Z][a-z]/.test(label) ? `${label[0]?.toLowerCase() ?? ""}${label.slice(1)}` : label;
}

/** Why there is nothing to ask: the settings already fix the only shape this object may take. */
function nothingToAsk(ui: SetupUi, field: SetupField): void {
    ui.notify(`The settings already decide this, so there is nothing to ask for ${midSentence(field.label)}.`, "info");
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
    // Nothing to ask when the settings already decide the only shape this object may take: say so before the name.
    if (applicableForms(spec.forms, plan, field.section, draft).length === 0) {
        nothingToAsk(ui, field);
        return "ok";
    }
    for (;;) {
        const name = await askName(plan, ui, field, names);
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
            nothingToAsk(ui, field);
            return "nothing";
        }
        const form = forms.length === 1 ? forms[0] : await pickForm(ui, field, forms);
        if (form === undefined) return "cancel";
        const answer = await fillForm(state, plan, field, draft, ui, form, name);
        if (answer === "cancel") return "cancel";
        if (answer === "retry") return "retry";
        if (answer === "form") continue;
        // A session relay is asked once whether it is running; its token is never sent or read here.
        if (field.section === TRANSPORTS_SECTION) {
            const url = (answer.change.value as { url?: unknown }).url;
            const looked = typeof url === "string" ? await checkRelay(state, ui, url) : "ok";
            if (looked === "cancel") return "cancel";
            if (looked === "refused") return "retry";
        }
        changes.push(answer.change);
        return "added";
    }
}

/** The name of the new object: one line, a safe key, and one that is not already there. A map already set up can be left
 *  as it is, because this question only ever adds one more. */
async function askName(
    plan: SetupPlan,
    ui: SetupUi,
    field: SetupField,
    names: readonly string[],
): Promise<string | "stop" | "cancel"> {
    const spec = field.object;
    if (spec === undefined) return "cancel";
    for (;;) {
        // An empty name adds nothing, and that is allowed when the object is optional or the map already has one: the
        // question says Enter skips. Otherwise a name is needed, and the question gives its example.
        const text =
            field.optional === true || names.length > 0
                ? await ui.input(skipQuestion(spec.keyLabel, spec.keyPlaceholder))
                : await ui.input(exampleQuestion(spec.keyLabel, spec.keyPlaceholder));
        if (text === undefined) return "cancel";
        const name = text.trim();
        if (name === "") {
            if (names.length > 0 || field.optional === true) {
                ui.notify(`${field.label} left ${names.length > 0 ? "as it is" : "unset (optional)"}.`, "info");
                return "stop";
            }
            ui.notify(`Please enter a name for the ${midSentence(field.label)}.`, "warning");
            continue;
        }
        const problem = objectNameProblem(plan, field, name);
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

/** Whether a validator's message names one field of a form, as a whole dotted path: "needs a uri with one host" names
 *  `uri`, and "via.ssh.host is required" names `via.ssh.host` and not `host`. */
function namesField(text: string, path: string): boolean {
    const escaped = path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`(?:^|[^A-Za-z0-9_.-])${escaped}(?![A-Za-z0-9_.-])`).test(text);
}

/**
 * The field a refusal asks again, or -1 for the whole form. A path that is a field's own is that field, and a path below
 * one belongs to it. A path above the fields is an object the form builds: the field the message itself names is asked
 * (a `via.ssh` refusal is really about the uri), and when the message names none, the whole form is asked, so a field
 * that could not change the refusal is never asked for ever.
 */
export function fieldForRefusal(form: SetupObjectForm, at: string, problem: string): number {
    const fields = form.fields;
    const exact = fields.findIndex((sub) => sub.path === at);
    if (exact >= 0) return exact;
    let owner = -1;
    for (const [index, sub] of fields.entries()) {
        if (!at.startsWith(`${sub.path}.`)) continue;
        if (owner < 0 || sub.path.length > (fields[owner]?.path.length ?? 0)) owner = index;
    }
    if (owner >= 0) return owner;
    const named = fields.flatMap((sub, index) => (namesField(problem, sub.path) ? [index] : []));
    return named.length === 1 ? (named[0] ?? -1) : -1;
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
    // The credentials whose place is not there yet: the summary says so once, as a standalone credential's does.
    const missing = new Set<string>();
    let asking = 0;
    let again = -1;
    for (;;) {
        if (again >= 0) {
            // Only the field the refusal names is asked again: the others' answers are kept.
            const index = again;
            again = -1;
            if ((await askObjectField(state, ui, field, form, index, values, enable, missing)) === "cancel")
                return "cancel";
        } else {
            while (asking < form.fields.length) {
                if ((await askObjectField(state, ui, field, form, asking, values, enable, missing)) === "cancel")
                    return "cancel";
                asking++;
            }
        }
        const result = applyObject(plan, draft, field, name, { ...form.fixed, ...Object.fromEntries(values) });
        if ("change" in result) {
            if (enable.size > 0) result.change.enableBackends = [...new Set(enable.values())];
            if (missing.size > 0) result.change.note = `${result.change.note ?? ""} (not found yet)`;
            return { change: result.change };
        }
        // The name or the map itself was refused: ask the name again.
        if (result.at === undefined) {
            ui.notify(result.problem, "warning");
            return "retry";
        }
        const at = fieldForRefusal(form, result.at, result.problem);
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
    missing: Set<string>,
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
        if (probe === "not-found") missing.add(sub.path);
        else missing.delete(sub.path);
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
        const text = await ui.input(
            sub.optional === true ? sub.question : exampleQuestion(sub.question, sub.placeholder),
        );
        if (text === undefined) return "cancel";
        const answer = text.trim();
        if (answer === "") {
            if (sub.optional === true) {
                ui.notify(`${sub.label} left unset (optional).`, "info");
                values.delete(sub.path);
                return "ok";
            }
            ui.notify(emptyAnswer(sub.label), "warning");
            continue;
        }
        values.set(sub.path, sub.list === true ? listValues(answer) : answer);
        return "ok";
    }
}
