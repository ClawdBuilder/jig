// A read-only status for one secret reference, for `/jig doctor` and `/jig setup`: found, missing, locked, unknown or
// invalid. A probe confirms that an entry EXISTS; it never resolves the reference, decrypts a store or prints a value.
// `pass` is an entry file, `env` a variable of this process, `file` a path's size and mode, the Keychain one `security`
// lookup without `-w`, 1Password an item list without its fields, and `cmd` the login tool's own status.
import { realpathSync, statSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import type { SecretBackend } from "./config.ts";
import type { RunOptions, RunResult } from "./contract.ts";
import { isEnvName, isPassEntry, MAX_FILE_BYTES, parseSecretReference } from "./secrets.ts";

export type SecretStatus = "found" | "missing" | "locked" | "unknown" | "invalid";

/** Starts a program the way `exec.run` does. Tests pass a fake that refuses a value-revealing argument. */
export type ProbeRun = (file: string, args: readonly string[], options?: RunOptions) => Promise<RunResult>;

/** What a probe found. `detail`, `warning` and `fix` are plain words and never hold the reference or a value. */
export interface SecretProbe {
    status: SecretStatus;
    backend?: SecretBackend;
    /** The store in plain words, such as "pass" or "an environment variable". */
    store?: string;
    detail?: string;
    /** Something to say about a found entry, such as a file other users can read. */
    warning?: string;
    /** A command or one action that adds the secret, for `missing`, or signs in, for `locked`. */
    fix?: string;
}

export interface SecretProbeOptions {
    /** Pi's environment, where `env:` looks. */
    env: NodeJS.ProcessEnv;
    /** The folder `pass` reads, by the rule `secrets.pass` sets. */
    passStoreDir: string;
    /** Pi's agent folder: a `file:` reference may not point inside it, and a `cmd:` may run there. */
    agentDir?: string;
    platform?: NodeJS.Platform;
    /** The home folder, for `file:~/...`. Default: the user's. */
    home?: string;
    /** How a program is started. Without one, a backend that needs a program is "unknown". */
    run?: ProbeRun;
    /** The folder a login status command runs in. */
    cwd?: string;
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

/** The status of one reference, with every probe that needs metadata. Never throws. */
export async function probeSecret(ref: string, options: SecretProbeOptions): Promise<SecretProbe> {
    const parsed = parseSecretReference(ref);
    if (parsed === undefined) return { status: "invalid", detail: "it is not a usable secret reference" };
    try {
        switch (parsed.backend) {
            case "pass":
            case "env":
            case "file":
                return probeSecretQuick(ref, options);
            case "keychain":
                return await probeKeychain(parsed.rest, options);
            case "op":
                return await probeOnePassword(ref, options);
            case "cmd":
                return await probeCommand(parsed.rest, options);
        }
    } catch {
        return {
            status: "unknown",
            backend: parsed.backend,
            store: STORE[parsed.backend],
            detail: "the store could not be checked",
        };
    }
}

/** The probes that need no program: `pass`, `env` and `file`. Used where a status must be cheap, such as the `/jig` nudge. */
export function probeSecretQuick(ref: string, options: SecretProbeOptions): SecretProbe {
    const parsed = parseSecretReference(ref);
    if (parsed === undefined) return { status: "invalid", detail: "it is not a usable secret reference" };
    try {
        if (parsed.backend === "pass") return probePass(parsed.rest, options);
        if (parsed.backend === "env") return probeEnv(parsed.rest, options.env);
        if (parsed.backend === "file") return probeFile(parsed.rest, options);
        return {
            status: "unknown",
            backend: parsed.backend,
            store: STORE[parsed.backend],
            detail: "this store is checked when setup asks, not on every status",
        };
    } catch {
        return {
            status: "unknown",
            backend: parsed.backend,
            store: STORE[parsed.backend],
            detail: "the store could not be checked",
        };
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
        return { status: "invalid", backend: "file", store: STORE.file, detail: "the path is not absolute" };
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
        const worldReadable = (options.platform ?? process.platform) !== "win32" && (info.mode & 0o004) !== 0;
        return {
            status: "found",
            backend: "file",
            store: STORE.file,
            detail: "found (the first line is not read until a tool needs it)",
            ...(worldReadable ? { warning: "other users can read this file; make it private (chmod 600)" } : {}),
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

/** The macOS Keychain, through `security` without `-w` or `-g`, so the password is never printed. */
async function probeKeychain(rest: string, options: SecretProbeOptions): Promise<SecretProbe> {
    if ((options.platform ?? process.platform) !== "darwin") {
        return {
            status: "invalid",
            backend: "keychain",
            store: STORE.keychain,
            detail: "the macOS Keychain is only on macOS",
            fix: "Use another store on this system.",
        };
    }
    const slash = rest.indexOf("/");
    const service = slash < 0 ? "" : rest.slice(0, slash);
    const account = slash < 0 ? "" : rest.slice(slash + 1);
    const fine = (part: string) => part !== "" && !part.startsWith("-") && !/[\u0000-\u001f\u007f]/.test(part);
    if (!fine(service) || !fine(account)) {
        return {
            status: "invalid",
            backend: "keychain",
            store: STORE.keychain,
            detail: "a Keychain reference is keychain:<service>/<account>",
        };
    }
    if (options.run === undefined) {
        return { status: "unknown", backend: "keychain", store: STORE.keychain, detail: "no Keychain check was run" };
    }
    try {
        const result = await options.run(
            "security",
            ["find-generic-password", "-s", service, "-a", account],
            runOptions(options, 8192),
        );
        if (result.timedOut) {
            return {
                status: "unknown",
                backend: "keychain",
                store: STORE.keychain,
                detail: "the Keychain did not answer",
            };
        }
        if (result.code === 0) {
            return { status: "found", backend: "keychain", store: STORE.keychain, detail: "found in the Keychain" };
        }
        const error = result.stderr.toLowerCase();
        if (/lock|interaction is not allowed/.test(error)) {
            return {
                status: "locked",
                backend: "keychain",
                store: STORE.keychain,
                detail: "the Keychain is locked",
                fix: "Unlock the login keychain, then check again.",
            };
        }
        if (/could not be found|item not found|errsecitemnotfound|no such/.test(error)) {
            return {
                status: "missing",
                backend: "keychain",
                store: STORE.keychain,
                detail: "the Keychain has no such item",
                fix: `security add-generic-password -s ${quoted(service)} -a ${quoted(account)} -w`,
            };
        }
        return {
            status: "unknown",
            backend: "keychain",
            store: STORE.keychain,
            detail: "the Keychain answered with an error",
        };
    } catch {
        return {
            status: "unknown",
            backend: "keychain",
            store: STORE.keychain,
            detail: "the Keychain could not be checked",
        };
    }
}

/** 1Password, through an item list only. `op item get` and `op read` are never run; the field is not verified. */
async function probeOnePassword(ref: string, options: SecretProbeOptions): Promise<SecretProbe> {
    const parts = opParts(ref);
    if (parts === undefined) {
        return {
            status: "invalid",
            backend: "op",
            store: STORE.op,
            detail: "a 1Password reference is op://<vault>/<item>/<field>",
        };
    }
    if (options.run === undefined) {
        return { status: "unknown", backend: "op", store: STORE.op, detail: "no 1Password check was run" };
    }
    try {
        const result = await options.run(
            "op",
            ["item", "list", "--vault", parts.vault, "--format", "json"],
            runOptions(options, 256 * 1024),
        );
        if (result.timedOut) {
            return { status: "unknown", backend: "op", store: STORE.op, detail: "1Password did not answer" };
        }
        if (result.code !== 0) {
            const error = result.stderr.toLowerCase();
            if (/sign in|signed in|not signed|session|authentication|unauthori[sz]ed|account/.test(error)) {
                return {
                    status: "locked",
                    backend: "op",
                    store: STORE.op,
                    detail: "1Password is not signed in",
                    fix: "Sign in with: op signin",
                };
            }
            return { status: "unknown", backend: "op", store: STORE.op, detail: "1Password answered with an error" };
        }
        const items = opItems(result.stdout);
        if (items && items.includes(parts.item)) {
            return {
                status: "found",
                backend: "op",
                store: STORE.op,
                detail: "item found; the field is not verified",
            };
        }
        return {
            status: "missing",
            backend: "op",
            store: STORE.op,
            detail: "1Password has no item with that title",
            fix: `op item create --category=login --title=${quoted(parts.item)} --vault=${quoted(parts.vault)}`,
        };
    } catch {
        return { status: "unknown", backend: "op", store: STORE.op, detail: "1Password could not be checked" };
    }
}

/** A login tool that owns the login: `gh` and `glab` answer for their own token, with no token printed. */
async function probeCommand(name: string, options: SecretProbeOptions): Promise<SecretProbe> {
    if (name !== "gh" && name !== "glab") {
        return {
            status: "unknown",
            backend: "cmd",
            store: STORE.cmd,
            detail: "Jig does not read a command's output to check it",
        };
    }
    if (options.run === undefined) {
        return { status: "unknown", backend: "cmd", store: STORE.cmd, detail: "no login check was run" };
    }
    const args = name === "gh" ? ["auth", "status", "--no-refresh"] : ["auth", "status"];
    try {
        const result = await options.run(name, args, runOptions(options, 8192));
        if (result.timedOut) {
            return { status: "unknown", backend: "cmd", store: STORE.cmd, detail: "the login check did not finish" };
        }
        if (result.code === 0) {
            return { status: "found", backend: "cmd", store: STORE.cmd, detail: "signed in" };
        }
        return {
            status: "missing",
            backend: "cmd",
            store: STORE.cmd,
            detail: "not signed in",
            fix: name === "gh" ? "gh auth login" : "glab auth login",
        };
    } catch {
        return { status: "unknown", backend: "cmd", store: STORE.cmd, detail: "the login tool could not be checked" };
    }
}

function opParts(ref: string): { vault: string; item: string; field: string } | undefined {
    if (!ref.startsWith("op://")) return undefined;
    const parts = ref.slice("op://".length).split("/");
    if (parts.length < 3 || parts.length > 4) return undefined;
    if (parts.some((part) => part === "" || /[\s\u0000-\u001f\u007f]/.test(part))) return undefined;
    const vault = parts[0];
    const item = parts[1];
    const field = parts.at(-1);
    return vault === undefined || item === undefined || field === undefined ? undefined : { vault, item, field };
}

/** The item titles in an `op item list --format json` answer, or undefined when it is not that shape. */
function opItems(stdout: string): string[] | undefined {
    try {
        const value: unknown = JSON.parse(stdout);
        if (!Array.isArray(value)) return undefined;
        const titles: string[] = [];
        for (const item of value) {
            if (typeof item === "object" && item !== null && typeof (item as { title?: unknown }).title === "string") {
                titles.push((item as { title: string }).title);
            }
        }
        return titles;
    } catch {
        return undefined;
    }
}

function runOptions(options: SecretProbeOptions, maxOutputBytes: number): RunOptions {
    return {
        timeoutMs: 8000,
        maxOutputBytes,
        ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
    };
}

/** A shell word for the fix line; the values are names, never secrets. */
function quoted(value: string): string {
    return `'${value.replace(/'/g, `'\\''`)}'`;
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
