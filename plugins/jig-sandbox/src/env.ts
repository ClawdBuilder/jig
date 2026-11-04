// The environment a sandboxed command starts with: Pi's, without anything that looks like a credential, and without the
// sockets that reach an agent or a desktop session. Pi's own environment is not changed; the command gets a copy.
import path from "node:path";

/** Names that look like credentials, matched without regard to case. */
const CREDENTIAL_PATTERNS: readonly RegExp[] = [
    /TOKEN/i,
    /SECRET/i,
    /PASSWORD/i,
    /PASSWD/i,
    /_KEY$/i,
    /APIKEY/i,
    /CREDENTIAL/i,
    /^AWS_/i,
    /^AZURE_/i,
    /^GH_/i,
    /^GITHUB_/i,
    /^VAULT_/i,
    // Names that hold a password or a secret URL without saying "password" or "token".
    /_PWD$/i,
    /_DSN$/i,
    /_WEBHOOK$/i,
    /_PAT$/i,
];

/** Names removed whole. `NPM_TOKEN` and the `GOOGLE_*` credential file are named, as the pattern list cannot guess them. */
const CREDENTIAL_NAMES: ReadonlySet<string> = new Set([
    "GOOGLE_APPLICATION_CREDENTIALS",
    "NPM_TOKEN",
    "KUBECONFIG",
    "SSH_AUTH_SOCK",
    "GPG_AGENT_INFO",
    "DBUS_SESSION_BUS_ADDRESS",
    "WSL_INTEROP",
]);

/** The shortest value that is scrubbed from output: shorter ones would turn ordinary words into `[redacted]`. */
export const MIN_SCRUBBED_LENGTH = 8;

/** Whether a variable of this name is removed. */
export function looksLikeCredential(name: string): boolean {
    const upper = name.toUpperCase();
    return CREDENTIAL_NAMES.has(upper) || CREDENTIAL_PATTERNS.some((pattern) => pattern.test(name));
}

/** A value with a password in its address: `postgres://user:hunter2@db/orders`, whatever the variable is called. */
const ADDRESS_WITH_PASSWORD = /^[a-z][a-z0-9+.-]*:\/\/[^/\s:@]*:[^/\s@]+@/i;

/** Whether a value carries a password in a URL, so it is a credential however its name reads. */
export function looksLikeCredentialValue(value: string): boolean {
    return ADDRESS_WITH_PASSWORD.test(value);
}

/** Whether a variable is removed: its name says credential, or its value is an address with a password. `keep` wins. */
function isCredential(name: string, value: string, keep: ReadonlySet<string>): boolean {
    if (keep.has(name.toUpperCase())) return false;
    return looksLikeCredential(name) || looksLikeCredentialValue(value);
}

export interface ScrubbedEnvironment {
    /** What the command starts with. */
    env: NodeJS.ProcessEnv;
    /** The names that were removed, sorted. */
    removed: string[];
    /** Their values, for scrubbing output. Only values long enough to scrub. */
    values: string[];
}

export interface EnvironmentOptions {
    /** Variables passed in although their names look like credentials (`env.keep`). */
    keep: readonly string[];
    /** Added to the command's environment, such as `TMPDIR`. */
    set?: Readonly<Record<string, string>>;
    /** Folders that are hidden: a `PATH` entry inside one is dropped, since nothing in it can be run. */
    hiddenFolders?: readonly string[];
}

/** A copy of `source` without credentials, with `PATH` cleaned of entries that cannot work. */
export function scrubEnvironment(source: NodeJS.ProcessEnv, options: EnvironmentOptions): ScrubbedEnvironment {
    const keep = new Set(options.keep.map((name) => name.toUpperCase()));
    const env: NodeJS.ProcessEnv = {};
    const removed: string[] = [];
    const values: string[] = [];
    for (const [name, value] of Object.entries(source)) {
        if (value === undefined) continue;
        if (isCredential(name, value, keep)) {
            removed.push(name);
            if (value.length >= MIN_SCRUBBED_LENGTH) values.push(value);
            continue;
        }
        env[name] = value;
    }
    const hidden = options.hiddenFolders ?? [];
    if (env.PATH !== undefined && hidden.length > 0) {
        env.PATH = env.PATH.split(path.delimiter)
            .filter((entry) => !hidden.some((folder) => entry === folder || entry.startsWith(`${folder}/`)))
            .join(path.delimiter);
    }
    Object.assign(env, options.set);
    // Longest first, so a value that holds another is replaced whole.
    values.sort((a, b) => b.length - a.length);
    return { env, removed: removed.sort(), values: [...new Set(values)] };
}
