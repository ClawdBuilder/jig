// `/jig doctor`: the checks, their levels and the report. It reads and never writes a setting: a finding says what is
// wrong in plain words and gives one thing to do about it. The checks themselves are in doctor-checks.ts and
// doctor-secrets.ts; this file only runs them, counts them and lays the report out.
import type { CompanyAdditions, LoadedConfig, SectionCheck } from "./config.ts";
import type { OnboardingEntry, ProtectedPathInfo, RunOptions, RunResult, SandboxProvider } from "./contract.ts";
import { DOCTOR_CHECKS } from "./doctor-checks.ts";
import { errorMessage } from "./errors.ts";
import { jigPackage, piVersion } from "./pi-version.ts";
import type { Connector } from "./start-checks.ts";
import type { Timers } from "./watch/timers.ts";

/** `ok` works, `warn` is worth knowing, `fail` will stop a tool, `skip` was not checked or does not apply. */
export type DoctorLevel = "ok" | "warn" | "fail" | "skip";

export type DoctorGroupId = "machine" | "config" | "secrets" | "logins" | "network" | "sandbox" | "records";

/** The groups, in the order the report shows them. */
export const DOCTOR_GROUPS: ReadonlyArray<{ id: DoctorGroupId; title: string }> = [
    { id: "machine", title: "This machine" },
    { id: "config", title: "Configuration" },
    { id: "secrets", title: "Secrets" },
    { id: "logins", title: "Logins" },
    { id: "network", title: "Network" },
    { id: "sandbox", title: "Sandbox" },
    { id: "records", title: "Records" },
];

/** One finding. `title` is a short plain name, `detail` a sentence, and `fix` one command or next action. */
export interface DoctorLine {
    id: string;
    group: DoctorGroupId;
    level: DoctorLevel;
    title: string;
    detail?: string;
    fix?: string;
    /** A few machine-readable facts a screen does not show, such as a host and port. Never a value. */
    data?: Record<string, string | number | boolean>;
}

/** What the report is about, for the JSON file. Versions that could not be read are `null`. */
export interface DoctorMeta {
    jig: string | null;
    pi: string | null;
    node: string;
    platform: NodeJS.Platform;
    network: boolean;
}

export interface DoctorReport {
    lines: DoctorLine[];
    counts: Record<DoctorLevel, number>;
    meta: DoctorMeta;
}

/** The part of jig-core the checks read. `JigState` fits it; a test can build one by hand. */
export interface DoctorContext {
    env: NodeJS.ProcessEnv;
    personal: LoadedConfig;
    sectionChecks: ReadonlyMap<string, SectionCheck>;
    company: CompanyAdditions;
    /** The effective plugin sections: the company's defaults, with the person's own laid over them. */
    sections: ReadonlyMap<string, unknown>;
    /** The commands `cmd:` may run, by name: the company's and the person's. */
    commands: Readonly<Record<string, readonly string[]>>;
    /** The active company's onboarding list: what its people must supply, in its words. */
    onboarding?: OnboardingEntry;
    /** True in the `jig` command: there is no Pi session here, so a sandbox that has not started is not a failure. */
    standalone?: boolean;
    /** In the `jig` command: whether Pi's settings name the Jig package, and the version of the copy Pi loads. */
    jigInPi?: boolean;
    jigInPiVersion?: string;
    /** Pi lists Jig, but its folder is not there: a different problem from never installing it. */
    jigListedButMissing?: { source: string; problem: string };
    /** Project packages Pi would not load because the folder is not trusted: skipped, never imported. */
    projectSkipped?: { sources: string[]; line: string; jigIncluded: boolean };
    protectedPaths: () => readonly ProtectedPathInfo[];
    sandbox: SandboxProvider | undefined;
    recordsProblem: string | undefined;
    agentDir: string;
    configPath: string;
    stateDir: string;
    workingDir: string;
    secrets: { passStoreDir(): string };
    now: () => Date;
}

/** Starts a program, as `exec.run` does. Tests pass a fake. */
export type RunProgram = (file: string, args: readonly string[], options?: RunOptions) => Promise<RunResult>;

/** One plain HTTP GET for the latest release, without a credential. Tests pass a fake. */
export type ReleaseFetcher = (url: string, signal: AbortSignal) => Promise<{ status: number; text: string }>;

export interface DoctorOptions {
    /** How programs are started for the login checks. Default: `exec.run`. */
    run?: RunProgram;
    /** Finds a program on PATH, without starting it. Default: this machine's PATH. */
    pathLookup?: (program: string, env: NodeJS.ProcessEnv) => string | undefined;
    platform?: NodeJS.Platform;
    nodeVersion?: string;
    piVersion?: () => string | undefined;
    /** Jig's version. `null` says it could not be read, so the doctor shows the reinstall line. */
    jigVersion?: string | null;
    /** The package's `repository` field, for the reinstall line. Default: this checkout's package.json. */
    jigRepository?: string;
    /** The home folder, for paths written as `~/...`. Default: the user's. */
    home?: string;
    /** How long one login check may take. Default 5 seconds. */
    timeoutMs?: number;
    /** Run the network checks. Off unless the person adds `--network`. */
    network?: boolean;
    /** Makes the one TCP connection of a network check. Default: a real one. */
    connect?: Connector;
    /** The timers a network check's 3-second limit runs on. Default: Node's. */
    timers?: Timers;
    /** Fetches the latest release. Default: one HTTPS GET to the API. Tests pass a fake. */
    fetchText?: ReleaseFetcher;
}

/** Runs every check. Never throws: a check that crashes is one failed finding, and the rest still run. */
export async function runDoctor(context: DoctorContext, options: DoctorOptions = {}): Promise<DoctorReport> {
    const lines: DoctorLine[] = [];
    for (const [group, check] of DOCTOR_CHECKS) {
        try {
            lines.push(...(await check(context, options)));
        } catch (error) {
            lines.push({
                id: `${group}.crashed`,
                group,
                level: "fail",
                title: "A check could not run",
                detail: errorMessage(error).slice(0, 240),
                fix: "Run /jig doctor again; if it keeps failing, report it.",
            });
        }
    }
    const counts: Record<DoctorLevel, number> = { ok: 0, warn: 0, fail: 0, skip: 0 };
    for (const line of lines) counts[line.level]++;
    const pkg = jigPackage();
    const jig = options.jigVersion === null ? undefined : (options.jigVersion ?? pkg.version);
    const pi = (options.piVersion ?? piVersion)();
    return {
        lines,
        counts,
        meta: {
            jig: jig ?? null,
            pi: pi ?? null,
            node: options.nodeVersion ?? process.versions.node,
            platform: options.platform ?? process.platform,
            network: options.network === true,
        },
    };
}

/** The report as lines for Pi's screen: a summary, one section per group, and what to do about it. `quiet` keeps only
 *  the warnings and failures, with the summary of the whole report. */
export function formatDoctor(report: DoctorReport, options: { quiet?: boolean; command?: string } = {}): string[] {
    const { ok, warn, fail, skip } = report.counts;
    const shown =
        options.quiet === true
            ? report.lines.filter((line) => line.level === "warn" || line.level === "fail")
            : report.lines;
    const out = [
        `Jig doctor · ${ok} ok · ${count(warn, "warning")} · ${count(fail, "failure")}${skip === 0 ? "" : ` · ${skip} skipped`}`,
    ];
    for (const group of DOCTOR_GROUPS) {
        const lines = shown.filter((line) => line.group === group.id);
        if (lines.length === 0) continue;
        out.push("", group.title);
        for (const line of lines) {
            out.push(`  ${line.level.padEnd(4)} ${line.title}${line.detail === undefined ? "" : ` — ${line.detail}`}`);
            if (line.fix !== undefined) out.push(`       fix: ${line.fix}`);
        }
    }
    out.push("", ending(report.counts, options.command ?? "/jig"));
    return out;
}

function ending(counts: Record<DoctorLevel, number>, command: string): string {
    if (counts.fail > 0) {
        const things = counts.fail === 1 ? "1 thing needs" : `${counts.fail} things need`;
        return `${things} you. Fix ${counts.fail === 1 ? "it" : "them"} above, then run ${command} doctor again.`;
    }
    if (counts.warn > 0)
        return `Nothing is blocked. ${count(counts.warn, "warning")} ${counts.warn === 1 ? "is" : "are"} worth a look.`;
    if (counts.skip > 0) return `All checks passed; ${counts.skip} could not be checked here.`;
    return "All checks passed.";
}

function count(number: number, noun: string): string {
    return `${number} ${noun}${number === 1 ? "" : "s"}`;
}
