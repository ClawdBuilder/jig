// The `jig` command: doctor and setup from any terminal, with no Pi session and no model. It loads the plugins Pi would
// load, registers their sections and defaults, and reads the same jig.json; nothing here starts a tool or connects.
import path from "node:path";
import { buildSetupPlan } from "../setup-plan.ts";
import { setupStateFrom, runSetup } from "../setup.ts";
import type { SetupUi } from "../setup.ts";
import { doctorContext } from "../doctor-checks.ts";
import { doctorMarkers, formatDoctor, runDoctor } from "../doctor.ts";
import type { DoctorLine, DoctorReport } from "../doctor.ts";
import { errorMessage } from "../errors.ts";
import { helpFor, strayWordsMessage } from "./help.ts";
import { npmInstall, piVersion, jigPackage } from "../pi-version.ts";
import { loadPersonalConfig } from "../state.ts";
import type { JigState } from "../state.ts";
import { loadHeadless, ownPackage } from "./headless.ts";
import type { LoadFailure } from "./headless.ts";
import { terminalUi } from "./terminal.ts";
import { update as updateCommand } from "./update.ts";
import { jigHome } from "./home.ts";
import { bootstrap } from "./bootstrap.ts";
import type { BootstrapUi } from "./bootstrap.ts";
import { findPi } from "./pi-command.ts";
import { writeSetup } from "../setup-write.ts";
import type { SetupChange } from "../setup-plan.ts";

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

/** The company step: which setup applies, and where. It writes the profile entry, then setup asks the rest. */
async function companyStep(state: JigState, ui: SetupUi): Promise<"ok" | "cancel" | "failed"> {
    const companies = [...state.companies.values()];
    if (companies.length === 0) {
        ui.notify("No company plugin is installed: this setup is just yours.", "info");
        return "ok";
    }
    const labels = companies.map((company) => `${company.displayName} (${company.name})`);
    const choice = await ui.select("Which company setup do you use?", [...labels, "None, just me"]);
    if (choice === undefined) return "cancel";
    if (choice === "None, just me") {
        const change: SetupChange = { section: "profile", path: "", label: "Company setup", value: "none" };
        return writeProfile(state, ui, [change], "Company setup: none, just me.");
    }
    const index = labels.indexOf(choice);
    const company = companies[index];
    if (company === undefined) return "cancel";
    const where = await ui.select(`Use ${company.displayName}'s setup in:`, ["Everywhere", `Only in ${process.cwd()}`]);
    if (where === undefined) return "cancel";
    const label = company.name;
    const changes: SetupChange[] =
        where === "Everywhere"
            ? [
                  { section: "profiles", path: `${label}.plugin`, label: "Company setup", value: company.name },
                  { section: "profile", path: "", label: "Company setup", value: label },
              ]
            : [
                  {
                      section: "profiles",
                      path: `${label}.plugin`,
                      label: "Company setup",
                      value: company.name,
                  },
                  {
                      section: "profiles",
                      path: `${label}.when.folders`,
                      label: "Company setup",
                      value: [`${process.cwd()}/**`],
                  },
                  { section: "profile", path: "", label: "Company setup", value: "auto" },
              ];
    const summary =
        where === "Everywhere"
            ? `Company setup: ${company.displayName}, in every folder.`
            : `Company setup: ${company.displayName}, only in ${process.cwd()}.`;
    return writeProfile(state, ui, changes, summary);
}

/** Writes the profile choice with the same gate as the rest: read again, back up, replace atomically. */
async function writeProfile(
    state: JigState,
    ui: SetupUi,
    changes: SetupChange[],
    summary: string,
): Promise<"ok" | "cancel" | "failed"> {
    const built = buildSetupPlan(setupStateFrom(state));
    if ("problem" in built) {
        ui.notify(built.problem, "warning");
        return "failed";
    }
    const ok = await ui.confirm(
        "Save this company choice?",
        `${summary}\n\nA backup is kept next to your settings file.`,
    );
    if (!ok) return "cancel";
    try {
        const result = writeSetup(built.plan, changes, state.now());
        ui.notify(`Saved to ${result.file}.${result.backup === undefined ? "" : ` Backup: ${result.backup}`}`, "info");
        loadPersonalConfig(state);
        return "ok";
    } catch (error) {
        ui.notify(`The company choice was not saved: ${errorMessage(error)}`, "error");
        return "failed";
    }
}

/** A setup that cannot ask: it prints what it did, and every offer gets the safe default. */
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

/** What `jig setup` takes: one section to ask about even when it is valid, and the bootstrap's flags. */
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

/** Runs the setup and returns its exit code: 0 done or nothing to do, 1 failed, 2 needs a terminal or bad arguments. */
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
            screen?.close();
            return 0;
        }
        process.stderr.write(
            "jig setup needs a terminal: its company, profile and credential choices have no safe headless default. The home is ready; run jig setup in a terminal to finish, or jig setup --yes to skip the questions.\n",
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
        if (step === "cancel") return 130;
        if (step === "failed") return 1;
        return await runSetup(loaded.state, ui as SetupUi, words.section);
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
