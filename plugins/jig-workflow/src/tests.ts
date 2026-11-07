// Running a repository's tests, and recording what happened against the exact commit. The command comes from the user's
// `workflow.tests` or from the build file in the repository's root. It runs inside the sandbox when there is one; without it,
// only after the user has approved the exact commands (the gate makes the call ask, and the tool checks the approval).
import type { Dirent } from "node:fs";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import type { TestRule, WorkflowSettings } from "./config.ts";
import { withEnvironment } from "./environment.ts";
import type { Host } from "./host.ts";
import { chooseJava } from "./java.ts";
import type { JavaSources } from "./java.ts";
import type { RepoView } from "./repos.ts";
import type { TestResult } from "./store.ts";

/** What `workflow test` will run in one repository. */
export interface TestPlan {
    root: string;
    name: string;
    /** Absent when no command is known: then `problem` says what to set. */
    command?: string;
    timeoutSeconds: number;
    /** Plain variables the command runs with. */
    env?: Readonly<Record<string, string>>;
    /** Set in configuration for a command that needs what the sandbox hides: it runs outside, only with approval. */
    outside?: boolean;
    /** Where the command came from: `jig.json` or the build file that was found. */
    source?: string;
    problem?: string;
    /** One line on the JDK a Gradle build was given, or why it was left alone (see java.ts). */
    java?: string;
    /** Set when no installed JDK fits the build: the run for this repository does not start, and this says why. */
    javaProblem?: string;
    /** Report paths or folders relative to the repository; default JUnit-style folders are checked too. */
    reports?: readonly string[];
}

/** How many lines of output the tool hands back, and how many characters at most. */
const TAIL_LINES = 60;
const TAIL_CHARS = 8000;

// ---- the command ---------------------------------------------------------------------------------------------------------

function escapeRegExp(text: string): string {
    return text.replace(/[.+^${}()|[\]\\]/g, "\\$&");
}

/** A path pattern as a regular expression: `*` is any run of characters but `/`, `**` any run at all, `?` one character. */
export function globToRegExp(pattern: string): RegExp {
    let source = "";
    for (let i = 0; i < pattern.length; i++) {
        const char = pattern[i] as string;
        if (char === "*" && pattern[i + 1] === "*") {
            source += ".*";
            i++;
        } else if (char === "*") source += "[^/]*";
        else if (char === "?") source += "[^/]";
        else source += escapeRegExp(char);
    }
    return new RegExp(`^${source}$`);
}

const isPattern = (key: string): boolean => /[/*?]/.test(key);

/** Whether a `workflow.tests` key names this repository: by folder or origin name, or as a pattern over its path. */
export function ruleMatches(rule: Pick<TestRule, "key">, view: RepoView, cwd: string): boolean {
    if (!isPattern(rule.key))
        return rule.key === view.name || (view.remoteName !== undefined && rule.key === view.remoteName);
    const pattern = globToRegExp(rule.key);
    const relative = path.relative(cwd, view.root).split(path.sep).join("/");
    return pattern.test(view.root) || (!relative.startsWith("..") && pattern.test(relative));
}

const NPM_PLACEHOLDER = /no test specified/;

/** The default command for the build file found in the root, and the file: the first row of the table in the docs that is found. */
export function detectCommand(root: string): { command: string; file: string } | undefined {
    const has = (name: string): boolean => existsSync(path.join(root, name));
    if (has("gradlew")) return { command: "./gradlew test", file: "gradlew" };
    for (const file of ["build.gradle", "build.gradle.kts"]) if (has(file)) return { command: "gradle test", file };
    if (has("pom.xml")) return { command: "mvn -q test", file: "pom.xml" };
    if (has("package.json")) {
        try {
            const scripts = (
                JSON.parse(readFileSync(path.join(root, "package.json"), "utf8")) as { scripts?: { test?: unknown } }
            ).scripts;
            if (typeof scripts?.test === "string" && !NPM_PLACEHOLDER.test(scripts.test)) {
                return { command: "npm test", file: "package.json" };
            }
        } catch {
            // A package.json that is not valid has no test script to run.
        }
    }
    for (const file of ["pyproject.toml", "pytest.ini", "tox.ini", "setup.py"])
        if (has(file)) return { command: "pytest", file };
    if (has("go.mod")) return { command: "go test ./...", file: "go.mod" };
    if (has("Cargo.toml")) return { command: "cargo test", file: "Cargo.toml" };
    return undefined;
}

/**
 * The command for a repository: the first `workflow.tests` entry that matches, else the build file's default. With `java`, a Gradle
 * wrapper's command that has no `JAVA_HOME` from configuration is given the installed JDK that fits (java.ts); `env.JAVA_HOME` wins.
 */
export function planTests(settings: WorkflowSettings, view: RepoView, cwd: string, java?: JavaSources): TestPlan {
    const plan = planCommand(settings, view, cwd);
    if (java === undefined || plan.command === undefined || plan.env?.JAVA_HOME !== undefined) return plan;
    const choice = chooseJava(view.root, plan.command, java);
    if (choice === undefined) return plan;
    return {
        ...plan,
        ...(choice.home === undefined ? {} : { env: { ...plan.env, JAVA_HOME: choice.home } }),
        java: choice.note,
        ...(choice.problem === undefined ? {} : { javaProblem: choice.problem }),
    };
}

function planCommand(settings: WorkflowSettings, view: RepoView, cwd: string): TestPlan {
    const rule = settings.tests.find((candidate) => ruleMatches(candidate, view, cwd));
    if (rule !== undefined) {
        return {
            root: view.root,
            name: view.name,
            command: rule.command,
            timeoutSeconds: rule.timeoutSeconds ?? settings.testTimeoutSeconds,
            ...(rule.env === undefined ? {} : { env: rule.env }),
            ...(rule.outside === true ? { outside: true } : {}),
            ...(rule.reports === undefined ? {} : { reports: rule.reports }),
            source: `workflow.tests "${rule.key}"`,
        };
    }
    const found = detectCommand(view.root);
    if (found !== undefined) {
        return {
            root: view.root,
            name: view.name,
            command: found.command,
            timeoutSeconds: settings.testTimeoutSeconds,
            source: found.file,
        };
    }
    return {
        root: view.root,
        name: view.name,
        timeoutSeconds: settings.testTimeoutSeconds,
        problem: `no test command is known for ${view.name}: set workflow.tests in jig.json, such as { "${view.name}": "npm test" }`,
    };
}

/** What a user's yes to a plan rests on, besides the commits: the folder, the command, its variables and its time limit. */
export function testIdentity(plan: TestPlan): Array<string | number | boolean | undefined> {
    return [plan.root, plan.command, plan.timeoutSeconds, JSON.stringify(plan.env ?? {}), plan.outside === true];
}

// ---- running it ---------------------------------------------------------------------------------------------------------

/** How a command ended when something other than the sandbox or a plain shell ran it. */
export interface ShellRun {
    code: number | null;
    timedOut: boolean;
    output: string;
    truncated: boolean;
}

/** Runs a plan's command in its repository some other way: the one that asks the user (see outside.ts). */
const TEST_RAN =
    /(Tests run:|tests completed|Test > .* (FAILED|PASSED)|There were failing tests|No tests found|test results|\d+ (passed|failed))/i;
const USEFUL = /(error|failed|cannot|not found|unsupported|invalid|exception|missing|compile)/i;
const SETUP_SIGNAL =
    /(compile|compilation|cannot find|not found|unsupported class|invalid .{0,20}(jdk|java)|could not determine|could not resolve|configuration|no tests found|outofmemory|segmentation|killed|exception)/i;

/** A test report written after this run started: JUnit XML or a configured report path. A stale file does not count. */
export function reportWritten(root: string, startedMs: number, configured: readonly string[] = []): boolean {
    const dirs = ["build/test-results", "target/surefire-reports", "build/reports/tests", "test-results", "reports"];
    const seen = new Set<string>();
    const fresh = (file: string): boolean => {
        try {
            return statSync(file).mtimeMs >= startedMs;
        } catch {
            return false;
        }
    };
    const walk = (dir: string, depth: number): boolean => {
        if (depth < 0 || seen.has(dir)) return false;
        seen.add(dir);
        let entries: Dirent[];
        try {
            entries = readdirSync(dir, { withFileTypes: true });
        } catch {
            return false;
        }
        for (const entry of entries) {
            const candidate = `${dir}/${entry.name}`;
            if (entry.isFile() && /\.xml$/i.test(entry.name) && fresh(candidate)) return true;
            if (entry.isDirectory() && walk(candidate, depth - 1)) return true;
        }
        return false;
    };
    for (const entry of configured) {
        const candidate = path.resolve(root, entry);
        try {
            if (statSync(candidate).isFile() && fresh(candidate)) return true;
        } catch {
            if (walk(candidate, 3)) return true;
        }
    }
    return dirs.some((dir) => walk(path.resolve(root, dir), 3));
}

/** A nonzero run with a test report is a failing test; without one it may be setup, so never assert tests did not run. */
export function noTestsRan(output: string, exitCode: number | null, timedOut: boolean, reportFound: boolean): boolean {
    if (reportFound || timedOut || exitCode === 0 || exitCode === null) return false;
    return !TEST_RAN.test(output) && SETUP_SIGNAL.test(output);
}

/** The first few useful error lines from the whole output, for the model. */
export function setupLines(output: string): string[] {
    return output
        .replace(/\r\n?/g, "\n")
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line !== "" && USEFUL.test(line))
        .slice(0, 3);
}

export type OutsideRunner = (plan: TestPlan, options: { signal?: AbortSignal }) => Promise<ShellRun>;

export interface TestRun {
    result: TestResult;
    /** The end of what the command printed, for the agent to read. Not saved. */
    tail: string;
    truncated: boolean;
}

export function tailOf(output: string): string {
    const lines = output.replace(/\r\n?/g, "\n").trimEnd().split("\n");
    const kept = lines.slice(-TAIL_LINES).join("\n");
    return kept.length > TAIL_CHARS ? kept.slice(-TAIL_CHARS) : kept;
}

/**
 * Runs the command of a plan in its repository and describes how it ended, against the commit and tree the repository was in
 * when the run began (`view`). `sandboxed` says where: in the sandbox through `host.sandbox`, or as the user through a shell;
 * `outside` replaces both with a runner that has its own way to ask (and then `sandboxed` is false).
 * A run that is cancelled throws; nothing is recorded for it.
 */
export async function runTests(
    host: Host,
    plan: TestPlan,
    view: RepoView,
    options: { sandboxed: boolean; outside?: OutsideRunner; signal?: AbortSignal },
): Promise<TestRun> {
    if (plan.command === undefined) throw new Error(plan.problem ?? "no test command");
    if (plan.javaProblem !== undefined) throw new Error(plan.javaProblem);
    if (view.head === undefined) throw new Error(view.problem ?? `${view.name} has no commit to test`);
    const started = host.now();
    const timeoutMs = plan.timeoutSeconds * 1000;
    const signal = options.signal === undefined ? {} : { signal: options.signal };
    let code: number | null;
    let timedOut: boolean;
    let output: string;
    let truncated = false;
    if (options.outside !== undefined) {
        ({ code, timedOut, output, truncated } = await options.outside(plan, signal));
    } else if (options.sandboxed) {
        // The sandbox takes a command and nothing else, so the variables are set by the command line itself.
        const ran = await host.sandbox.run(withEnvironment(plan.command, plan.env), {
            cwd: plan.root,
            timeoutMs,
            ...signal,
        });
        ({ code, timedOut, output, truncated } = ran);
    } else {
        const ran = await host.run("/bin/sh", ["-c", plan.command], {
            cwd: plan.root,
            timeoutMs,
            ...(plan.env === undefined ? {} : { env: plan.env }),
            ...signal,
        });
        code = ran.code;
        timedOut = ran.timedOut;
        output = [ran.stdout, ran.stderr].filter((part) => part !== "").join("\n");
    }
    const finished = host.now();
    return {
        result: {
            head: view.head,
            clean: view.clean === true,
            passed: code === 0 && !timedOut,
            command: plan.command,
            exitCode: code,
            timedOut,
            sandboxed: options.sandboxed,
            at: finished.toISOString(),
            durationMs: Math.max(0, finished.getTime() - started.getTime()),
            ...(noTestsRan(output, code, timedOut, reportWritten(plan.root, started.getTime(), plan.reports))
                ? { noTestsRan: true }
                : {}),
            ...(plan.java === undefined ? {} : { java: plan.java }),
        },
        tail: tailOf(output),
        truncated,
    };
}
