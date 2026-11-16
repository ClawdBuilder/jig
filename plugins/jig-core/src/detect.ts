// The built-in answers setup may find on the machine. A company names one; jig-core runs one fixed command, never
// plugin code, and a probe that fails or finds nothing is simply no default. Nothing secret is read or shown.
import { spawnSync } from "node:child_process";

/** The probes an onboarding item may name. */
export const DETECTS = ["user", "git-email", "gh-account", "aws-profile"] as const;

export type DetectName = (typeof DETECTS)[number];

/** What runs one probe: a program, its arguments and the environment to start it in. Tests give their own. */
export type ProbeRun = (program: string, args: readonly string[], env: NodeJS.ProcessEnv) => string | undefined;

/**
 * Refuses a `detect` name outside the fixed list, and a `detect` on an optional item: a found value would make the
 * item's "press Enter to leave it unset" untrue.
 */
export function checkDetect(item: { detect?: unknown; optional?: unknown }, at: string, errors: string[]): void {
    if (item.detect === undefined) return;
    if (!(DETECTS as readonly unknown[]).includes(item.detect)) {
        errors.push(`${at}.detect: must be one of ${DETECTS.join(", ")}`);
        return;
    }
    if (item.optional === true) errors.push(`${at}.detect: cannot be used with optional`);
}

/** Runs one fixed command without a shell and returns its trimmed stdout, or undefined when it fails or finds nothing. */
function command(program: string, args: readonly string[], env: NodeJS.ProcessEnv): string | undefined {
    try {
        const result = spawnSync(program, args, {
            encoding: "utf8",
            env,
            timeout: 1500,
            maxBuffer: 64 * 1024,
            stdio: ["ignore", "pipe", "ignore"],
        });
        if (result.status !== 0 || typeof result.stdout !== "string") return undefined;
        const text = result.stdout.trim();
        return text === "" ? undefined : text;
    } catch {
        return undefined;
    }
}

/** The answer a probe finds now, or undefined. `run` is for tests; setup passes the machine's environment. */
export function detectValue(
    name: DetectName,
    env: NodeJS.ProcessEnv = process.env,
    run: ProbeRun = command,
): string | undefined {
    switch (name) {
        case "user": {
            const user = (env.USER ?? "").trim() || (env.USERNAME ?? "").trim();
            return user === "" ? undefined : user;
        }
        case "git-email": {
            const email = run("git", ["config", "--get", "user.email"], env);
            if (email === undefined) return undefined;
            const at = email.indexOf("@");
            return (at > 0 ? email.slice(0, at) : email).trim() || undefined;
        }
        case "gh-account": {
            // The status lists the account and the host; it is a status, never the token.
            const status = run("gh", ["auth", "status"], env);
            return status === undefined ? undefined : /account\s+([A-Za-z0-9][A-Za-z0-9._-]*)/.exec(status)?.[1];
        }
        case "aws-profile": {
            const profiles = run("aws", ["configure", "list-profiles"], env);
            return profiles
                ?.split("\n")
                .map((line) => line.trim())
                .find((line) => line !== "");
        }
    }
}

/** The line setup shows for a value it found; it is a proposal, not an answer yet. */
export function detectedLine(value: string): string {
    return `Found on this machine: ${value}`;
}
