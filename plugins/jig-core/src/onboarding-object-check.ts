// The `object` item of an onboarding list: one named object in a map, asked as a name and one form's questions. Checked
// once, when the list is registered, so setup can ask it and never writes a path it cannot follow. onboarding.ts checks
// the items; this file checks the forms and the fields inside a new object.
import type { OnboardingObjectField, OnboardingObjectForm, OnboardingStore } from "./contract-onboarding.ts";
import { LABEL_MAX, ONBOARDING_STORES, WHY_MAX, oneLine, optionalLine } from "./onboarding-common.ts";
import { safePath } from "./setup-values.ts";
import { unknownField } from "./kit/fields.ts";

/** The most forms one object may take, and the most questions one form may ask. */
const MAX_FORMS = 8;
const MAX_FIELDS = 20;

/** The fields each kind of object field may carry: the kinds a sign-in method's field has, without `*` or a fixed value. */
const FIELDS: Readonly<Record<OnboardingObjectField["kind"], readonly string[]>> = {
    text: ["kind", "path", "label", "why", "placeholder", "optional", "list"],
    pick: ["kind", "path", "label", "why", "choices"],
    reference: ["kind", "path", "label", "why", "stores", "suggested", "addHints", "fileExpected"],
};

function isObject(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** A path inside the section a form asks about: `backend.type` for a `when`, never a prototype key. */
function checkWhen(raw: unknown, at: string, errors: string[]): void {
    if (raw === undefined) return;
    if (!isObject(raw)) {
        errors.push(`${at}: must be an object with path and equals`);
        return;
    }
    for (const key of Object.keys(raw)) {
        if (key !== "path" && key !== "equals") errors.push(unknownField(at, key, ["path", "equals"]));
    }
    if (typeof raw.path !== "string" || !safePath(raw.path)) {
        errors.push(`${at}.path: a dotted path inside the section, such as backend.type`);
    }
    if (!oneLine(raw.equals, LABEL_MAX)) errors.push(`${at}.equals: one line, the value this form is for`);
}

/** The words every field of an object has: a path inside the object, a label and a one-line why. */
function checkFieldBasics(field: Record<string, unknown>, at: string, errors: string[]): void {
    if (typeof field.path !== "string" || !safePath(field.path)) {
        errors.push(`${at}.path: a dotted path inside the new object, such as uri or via.ssh.host`);
    }
    if (!oneLine(field.label, LABEL_MAX)) errors.push(`${at}.label: needed, one line`);
    optionalLine(field.why, `${at}.why`, WHY_MAX, errors);
}

/** The fields of a text question: an example, whether it may be left unset, and whether it is a list. */
function checkText(field: Record<string, unknown>, at: string, errors: string[]): void {
    optionalLine(field.placeholder, `${at}.placeholder`, LABEL_MAX, errors);
    for (const name of ["optional", "list"] as const) {
        if (field[name] !== undefined && typeof field[name] !== "boolean") errors.push(`${at}.${name}: true or false`);
    }
}

/** The choices of a pick: plain lines, one to a hundred. */
function checkPick(field: Record<string, unknown>, at: string, errors: string[]): void {
    if (!Array.isArray(field.choices) || field.choices.length === 0 || field.choices.length > 100) {
        errors.push(`${at}.choices: a list of one to 100 choices`);
        return;
    }
    for (const [index, choice] of field.choices.entries()) {
        if (!oneLine(choice, LABEL_MAX)) errors.push(`${at}.choices[${index}]: one line`);
    }
}

/** The stores a credential may be kept in, and the company's hints per store. */
function checkReference(field: Record<string, unknown>, at: string, errors: string[]): void {
    if (field.stores !== undefined) {
        if (!Array.isArray(field.stores) || field.stores.length === 0) {
            errors.push(`${at}.stores: a list of the stores to offer`);
        } else {
            for (const store of field.stores) {
                if (!ONBOARDING_STORES.includes(store as OnboardingStore))
                    errors.push(`${at}.stores: ${JSON.stringify(store)} is not a store Jig knows`);
            }
        }
    }
    if (field.fileExpected !== undefined && typeof field.fileExpected !== "boolean")
        errors.push(`${at}.fileExpected: true or false`);
    for (const name of ["suggested", "addHints"] as const) {
        const value = field[name];
        if (value === undefined) continue;
        if (!isObject(value)) {
            errors.push(`${at}.${name}: must be an object keyed by store`);
            continue;
        }
        for (const store of Object.keys(value)) {
            if (!ONBOARDING_STORES.includes(store as OnboardingStore))
                errors.push(`${at}.${name}: ${JSON.stringify(store)} is not a store Jig knows`);
        }
    }
}

/** One question of a form, or undefined when it is not one setup can ask. */
function checkField(raw: unknown, at: string, errors: string[]): OnboardingObjectField | undefined {
    if (!isObject(raw)) {
        errors.push(`${at}: must be an object with kind, path and label`);
        return undefined;
    }
    const kind = raw.kind;
    if (kind !== "text" && kind !== "pick" && kind !== "reference") {
        errors.push(`${at}.kind: must be text, pick or reference`);
        return undefined;
    }
    for (const key of Object.keys(raw)) {
        if (!FIELDS[kind].includes(key)) errors.push(unknownField(at, key, FIELDS[kind]));
    }
    checkFieldBasics(raw, at, errors);
    if (kind === "text") checkText(raw, at, errors);
    else if (kind === "pick") checkPick(raw, at, errors);
    else checkReference(raw, at, errors);
    return raw as unknown as OnboardingObjectField;
}

/** The questions of one form: at least one, and no two writing the same path. */
function checkFields(raw: unknown, at: string, errors: string[]): void {
    if (!Array.isArray(raw) || raw.length === 0 || raw.length > MAX_FIELDS) {
        errors.push(`${at}: a list of one to ${MAX_FIELDS} questions`);
        return;
    }
    const paths = new Set<string>();
    for (const [index, value] of raw.entries()) {
        const field = checkField(value, `${at}[${index}]`, errors);
        if (field === undefined) continue;
        if (paths.has(field.path)) errors.push(`${at}[${index}].path: ${JSON.stringify(field.path)} is asked twice`);
        paths.add(field.path);
    }
}

/** Whether one dotted path is the other or lies inside it: writing one would replace or lose the other. */
function overlaps(left: string, right: string): boolean {
    return left === right || left.startsWith(`${right}.`) || right.startsWith(`${left}.`);
}

/** The values a form writes without asking: plain scalars by path inside the object, none of them also a question, and
 *  none inside or above a question's path or another fixed value (the answer or the other value would replace it). */
function checkFixed(raw: unknown, fields: unknown, at: string, errors: string[]): void {
    if (raw === undefined) return;
    if (!isObject(raw)) {
        errors.push(`${at}: must be an object of paths and plain values`);
        return;
    }
    const asked = Array.isArray(fields) ? fields.map((field) => (isObject(field) ? String(field.path) : "")) : [];
    const fixed = Object.keys(raw);
    for (const [path, value] of Object.entries(raw)) {
        if (!safePath(path)) errors.push(`${at}.${path}: a dotted path inside the new object, such as kind`);
        else if (asked.includes(path)) errors.push(`${at}.${path}: is also asked, so it cannot be fixed`);
        else {
            const question = asked.find((one) => one !== "" && overlaps(path, one));
            const inside = fixed.find((one) => one !== path && path.startsWith(`${one}.`));
            if (question !== undefined)
                errors.push(`${at}.${path}: overlaps the question ${JSON.stringify(question)}, so it cannot be fixed`);
            else if (inside !== undefined)
                errors.push(
                    `${at}.${path}: overlaps the fixed value ${JSON.stringify(inside)}; one would replace the other`,
                );
        }
        if (typeof value === "string" ? !oneLine(value, LABEL_MAX) : !["number", "boolean"].includes(typeof value))
            errors.push(`${at}.${path}: one line of text, a number or true/false`);
    }
}

/** One form of an object: its label, its optional line, its `when` and its questions. */
function checkForm(raw: unknown, at: string, many: boolean, errors: string[]): void {
    if (!isObject(raw)) {
        errors.push(`${at}: must be an object with fields`);
        return;
    }
    const form = raw as Record<string, unknown>;
    for (const key of Object.keys(form)) {
        if (!["label", "who", "when", "fixed", "fields"].includes(key))
            errors.push(unknownField(at, key, ["label", "who", "when", "fixed", "fields"]));
    }
    // A single form never asks which kind it is, so only a choice among several needs a label.
    if (many) {
        if (!oneLine(form.label, LABEL_MAX))
            errors.push(`${at}.label: one line, needed when an object may take more than one form`);
    } else optionalLine(form.label, `${at}.label`, LABEL_MAX, errors);
    optionalLine(form.who, `${at}.who`, LABEL_MAX, errors);
    checkWhen(form.when, `${at}.when`, errors);
    checkFixed(form.fixed, form.fields, `${at}.fixed`, errors);
    checkFields(form.fields, `${at}.fields`, errors);
}

/** The forms of one `object` item, or undefined when they are not a list setup can offer. */
export function checkObjectForms(
    raw: unknown,
    at: string,
    errors: string[],
): readonly OnboardingObjectForm[] | undefined {
    if (!Array.isArray(raw) || raw.length === 0 || raw.length > MAX_FORMS) {
        errors.push(`${at}: a list of one to ${MAX_FORMS} forms`);
        return undefined;
    }
    const many = raw.length > 1;
    for (const [index, value] of raw.entries()) checkForm(value, `${at}[${index}]`, many, errors);
    return raw as unknown as readonly OnboardingObjectForm[];
}
