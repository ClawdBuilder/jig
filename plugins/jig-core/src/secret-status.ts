// A read-only status for one secret reference, for `/jig doctor`: found, missing, locked, unknown or invalid. It never
// resolves the reference and never reads a value. `pass` is an entry file, `env` is a variable of this process, and `file`
// is a path's size; the last line of a file may still be empty, so "found" only means a tool will try to read it.
//
// The other three backends are not checked here yet: `keychain`, `op` and `cmd` return "unknown" and the doctor says so,
// rather than reading what they hold. A reference whose text is not a reference is "invalid", and the text is never
// repeated, because a mistaken reference may be a pasted secret.
import { realpathSync, statSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import type { SecretBackend } from "./config.ts";
import { isEnvName, isPassEntry, MAX_FILE_BYTES, parseSecretReference } from "./secrets.ts";

export type SecretStatus = "found" | "missing" | "locked" | "unknown" | "invalid";

/** What a probe found. `detail` and `fix` are plain words and never hold the reference or a value. */
export interface SecretProbe {
    status: SecretStatus;
    backend?: SecretBackend;
    /** The store in plain words, such as "pass" or "an environment variable". */
    store?: string;
    detail?: string;
    /** A command or one action that adds the secret, for `missing`. */
    fix?: string;
}

export interface SecretProbeOptions {
    /** Pi's environment, where `env:` looks. */
    env: NodeJS.ProcessEnv;
    /** The folder `pass` reads, by the rule `secrets.pass` sets. */
    passStoreDir: string;
    /** Pi's agent folder: a `file:` reference may not point inside it. Empty when not known. */
    agentDir?: string;
    platform?: NodeJS.Platform;
    /** The home folder, for `file:~/...`. Default: the user's. */
    home?: string;
}

const STORE: Record<SecretBackend, string> = {
    pass: "pass",
    env: "an environment variable",
    keychain: "the macOS Keychain",
    op: "1Password",
    cmd: "a command",
    file: "a file",
};

/** The store in plain words, for a sentence such as "missing from pass". */
export function storeName(backend: SecretBackend): string {
    return STORE[backend];
}

/** The status of one reference. Never throws: a backend that cannot be asked is "unknown". */
export function probeSecret(ref: string, options: SecretProbeOptions): SecretProbe {
    const parsed = parseSecretReference(ref);
    if (parsed === undefined) return { status: "invalid", detail: "it is not a usable secret reference" };
    const { backend, rest } = parsed;
    try {
        switch (backend) {
            case "pass":
                return probePass(rest, options);
            case "env":
                return probeEnv(rest, options.env);
            case "file":
                return probeFile(rest, options);
            case "keychain":
                return probeKeychain(options.platform ?? process.platform);
            default:
                return {
                    status: "unknown",
                    backend,
                    store: STORE[backend],
                    detail: "Jig does not read this store to check it",
                };
        }
    } catch {
        return { status: "unknown", backend, store: STORE[backend], detail: "the store could not be checked" };
    }
}

/** Whether the pass entry file exists. The store may still be locked; this does not decrypt anything. */
function probePass(entry: string, options: SecretProbeOptions): SecretProbe {
    if (!isPassEntry(entry)) {
        return { status: "invalid", backend: "pass", store: STORE.pass, detail: "the pass entry name is not valid" };
    }
    const file = `${path.join(options.passStoreDir, ...entry.split("/"))}.gpg`;
    try {
        const info = statSync(file);
        return info.isFile()
            ? { status: "found", backend: "pass", store: STORE.pass, detail: "found (the store may ask to unlock)" }
            : { status: "invalid", backend: "pass", store: STORE.pass, detail: "the pass entry is not a file" };
    } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code === "ENOENT") {
            return {
                status: "missing",
                backend: "pass",
                store: STORE.pass,
                detail: "the pass entry does not exist",
                fix: `pass insert ${entry}`,
            };
        }
        return { status: "unknown", backend: "pass", store: STORE.pass, detail: "the pass store could not be read" };
    }
}

function probeEnv(name: string, env: NodeJS.ProcessEnv): SecretProbe {
    if (!isEnvName(name)) {
        return {
            status: "invalid",
            backend: "env",
            store: STORE.env,
            detail: "the environment variable name is not valid",
        };
    }
    const value = env[name];
    if (value === undefined || value === "") {
        return {
            status: "missing",
            backend: "env",
            store: STORE.env,
            detail: `${name} is not set`,
            fix: `Set ${name} in the shell that starts Pi, then restart Pi.`,
        };
    }
    return { status: "found", backend: "env", store: STORE.env, detail: "found in this session's environment" };
}

/** `file:` exists, is a regular file and is not empty. Its first line is not read; a tool reads it when it needs the value. */
function probeFile(rest: string, options: SecretProbeOptions): SecretProbe {
    if (/[\u0000-\u001f\u007f]/.test(rest)) {
        return { status: "invalid", backend: "file", store: STORE.file, detail: "the path holds a control character" };
    }
    const home = options.home ?? homedir();
    const expanded = rest === "~" || rest.startsWith("~/") ? path.join(home, rest.slice(2)) : rest;
    if (!path.isAbsolute(expanded)) {
        return {
            status: "invalid",
            backend: "file",
            store: STORE.file,
            detail: "the path is not absolute",
        };
    }
    const where = path.resolve(expanded);
    const shown = shorten(where, home);
    const agentDir = options.agentDir ?? "";
    if (agentDir !== "") {
        // The path as written, and the file's real place, so a link into the agent folder is refused too.
        const agent = safeRealpath(agentDir) ?? path.resolve(agentDir);
        for (const place of [where, safeRealpath(where)]) {
            if (place !== undefined && (place === agent || place.startsWith(`${agent}${path.sep}`))) {
                return {
                    status: "invalid",
                    backend: "file",
                    store: STORE.file,
                    detail: "the path is inside Pi's agent folder, which Jig never reads for a secret",
                };
            }
        }
    }
    try {
        const info = statSync(where);
        if (!info.isFile()) {
            return { status: "invalid", backend: "file", store: STORE.file, detail: "the path is not a regular file" };
        }
        if (info.size > MAX_FILE_BYTES) {
            return { status: "invalid", backend: "file", store: STORE.file, detail: "the file is larger than 64 KiB" };
        }
        if (info.size === 0) {
            return {
                status: "missing",
                backend: "file",
                store: STORE.file,
                detail: "the file is empty",
                fix: `Create ${shown} and put the value on its first line.`,
            };
        }
        return {
            status: "found",
            backend: "file",
            store: STORE.file,
            detail: "found (the first line is not read until a tool needs it)",
        };
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") {
            return {
                status: "missing",
                backend: "file",
                store: STORE.file,
                detail: "the file does not exist",
                fix: `Create ${shown} and put the value on its first line.`,
            };
        }
        return { status: "unknown", backend: "file", store: STORE.file, detail: "the file could not be read" };
    }
}

function probeKeychain(platform: NodeJS.Platform): SecretProbe {
    if (platform !== "darwin") {
        return {
            status: "invalid",
            backend: "keychain",
            store: STORE.keychain,
            detail: "the macOS Keychain is only on macOS",
            fix: "Use another store on this system.",
        };
    }
    return {
        status: "unknown",
        backend: "keychain",
        store: STORE.keychain,
        detail: "Jig does not open the Keychain to check it yet",
    };
}

function safeRealpath(where: string): string | undefined {
    try {
        return realpathSync(where);
    } catch {
        return undefined;
    }
}

/** A path as a person reads it: `~/...` under the home folder, otherwise as written. */
export function shorten(where: string, home: string): string {
    return where === home || where.startsWith(`${home}${path.sep}`) ? `~${where.slice(home.length)}` : where;
}
