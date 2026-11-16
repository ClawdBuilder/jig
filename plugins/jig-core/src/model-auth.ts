// Whether this Jig home has a model provider a person can use. It reads only local files and environment names:
// no credential is printed, no sign-in is attempted, and no model is called.
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
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

/** The one line a person sees when no provider is signed in for this home. */
export function modelSignInLine(home: string): string {
    return `No model provider is signed in for ${home}. Type /login inside jig to choose one, or run \`jig auth login <provider>\` in a terminal.`;
}

/** What the home's local files and environment say about a model provider. */
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
        if (typeof source !== "string" || source.includes("@clawdbuilder/jig")) continue;
        return {
            kind: "unknown",
            reason: `an extension package (${source}) is installed; doctor cannot check its model provider.`,
        };
    }

    return { kind: "missing" };
}

/** The doctor's one Model provider line; it never names a credential value. */
export function modelProviderLine(home: string, env: NodeJS.ProcessEnv = process.env): DoctorLine {
    const state = modelAuthState(home, env);
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
        detail: "not signed in for this Jig home.",
        fix: "Type /login inside jig to choose one, or run `jig auth login <provider>` in a terminal.",
    };
}
