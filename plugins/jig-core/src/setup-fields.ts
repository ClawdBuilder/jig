// The plain shape of one setup question: its label, the kind of answer, why it is needed and an example. The plan calls
// these, so the words a person reads stay in one place.
import { humanize } from "./plain-label.ts";
import { parseSecretReference } from "./secrets.ts";
import type { SetupFieldKind } from "./setup-plan.ts";

export function isSecret(last: string, current: unknown, defaultValue: unknown, message: string): boolean {
    const name = last.toLowerCase();
    return (
        /secret reference/i.test(message) || SECRET_NAMES.has(name) || isReference(current) || isReference(defaultValue)
    );
}

const SECRET_NAMES = new Set([
    "token",
    "password",
    "passwd",
    "secret",
    "key",
    "apikey",
    "api_key",
    "clientsecret",
    "client_secret",
    "accesskey",
    "secretkey",
    "credential",
    "credentials",
]);

export function isReference(value: unknown): boolean {
    return typeof value === "string" && parseSecretReference(value) !== undefined;
}

export function fieldKind(current: unknown, message: string, last: string): SetupFieldKind {
    if (typeof current === "boolean") return "boolean";
    if (typeof current === "number") return "number";
    if (/true or false|boolean/i.test(message)) return "boolean";
    if (/number|whole number/i.test(message) || /^port$/i.test(last)) return "number";
    return "text";
}

export function fieldLabel(section: string, path: string): string {
    const parts = path.split(".");
    const last = parts.pop() ?? path;
    const words = [humanize(section), ...parts.map(humanize)];
    const LAST: Record<string, string> = {
        user: "login",
        username: "login",
        userid: "login",
        url: "address",
        baseurl: "address",
    };
    words.push(LAST[last.toLowerCase()] ?? humanize(last));
    const label = words.filter((word) => word !== "").join(" ");
    return label.charAt(0).toUpperCase() + label.slice(1);
}

export function labelOf(section: string): string {
    const label = humanize(section);
    return label.charAt(0).toUpperCase() + label.slice(1);
}

export function reasonFor(message: string): string {
    if (/required|missing|must be set|needs a value/i.test(message)) return "This is still needed.";
    if (/number|whole number/i.test(message)) return "This needs a number.";
    if (/true or false|boolean/i.test(message)) return "This needs yes or no.";
    return "This needs a valid value.";
}

export function placeholderFor(kind: SetupFieldKind, current: unknown, last: string): string | undefined {
    if (kind === "boolean") return "yes or no";
    if (isPrimitive(current) && current !== "") {
        const shown = String(current)
            .replace(/[\u0000-\u001f\u007f]/g, " ")
            .slice(0, 80);
        if (isReference(shown)) return "A value Jig reads when needed";
        return `Now: ${shown}`;
    }
    if (kind === "number") return "A number";
    const examples: Record<string, string> = {
        user: "jdoe",
        username: "jdoe",
        site: "https://staging.example.com",
        url: "https://staging.example.com",
        baseurl: "https://staging.example.com",
        host: "api.staging.example.com",
    };
    return examples[last.toLowerCase()] ?? undefined;
}

/** Whether a field's `placeholder` is a hint about the answer (the value now, the shape) and not an example of one. A hint
 *  stays beside the question, because Enter keeps what it names; an example goes into the question's words. */
export function isHint(placeholder: string): boolean {
    return /^(?:Now: |yes or no$|A number$|A value Jig reads when needed$)/.test(placeholder);
}

function isPrimitive(value: unknown): value is string | number | boolean {
    return typeof value === "string" || typeof value === "number" || typeof value === "boolean";
}

/** The question with an example of its answer: "Address (for example https://example.com)". An example left bare in
 *  parentheses after a question reads as a default, and Enter does not take it. */
export function exampleQuestion(question: string, example?: string): string {
    return example === undefined ? question : `${question} (for example ${example})`;
}

/** The question for a name that Enter skips: an object's name, where an empty answer adds nothing. */
export function skipQuestion(question: string, example?: string): string {
    return `${question} (press Enter to skip${example === undefined ? "" : `; for example ${example}`})`;
}

/** A label in the middle of a sentence: its leading article or "your" in lower case ("The relay's address" becomes
 *  "the relay's address"), and any other word as it is, so a name such as Jira keeps its capital. */
export function inSentence(label: string): string {
    return label.replace(/[?.]$/, "").replace(/^(The|Your|A|An|Its|Their)\s/, (word) => word.toLowerCase());
}

/** What setup says to an empty answer to a question that needs one. A question is repeated; a label is a sentence. */
export function emptyAnswer(label: string): string {
    return label.endsWith("?") ? `Please answer: ${label}` : `Please enter a value for ${inSentence(label)}.`;
}

/** The question for an optional field: an empty answer leaves it unset. The example joins the same parenthetical, so a
 *  terminal does not print a second one after the question. */
export function optionalQuestion(label: string, example?: string): string {
    return `${label} (optional: press Enter to leave it unset${example === undefined ? "" : `; for example ${example}`})`;
}

/** The question for an optional number: Enter keeps what is set, or the default while it is unset, and says so. */
export function optionalNumberQuestion(
    question: string,
    keeps: { value: string | number; unset: boolean } | undefined,
    example?: string,
): string {
    const note =
        keeps === undefined
            ? "press Enter to leave it unset"
            : `Enter keeps ${keeps.unset ? "the default, " : ""}${keeps.value}`;
    return `${question} (optional: ${note}${example === undefined ? "" : `; for example ${example}`})`;
}

/** The question for a credential, built from the company's label without doubling its article. */
export function referenceQuestion(label: string): string {
    const named = label.replace(/^the\s+/i, "").trim();
    return `Where does the ${named} live?`;
}
