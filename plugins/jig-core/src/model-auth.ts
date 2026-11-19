// Whether this Pi folder has a model provider a person can use. In a session Pi itself says how many models it can use;
// without one (the terminal doctor) it reads only local files and environment names. No credential is printed, no
// sign-in is attempted, and no model is called.
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { PACKAGE_NAME } from "./cli/home.ts";
import { manifestOf, packageFolder, parseNpmSource } from "./cli/packages.ts";
import { folderName, installMode, signInHint } from "./install-mode.ts";
import { shorten } from "./secret-status.ts";
import type { DoctorLine } from "./doctor.ts";

/** A provider environment variable Pi reads without an auth.json entry. */
const ENV_KEYS = [
    "ANTHROPIC_API_KEY",
    "OPENAI_API_KEY",
    "GEMINI_API_KEY",
    "GOOGLE_API_KEY",
    "MISTRAL_API_KEY",
    "OPENROUTER_API_KEY",
    "XAI_API_KEY",
    "DEEPSEEK_API_KEY",
];

export type ModelAuthState =
    | { kind: "ready"; providers: string[] }
    | { kind: "missing" }
    | { kind: "unknown"; reason: string };

function readObject(file: string): Record<string, unknown> | undefined {
    try {
        const parsed: unknown = JSON.parse(readFileSync(file, "utf8"));
        return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
            ? (parsed as Record<string, unknown>)
            : undefined;
    } catch {
        return undefined;
    }
}

/** What Pi's model registry offers: the part of `ModelRegistry` Jig reads. A session passes Pi's own; the terminal has none. */
export interface ModelCatalogue {
    getAvailable(): readonly unknown[];
}

/** How many models Pi can use right now, or undefined when there is no registry or it cannot say. */
function availableModels(models: ModelCatalogue | undefined): number | undefined {
    try {
        return models?.getAvailable().length;
    } catch {
        return undefined;
    }
}

/** The one wording of the model count, for `/jig` and for the doctor: "3 models available", or what to do with none. */
export function modelCountText(count: number): string {
    return count === 0 ? "none available. Type /login." : `${count} ${count === 1 ? "model" : "models"} available`;
}

/** The one line a person sees when no provider is signed in for this folder. */
export function modelSignInLine(agentDir: string): string {
    return `No model provider is signed in for ${shorten(agentDir, homedir())}. ${signInHint(installMode(agentDir))}`;
}

/**
 * The model line of `/jig`: Pi's own count in a session ("Model — 3 models available"), else the sign-in line when the
 * folder's files say nothing is signed in. `missing` is true when no model can be used, so setup can warn.
 */
export function modelStatus(
    agentDir: string,
    env: NodeJS.ProcessEnv,
    models?: ModelCatalogue,
): { line: string; missing: boolean } | undefined {
    const count = availableModels(models);
    if (count !== undefined) return { line: `Model — ${modelCountText(count)}`, missing: count === 0 };
    if (agentDir === "" || modelAuthState(agentDir, env).kind !== "missing") return undefined;
    return { line: modelSignInLine(agentDir), missing: true };
}

/**
 * Jig's own package, by its exact name: an `npm:` source that names it (jig-bedrock and the other `jig-*` packages are not
 * it), its packed tarball, or a folder or clone whose package.json names it, which is how a checkout is listed.
 */
function isJigItself(source: string, agentDir: string): boolean {
    if (parseNpmSource(source)?.name === PACKAGE_NAME || /(^|\/)clawdbuilder-jig-\d[^/]*\.tgz$/i.test(source))
        return true;
    const { folder } = packageFolder(source, agentDir);
    return folder !== undefined && manifestOf(folder)?.name === PACKAGE_NAME;
}

/** What the folder's local files and environment say about a model provider. */
export function modelAuthState(home: string, env: NodeJS.ProcessEnv = process.env): ModelAuthState {
    const auth = path.join(home, "auth.json");
    if (existsSync(auth)) {
        const parsed = readObject(auth);
        if (parsed === undefined) return { kind: "unknown", reason: "auth.json could not be read." };
        const providers = Object.entries(parsed)
            .filter(([, value]) => typeof value === "object" && value !== null && !Array.isArray(value))
            .map(([provider]) => provider);
        if (providers.length > 0) return { kind: "ready", providers: providers.sort() };
    }

    const fromEnv = ENV_KEYS.filter((name) => (env[name] ?? "").trim() !== "");
    if (fromEnv.length > 0) return { kind: "ready", providers: fromEnv.map((name) => name.replace(/_API_KEY$/, "")) };

    if (existsSync(path.join(home, "models.json")))
        return { kind: "unknown", reason: "models.json defines providers; doctor cannot check them here." };

    const settings = readObject(path.join(home, "settings.json"));
    const packages = Array.isArray(settings?.packages) ? settings.packages : [];
    for (const entry of packages) {
        const source =
            typeof entry === "string"
                ? entry
                : typeof entry === "object" && entry !== null
                  ? (entry as { source?: unknown }).source
                  : undefined;
        if (typeof source !== "string" || isJigItself(source, home)) continue;
        return {
            kind: "unknown",
            reason: `an extension package (${source}) is installed; doctor cannot check its model provider.`,
        };
    }

    return { kind: "missing" };
}

/** The doctor's one Model line: Pi's count in a session, else the folder's files; it never names a credential value. */
export function modelProviderLine(
    agentDir: string,
    env: NodeJS.ProcessEnv = process.env,
    models?: ModelCatalogue,
): DoctorLine {
    const count = availableModels(models);
    if (count !== undefined) {
        const level = count === 0 ? "warn" : "ok";
        return {
            id: "logins.model",
            group: "logins",
            level,
            title: "Model",
            detail: modelCountText(count),
            ...(count === 0 ? { fix: "Type /login." } : {}),
        };
    }
    const state = modelAuthState(agentDir, env);
    if (state.kind === "ready")
        return {
            id: "logins.model",
            group: "logins",
            level: "ok",
            title: "Model provider",
            detail: `signed in: ${state.providers.join(", ")}.`,
        };
    if (state.kind === "unknown")
        return {
            id: "logins.model",
            group: "logins",
            level: "skip",
            title: "Model provider",
            detail: state.reason,
        };
    return {
        id: "logins.model",
        group: "logins",
        level: "warn",
        title: "Model provider",
        detail: `not signed in for ${folderName(installMode(agentDir))}.`,
        fix: signInHint(installMode(agentDir)),
    };
}
