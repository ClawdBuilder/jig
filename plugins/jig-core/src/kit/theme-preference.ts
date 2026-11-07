// The person's saved browser-theme choice, shared by every Jig page. The review page saves it through the review server's
// authenticated settings; the other pages read the same file when they render. `ui.theme` is the fallback after this, then
// the operating system.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { themeChoice } from "./theme-client.ts";
import type { ThemeChoice } from "./theme-client.ts";

interface Saved {
    version?: unknown;
    theme?: unknown;
}

export const themePreferenceFile = (agentDir: string): string => path.join(agentDir, "theme.json");

/** Pi's rule exactly: empty is unset, no trimming, a leading `~` expands, and a relative path stays relative. */
export function agentDirFor(env: NodeJS.ProcessEnv = process.env, home: string = homedir()): string {
    const configured = env.PI_CODING_AGENT_DIR;
    if (configured) {
        if (configured === "~") return home;
        if (configured.startsWith("~/")) return path.join(home, configured.slice(2));
        return configured;
    }
    return path.join(home, ".pi", "agent");
}

/** The saved choice, or undefined when there is none or the file is not one this version wrote. */
export function readThemePreference(agentDir: string): ThemeChoice | undefined {
    try {
        const value = JSON.parse(readFileSync(themePreferenceFile(agentDir), "utf8")) as Saved;
        if (value.version !== 1) return undefined;
        return themeChoice(value.theme);
    } catch {
        return undefined;
    }
}

/** Saves a choice. A failed write costs only the next visit's fallback; it never fails a page. */
export function saveThemePreference(agentDir: string, choice: ThemeChoice): void {
    try {
        const file = themePreferenceFile(agentDir);
        mkdirSync(path.dirname(file), { recursive: true });
        writeFileSync(file, `${JSON.stringify({ version: 1, theme: themeChoice(choice) })}\n`, {
            encoding: "utf8",
            mode: 0o600,
        });
    } catch {
        // The page still uses the choice for this visit.
    }
}
