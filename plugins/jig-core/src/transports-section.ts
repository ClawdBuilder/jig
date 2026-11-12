// The `transports` section of jig.json: a relay a person or a company plugin configures instead of writing code.
// A company plugin gives the relay's address and services as defaults; the person adds the token. The checks here name
// the key that is wrong, and never repeat a token value.
import { homedir } from "node:os";
import { isAbsolute, resolve } from "node:path";
import { parseSecretReference } from "./secrets.ts";
import { isObject } from "./kit/values.ts";

export const TRANSPORTS_SECTION = "transports";
/** Default client label, as the protocol names it in the request body. */
export const DEFAULT_RELAY_CLIENT = "jig";
const CLIENT = /^[A-Za-z0-9._:/-]{1,64}$/;
const RESERVED_FIELDS = new Set([
    "protocol",
    "id",
    "client",
    "service",
    "method",
    "url",
    "headers",
    "body",
    "maxBytes",
    "timeoutMs",
]);
const ENTRY_FIELDS = new Set(["kind", "url", "token", "client", "services", "fields"]);
const LOOPBACK = new Set(["127.0.0.1", "localhost", "[::1]"]);

/** One configured relay, as the section holds it. `token` is absent when a company default leaves it to the person. */
export interface RelayTransportConfig {
    kind: "relay";
    url: string;
    token?: string;
    client: string;
    services: Readonly<Record<string, string>>;
    fields: Readonly<Record<string, string | number | boolean | null>>;
}

function hostOf(url: URL): string {
    return url.hostname.toLowerCase();
}

/** Why an address is not usable, or undefined. A plain-http address is only for this machine. */
function urlProblem(value: unknown): string | undefined {
    if (typeof value !== "string" || value === "")
        return "must be the relay's address, such as https://relay.example.com";
    let url: URL;
    try {
        url = new URL(value);
    } catch {
        return "must be a valid http or https address";
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") return "must use http or https";
    if (url.username !== "" || url.password !== "") return "must not hold a user name or password";
    if (url.pathname !== "" && url.pathname !== "/") return "must not hold a path";
    if (url.search !== "") return "must not hold a query";
    if (url.hash !== "") return "must not hold a fragment";
    if (url.protocol === "http:" && !LOOPBACK.has(hostOf(url))) {
        return "may use http only for 127.0.0.1, localhost or [::1]; use https for any other host";
    }
    return undefined;
}

function tokenProblem(value: unknown): string | undefined {
    if (value === undefined) return undefined;
    if (typeof value !== "string" || parseSecretReference(value) === undefined) {
        return "must be a secret reference such as pass:work/relay-token, not the token itself";
    }
    if (value.startsWith("file:")) {
        const path = value.slice("file:".length);
        if (!(isAbsolute(path) || path.startsWith("~/"))) {
            return "file: must name an absolute path or a path starting with ~/";
        }
        if (/[\u0000-\u001f\u007f]/.test(path)) return "file: must not hold a control character";
    }
    return undefined;
}

function servicesProblem(value: unknown): string | undefined {
    if (value === undefined) return undefined;
    if (!isObject(value)) return "must be a map of a tool's system to the relay's service";
    for (const [system, service] of Object.entries(value)) {
        if (system === "" || typeof service !== "string" || service === "") {
            return "must map each system to a non-empty service name";
        }
    }
    return undefined;
}

function fieldsProblems(value: unknown): string[] {
    if (value === undefined) return [];
    if (!isObject(value)) return ["must be a map of fixed request fields"];
    const out: string[] = [];
    for (const [name, field] of Object.entries(value)) {
        if (RESERVED_FIELDS.has(name)) out.push(`cannot set ${name}: it is a protocol field`);
        else if (
            field !== null &&
            typeof field !== "string" &&
            typeof field !== "number" &&
            typeof field !== "boolean"
        ) {
            out.push(`field "${name}" must be text, a number, true/false or null`);
        }
    }
    return out;
}

function entryErrors(name: string, raw: unknown, errors: string[]): void {
    const key = `${TRANSPORTS_SECTION}.${name}`;
    if (!isObject(raw)) {
        errors.push(`${key}: must be an object`);
        return;
    }
    for (const field of Object.keys(raw)) {
        if (!ENTRY_FIELDS.has(field)) errors.push(`${key}.${field}: is not a known field`);
    }
    if (raw.kind !== "relay") errors.push(`${key}.kind: must be "relay"`);
    const url = urlProblem(raw.url);
    if (url !== undefined) errors.push(`${key}.url: ${url}`);
    const token = tokenProblem(raw.token);
    if (token !== undefined) errors.push(`${key}.token: ${token}`);
    if (raw.client !== undefined && (typeof raw.client !== "string" || !CLIENT.test(raw.client))) {
        errors.push(`${key}.client: must be 1 to 64 characters of letters, digits, ".", "_", ":", "/" or "-"`);
    }
    const services = servicesProblem(raw.services);
    if (services !== undefined) errors.push(`${key}.services: ${services}`);
    for (const field of fieldsProblems(raw.fields)) errors.push(`${key}.fields: ${field}`);
}

export function validateTransportsSection(raw: unknown): readonly string[] {
    if (!isObject(raw)) return [`${TRANSPORTS_SECTION}: must be an object`];
    const errors: string[] = [];
    for (const [name, entry] of Object.entries(raw)) {
        if (name === "") errors.push(`${TRANSPORTS_SECTION}: a transport needs a name`);
        else entryErrors(name, entry, errors);
    }
    return errors;
}

/** The settings of one relay, for a caller that has already run the check. */
export function relayOf(raw: unknown, name: string): RelayTransportConfig | undefined {
    if (!isObject(raw)) return undefined;
    const entry = raw[name];
    if (!isObject(entry) || entry.kind !== "relay" || typeof entry.url !== "string") return undefined;
    const services = isObject(entry.services) ? entry.services : {};
    const fields = isObject(entry.fields) ? entry.fields : {};
    return {
        kind: "relay",
        url: entry.url,
        ...(typeof entry.token === "string" ? { token: entry.token } : {}),
        client: typeof entry.client === "string" ? entry.client : DEFAULT_RELAY_CLIENT,
        services: Object.fromEntries(
            Object.entries(services).filter(([, service]) => typeof service === "string") as [string, string][],
        ),
        fields: Object.fromEntries(
            Object.entries(fields).filter(
                ([, value]) =>
                    value === null ||
                    typeof value === "string" ||
                    typeof value === "number" ||
                    typeof value === "boolean",
            ),
        ) as Record<string, string | number | boolean | null>,
    };
}

/** The names in the section, in file order. */
export function relayNames(raw: unknown): string[] {
    return isObject(raw) ? Object.keys(raw) : [];
}

/** A `file:` token's absolute path, for the protected-path list. Other references have no path. */
export function tokenFilePaths(raw: unknown, home = homedir()): string[] {
    const out: string[] = [];
    if (!isObject(raw)) return out;
    for (const entry of Object.values(raw)) {
        if (!isObject(entry) || typeof entry.token !== "string" || !entry.token.startsWith("file:")) continue;
        const path = entry.token.slice("file:".length);
        if (path.startsWith("~/")) out.push(resolve(home, path.slice(2)));
        else if (isAbsolute(path)) out.push(resolve(path));
    }
    return out;
}
