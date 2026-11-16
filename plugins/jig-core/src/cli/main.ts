// The `jig` command: doctor and setup from any terminal, with no Pi session and no model. It loads the plugins Pi would
// load, registers their sections and defaults, and reads the same jig.json; nothing here starts a tool or connects.
import path from "node:path";
import { runSetup } from "../setup.ts";
import type { SetupUi } from "../setup.ts";
import { doctorContext } from "../doctor-checks.ts";
import { doctorMarkers, formatDoctor, runDoctor } from "../doctor.ts";
import { companyStep } from "../setup-company.ts";
import type { DoctorLine, DoctorReport } from "../doctor.ts";
import { errorMessage } from "../errors.ts";
import { helpFor, strayWordsMessage } from "./help.ts";
import { npmInstall, piVersion, jigPackage } from "../pi-version.ts";
import type { JigState } from "../state.ts";
import { loadHeadless, ownPackage } from "./headless.ts";
import type { LoadFailure } from "./headless.ts";
import { terminalUi } from "./terminal.ts";
import { update as updateCommand } from "./update.ts";
import { jigHome } from "./home.ts";
import { modelAuthState, modelSignInLine } from "../model-auth.ts";
import { bootstrap } from "./bootstrap.ts";
import type { BootstrapUi } from "./bootstrap.ts";
import { findPi } from "./pi-command.ts";

/** A package whose syntax this Node cannot strip is not a broken package: Pi's loader reads it, the command's does not. */
function unreadableByThisLoader(reason: string): boolean {
    return /not supported in strip-only mode|ERR_UNSUPPORTED_(NODE_MODULES_)?TYPE_STRIPPING|TypeScript parameter property/i.test(
        reason,
    );
}

function failureLines(failures: readonly LoadFailure[]): DoctorLine[] {
    return failures.map((failure, index) =>
        unreadableByThisLoader(failure.reason)
            ? {
                  id: `plugins.${index}`,
                  group: "config",
                  level: "skip",
                  title: failure.package,
                  detail: `not checked: Pi can load this package, but the command's TypeScript loader cannot (${failure.reason.slice(0, 160)}).`,
              }
            : {
                  id: `plugins.${index}`,
                  group: "config",
                  level: "fail",
                  title: failure.package,
                  detail: `could not be loaded: ${failure.reason}`,
                  fix: "Reinstall that package, or remove it from the packages in Pi's settings.",
              },
    );
}

/** Runs the doctor and returns its exit code: 0 with no failures, 1 with a failure, 2 for bad arguments. */
async function doctor(args: readonly string[]): Promise<number> {
    if (args.includes("--help") || args.includes("-h")) {
        process.stdout.write(`${helpFor("doctor")}\n`);
        return 0;
    }
    const flags = new Set(args);
    const words = args.filter((word) => !word.startsWith("-"));
    if (words.length > 0) {
        process.stderr.write(`${strayWordsMessage("doctor", args, words[0] as string)}\n`);
        return 2;
    }
    const unknown = args.filter((word) => !["--json", "--network", "--quiet"].includes(word));
    if (unknown.length > 0) {
        process.stderr.write(`jig doctor: unknown option ${unknown[0]}.\nRun jig doctor --help for usage.\n`);
        return 2;
    }
    if (process.stdout.isTTY === true && !flags.has("--json")) {
        process.stdout.write("Checking your setup…\n");
    }
    const home = jigHome();
    let loaded: Awaited<ReturnType<typeof loadHeadless>>;
    try {
        loaded = await loadHeadless({ agentDir: home });
    } catch (error) {
        process.stderr.write(`jig doctor could not start: ${errorMessage(error)}\n`);
        return 1;
    }
    const loadedFailures = [
        ...failureLines(loaded.failures),
        ...loaded.packageProblems.map((problem, index) => ({
            id: `plugins.${index}.missing`,
            group: "config" as const,
            level: "fail" as const,
            title: problem.source,
            detail: problem.problem,
            fix: `Reinstall it: pi install ${problem.source}`,
        })),
    ];
    let report: DoctorReport;
    try {
        report = await runDoctor(
            {
                ...doctorContext(loaded.state),
                standalone: true,
                jigInPi: loaded.jigInPi,
                ...(loaded.jigInPiVersion === undefined ? {} : { jigInPiVersion: loaded.jigInPiVersion }),
                ...(loaded.jigCopies === undefined ? {} : { jigCopies: loaded.jigCopies }),
                ...(loaded.jigListedButMissing === undefined
                    ? {}
                    : { jigListedButMissing: loaded.jigListedButMissing }),
                ...(loaded.projectSkipped === undefined ? {} : { projectSkipped: loaded.projectSkipped }),
                ...(loaded.filtered === undefined ? {} : { filtered: loaded.filtered }),
            },
            {
                network: flags.has("--network"),
                piVersion: () => findPi()?.version,
                ...(flags.has("--json") ? { jigVersion: undefined } : {}),
            },
        );
    } catch (error) {
        report = {
            lines: [
                ...loadedFailures,
                {
                    id: "cli.crashed",
                    group: "machine",
                    level: "fail",
                    title: "The checks could not run",
                    detail: errorMessage(error).slice(0, 300),
                    fix: "Run jig doctor again; if it keeps failing, report it.",
                },
            ],
            counts: { ok: 0, warn: 0, fail: 1, skip: 0 },
            meta: {
                jig: jigPackage().version ?? null,
                pi: piVersion() ?? null,
                node: process.versions.node,
                platform: process.platform,
                network: flags.has("--network"),
            },
        };
    }
    const lines = [...report.lines, ...loadedFailures];
    const failed = lines.filter((line) => line.level === "fail").length;
    const counts = { ok: 0, warn: 0, fail: 0, skip: 0 };
    for (const line of lines) counts[line.level]++;
    report = { ...report, lines, counts };
    if (flags.has("--json")) {
        process.stdout.write(`${JSON.stringify({ schema: 1, ...report, failures: failed }, null, 2)}\n`);
    } else {
        const noColor = process.env.NO_COLOR !== undefined && process.env.NO_COLOR !== "";
        const force = process.env.FORCE_COLOR;
        const forced = force !== undefined && force !== "" && force !== "0";
        const colour = !noColor && (forced || (process.stdout.isTTY === true && process.env.TERM !== "dumb"));
        const columns = process.stdout.columns ?? Number(process.env.COLUMNS ?? 0);
        const shown = formatDoctor(report, {
            quiet: flags.has("--quiet"),
            command: "jig",
            color: colour,
            markers: doctorMarkers(process.env),
            width: columns > 0 ? columns : 80,
        });
        process.stdout.write(`${shown.join("\n")}\n`);
    }
    return failed > 0 ? 1 : 0;
}

function plainUi(): BootstrapUi {
    return {
        notify(text, level) {
            const mark = level === "error" ? "Error: " : level === "warning" ? "Note: " : "";
            for (const line of text.split("\n")) process.stdout.write(`${mark}${line}\n`);
        },
        async confirm() {
            return false;
        },
    };
}
interface SetupWords {
    section?: string;
    bin?: string;
    source?: string;
    from?: string;
    yes: boolean;
}
function parseSetupArgs(args: readonly string[]): SetupWords | { problem: string } {
    const parsed: SetupWords = { yes: false };
    const usage = "\nRun jig setup --help for usage.";
    for (let index = 0; index < args.length; index++) {
        const word = args[index] as string;
        if (word === "--bin" || word === "--source" || word === "--from") {
            const found = args[index + 1];
            if (found === undefined || found.startsWith("-")) {
                return { problem: `jig setup: ${word} needs a value.${usage}` };
            }
            index++;
            if (word === "--bin") parsed.bin = found;
            else if (word === "--source") parsed.source = found;
            else parsed.from = found;
        } else if (word === "--yes" || word === "-y") {
            parsed.yes = true;
        } else if (word.startsWith("-")) {
            return { problem: `jig setup: unknown option ${word}.${usage}` };
        } else if (parsed.section === undefined) {
            parsed.section = word;
        } else {
            return { problem: strayWordsMessage("setup", args, word) };
        }
    }
    return parsed;
}

/** Runs the setup and returns its exit code: 0 done or nothing to do, 1 failed, 130 cancelled. */
async function setup(args: readonly string[]): Promise<number> {
    if (args.includes("--help") || args.includes("-h")) {
        process.stdout.write(`${helpFor("setup")}\n`);
        return 0;
    }
    const words = parseSetupArgs(args);
    if ("problem" in words) {
        process.stderr.write(`${words.problem}\n`);
        return 2;
    }
    const interactive = process.stdin.isTTY === true && process.stdout.isTTY === true;
    const screen = interactive ? terminalUi() : undefined;
    const ui: BootstrapUi = screen ?? plainUi();
    const home = jigHome();
    ui.notify(`The Jig home is ${home}.`, "info");
    // The bootstrap runs first and needs no answers: the home, the Jig in it and the jig command, then the questions below.
    const result = await bootstrap({
        home,
        ...(words.bin === undefined ? {} : { binDir: path.resolve(words.bin) }),
        ...(words.source === undefined ? {} : { source: words.source }),
        ...(words.from === undefined ? {} : { from: path.resolve(words.from) }),
        migrate: words.yes ? "yes" : interactive ? "ask" : "no",
        ui,
        env: process.env,
    });
    for (const problem of result.problems) ui.notify(problem, "error");
    if (result.problems.length > 0) {
        screen?.close();
        return 1;
    }
    if (!interactive) {
        if (words.yes) {
            ui.notify("Skipped the setup questions; run `jig setup` in a terminal to answer them.", "info");
            if (modelAuthState(home, process.env).kind === "missing") ui.notify(modelSignInLine(home), "warning");
            screen?.close();
            return 0;
        }
        process.stderr.write(
            "jig setup needs a terminal: the home is ready and Jig is installed, but the company, profile and credential questions have no safe headless default. Run jig setup in a terminal to answer them, or jig setup --yes to skip them.\n",
        );
        screen?.close();
        return 2;
    }
    let loaded: Awaited<ReturnType<typeof loadHeadless>>;
    try {
        loaded = await loadHeadless({ agentDir: home });
    } catch (error) {
        ui.notify(`jig setup could not start: ${errorMessage(error)}`, "error");
        screen?.close();
        return 1;
    }
    const skipped = loaded.projectSkipped;
    if (!loaded.jigInPi) {
        const message =
            skipped?.jigIncluded === true
                ? skipped.setupLine
                : (() => {
                      const npmWhere = npmInstall(ownPackage().name);
                      return skipped === undefined && loaded.jigListedButMissing !== undefined
                          ? `Pi lists Jig, but its files are not there: ${loaded.jigListedButMissing.problem}\nInstall it there with: jig install ${npmWhere}\nThen run jig setup again.`
                          : `Pi in ${home} does not load Jig yet, so there is nothing to set up for.\nInstall it there with: jig install ${npmWhere}\nThen run jig setup again.`;
                  })();
        ui.notify(message, "error");
        screen?.close();
        return 1;
    }
    if (skipped !== undefined) {
        // A company can live only in this folder's project packages: say what was skipped and how to allow it, then stop.
        if (loaded.state.companies.size === 0) {
            ui.notify(skipped.setupLine, "error");
            screen?.close();
            return 1;
        }
        ui.notify(skipped.setupLine, "warning");
    }
    try {
        const step = await companyStep(loaded.state, ui as SetupUi);
        if (step.status === "cancel") return 130;
        if (step.status === "failed") return 1;
        const code = await runSetup(loaded.state, ui as SetupUi, words.section);
        if (code === 0 && modelAuthState(home, process.env).kind === "missing")
            ui.notify(modelSignInLine(home), "warning");
        return code;
    } catch (error) {
        ui.notify(`Setup stopped: ${errorMessage(error)}`, "error");
        return 1;
    } finally {
        screen?.close();
    }
}

/** Runs one of Jig's own commands (`doctor`, `setup`, `update`) and returns the process exit code. */
export async function run(command: string, args: readonly string[]): Promise<number> {
    if (command === "doctor") return doctor(args);
    if (command === "update") return updateCommand(args);
    if (command === "setup") return setup(args);
    process.stderr.write(`Unknown command ${command}.\nRun jig --help for the commands.\n`);
    return 2;
}
