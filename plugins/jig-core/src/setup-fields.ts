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
        user: "For example: jdoe",
        username: "For example: jdoe",
        site: "For example: https://staging.example.com",
        url: "For example: https://staging.example.com",
        baseurl: "For example: https://staging.example.com",
        host: "For example: api.staging.example.com",
    };
    return examples[last.toLowerCase()] ?? undefined;
}

function isPrimitive(value: unknown): value is string | number | boolean {
    return typeof value === "string" || typeof value === "number" || typeof value === "boolean";
}
