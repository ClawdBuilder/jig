// The sandbox part of the plugin contract: the provider a sandbox plugin registers, and what it runs a command with.
// Re-exported from contract.ts, which stays the one import plugins use.

/** The network a sandboxed `bash` has. */
export type SandboxNetworkMode = "open" | "filtered" | "ask" | "off";

/** What a plugin asks for when it runs a command in the sandbox with `sandbox.run`. */
export interface SandboxRunOptions {
    /** The folder the command runs in: absolute. */
    cwd: string;
    /** From 1 ms to 2 hours. Without it the command may run until `signal` fires. */
    timeoutMs?: number;
    signal?: AbortSignal;
    /** The most output kept: the end of it, when there is more. Default 256 KiB. */
    maxOutputBytes?: number;
}

/** How a command run in the sandbox ended. */
export interface SandboxRunResult {
    /** The exit code, or null when the command was stopped (a timeout) or could not report one. */
    code: number | null;
    /** What the command printed, both streams together, cleaned of terminal control codes and with credentials taken out. */
    output: string;
    timedOut: boolean;
    /** True when `output` is only the end of what the command printed. */
    truncated: boolean;
}

/** What a sandbox plugin tells jig-core about the `bash` it runs. Fields are read when they are needed, so they may change. */
export interface SandboxProvider {
    /** True while `bash` commands run inside the sandbox. False when it is switched off, or could not start. */
    readonly active: boolean;
    /** The network mode, while active. */
    readonly mode?: SandboxNetworkMode;
    /** One line for `/jig` that says why the sandbox is not active, or anything else the user should know. */
    readonly note?: string;
    /** Whether a command in the sandbox can write this path: absolute, links followed. A program there is not one Jig may run.
     *  `true` means writable, or that the question could not be answered: a caller that must not be wrong treats it as a maybe. */
    canWrite(path: string): boolean;
    /** The folders the person allowed for this session or always, as bash's rules received them. Optional: without it the
     *  file tools allow the working folder only outside it. */
    allowedFolders?(): readonly string[];
    /** Settles when the sandbox has started, or failed to, so that session start can say which. */
    whenReady?(): Promise<void>;
    /** Where the sandbox's broker script is, so the standalone doctor can start it; a sandbox with no broker leaves it out. */
    readonly brokerScript?: string;
    /** Runs a shell command the way the sandbox runs the agent's `bash`: the same rules, environment and audit, without
     *  the tool around it. Rejects when the sandbox refuses the command or the command is cancelled; a command that
     *  ran and failed, or timed out, is a result. Optional: a sandbox without it still hides `bash`, and `sandbox.canRun`
     *  is false. */
    run?(command: string, options: SandboxRunOptions): Promise<SandboxRunResult>;
}
