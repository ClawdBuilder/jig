// The credential part of `/jig setup`: which stores to offer, the company's choice, and the reference built from plain
// parts. A reference is assembled here; a person never types `op://` or `pass:`.
import { homedir } from "node:os";
import path from "node:path";
import type { SecretBackend } from "./config.ts";
import { isEnvName, isPassEntry, parseSecretReference } from "./secrets.ts";
import { shorten } from "./secret-status.ts";
import type { SetupReferenceChoice, SetupState } from "./setup-plan.ts";

/** The store choices, in the order they are shown when the company has no preference. */
const STORE_ORDER: readonly SecretBackend[] = ["op", "keychain", "pass", "env", "file", "cmd"];

/** The plain name of a store in a sentence, such as "read from pass". */
export function storeLabel(store: SecretBackend): string {
    return store === "op"
        ? "1Password"
        : store === "keychain"
          ? "the macOS Keychain"
          : store === "pass"
            ? "pass"
            : store === "env"
              ? "an environment variable"
              : store === "file"
                ? "a file"
                : "a tool that owns the login";
}

/** The label of a store in a choice: the user's language, with a file marked as the weak choice. */
export function storeChoiceLabel(store: SecretBackend): string {
    return store === "op"
        ? "1Password"
        : store === "keychain"
          ? "macOS Keychain"
          : store === "pass"
            ? "pass (password store)"
            : store === "env"
              ? "An environment variable"
              : store === "file"
                ? "A file (not recommended)"
                : "A tool that owns the login";
}

/** Which stores this machine can offer, and which of them the person turned off. */
export function referenceChoice(state: SetupState, current: unknown, defaultValue: unknown): SetupReferenceChoice {
    const applicable = STORE_ORDER.filter((store) => storeApplicable(store, state));
    const disabled = applicable.filter((store) => state.disabledBackends.includes(store));
    const available = applicable.filter((store) => !disabled.includes(store));
    const fromDefault = typeof defaultValue === "string" ? parseSecretReference(defaultValue)?.backend : undefined;
    const fromCurrent = typeof current === "string" ? parseSecretReference(current)?.backend : undefined;
    const preferred = [fromDefault, fromCurrent, ...state.companyBackends].find(
        (store): store is SecretBackend => store !== undefined && available.includes(store),
    );
    const stores =
        preferred === undefined ? available : [preferred, ...available.filter((store) => store !== preferred)];
    return {
        stores,
        ...(preferred === undefined ? {} : { preferred }),
        enabled: state.enabledBackends.filter((store) => stores.includes(store)),
        disabled,
        commands: state.commands,
    };
}

function storeApplicable(store: SecretBackend, state: SetupState): boolean {
    if (store === "keychain") return state.platform === "darwin";
    if (store === "pass") return state.pathLookup("pass", state.env) !== undefined;
    if (store === "op") return state.pathLookup("op", state.env) !== undefined;
    if (store === "cmd") return Object.keys(state.commands).length > 0;
    return true;
}

export interface ReferenceParts {
    vault?: string;
    item?: string;
    field?: string;
    service?: string;
    account?: string;
    entry?: string;
    name?: string;
    file?: string;
    command?: string;
}

/** Builds the reference from plain parts. It never echoes a reference or a value in a problem. */
export function buildReference(
    store: SecretBackend,
    parts: ReferenceParts,
    commands: Readonly<Record<string, readonly string[]>>,
): { reference: string; note: string } | { problem: string } {
    if (store === "op") {
        if (!parts.vault || !parts.item || !parts.field)
            return { problem: "Please fill in the vault, item and field." };
        if ([parts.vault, parts.item, parts.field].some((part) => /[\s/\u0000-\u001f\u007f]/.test(part))) {
            return { problem: "The vault, item and field cannot hold a space or a slash." };
        }
        return {
            reference: `op://${parts.vault}/${parts.item}/${parts.field}`,
            note: `1Password item "${parts.item}" in vault "${parts.vault}"`,
        };
    }
    if (store === "keychain") {
        if (!parts.service || !parts.account) return { problem: "Please fill in the service and the account." };
        if ([parts.service, parts.account].some((part) => /[\u0000-\u001f\u007f]/.test(part))) {
            return { problem: "The service and account cannot hold a control character." };
        }
        if (parts.service.includes("/") || parts.service.startsWith("-") || parts.account.startsWith("-")) {
            return { problem: "The service cannot hold a slash, and neither can start with a dash." };
        }
        return {
            reference: `keychain:${parts.service}/${parts.account}`,
            note: `the macOS Keychain item service "${parts.service}", account "${parts.account}"`,
        };
    }
    if (store === "pass") {
        if (!parts.entry || !isPassEntry(parts.entry)) return { problem: "That pass entry name is not valid." };
        return { reference: `pass:${parts.entry}`, note: `pass entry ${parts.entry}` };
    }
    if (store === "env") {
        if (!parts.name || !isEnvName(parts.name)) return { problem: "That environment variable name is not valid." };
        return { reference: `env:${parts.name}`, note: `environment variable ${parts.name}` };
    }
    if (store === "file") {
        if (!parts.file || /[\u0000-\u001f\u007f]/.test(parts.file)) return { problem: "Please choose a file path." };
        if (!parts.file.startsWith("~/") && !path.isAbsolute(parts.file)) {
            return { problem: "The file path must be absolute, or start with ~/." };
        }
        const where = parts.file.startsWith("~/") ? path.join(homedir(), parts.file.slice(2)) : parts.file;
        return { reference: `file:${parts.file}`, note: `file ${shorten(where, homedir())}` };
    }
    if (!parts.command || !Object.hasOwn(commands, parts.command)) {
        return { problem: "Choose one of the commands your settings declare." };
    }
    return { reference: `cmd:${parts.command}`, note: `the command "${parts.command}"` };
}

/** A reference in words, for a line a person reads: never the `scheme:name` syntax. */
export function describeReference(reference: string): string {
    const parsed = parseSecretReference(reference);
    if (parsed === undefined) return "that place";
    if (parsed.backend === "pass") return `the entry ${parsed.rest}`;
    if (parsed.backend === "env") return `the variable ${parsed.rest}`;
    if (parsed.backend === "cmd") return `the command ${parsed.rest}`;
    if (parsed.backend === "file") return `the file ${parsed.rest}`;
    if (parsed.backend === "keychain") return `the Keychain item ${parsed.rest}`;
    return `the 1Password item ${parsed.rest.replace(/^\/\//, "")}`;
}
