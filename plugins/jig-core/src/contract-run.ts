// The program-runner part of the plugin contract: what a plugin may ask `exec.run` for, and what it returns.
// Re-exported from contract.ts, which stays the one import plugins use.

/** What a program's output keeps when it passes `maxOutputBytes`: the start, the end, or both ends with the middle left out. */
export type OutputKeep = "head" | "tail" | "both";

export interface RunOptions {
    cwd?: string;
    /** Default 60 000. */
    timeoutMs?: number;
    /** Written to the process's standard input. */
    input?: string;
    /** Added to a minimal environment; the parent's environment is not passed whole. */
    env?: Readonly<Record<string, string>>;
    /** A credential jig-core resolves and attaches to this one call, and registers for redaction. */
    credential?: ProgramCredential;
    signal?: AbortSignal;
    /** Output beyond this is cut. Default 10 MiB. */
    maxOutputBytes?: number;
    /** What is kept when the output is cut: the start (the default), the end, or both ends. */
    keep?: OutputKeep;
}

export interface RunResult {
    code: number;
    stdout: string;
    stderr: string;
    timedOut: boolean;
}
