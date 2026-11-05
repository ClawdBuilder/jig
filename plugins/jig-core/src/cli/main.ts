// The `jig` command: doctor and setup from any terminal, with no Pi session and no model. It loads the plugins Pi would
// load, registers their sections and defaults, and reads the same jig.json; nothing here starts a tool or connects.
import { readFileSync } from "node:fs";
import path from "node:path";
import { homedir } from "node:os";
import { buildSetupPlan } from "../setup-plan.ts";
import { setupStateFrom, runSetup } from "../setup.ts";
import type { SetupUi } from "../setup.ts";
import { doctorContext } from "../doctor-checks.ts";
import { formatDoctor, runDoctor } from "../doctor.ts";
import type { DoctorLine, DoctorReport } from "../doctor.ts";
import { errorMessage } from "../errors.ts";
import { installLocation, piVersion, jigPackage } from "../pi-version.ts";
import { loadPersonalConfig } from "../state.ts";
import type { JigState } from "../state.ts";
import { agentDirFor, loadHeadless, ownPackage } from "./headless.ts";
import type { LoadFailure } from "./headless.ts";
import { terminalUi } from "./terminal.ts";
import { writeSetup } from "../setup-write.ts";
import type { SetupChange } from "../setup-plan.ts";

const USAGE = `Usage: jig doctor [--json] [--network] [--quiet]
       jig setup

jig doctor checks this machine, the settings and the secret stores, and changes nothing.
jig setup asks only what is missing, then writes your settings file once, with a backup.`;

function failureLines(failures: readonly LoadFailure[]): DoctorLine[] {
    return failures.map((failure, index) => ({
        id: `plugins.${index}`,
        group: "config",
        level: "fail",
        title: failure.package,
        detail: `could not be loaded: ${failure.reason}`,
        fix: "Reinstall that package, or remove it from the packages in Pi's settings.",
    }));
}

/** Runs the doctor and returns its exit code: 0 with no failures, 1 with a failure, 2 for bad arguments. */
async function doctor(args: readonly string[]): Promise<number> {
    const flags = new Set(args);
    const unknown = args.filter((word) => !["--json", "--network", "--quiet"].includes(word));
    if (unknown.length > 0) {
        process.stderr.write(`Unknown option ${unknown[0]}\n${USAGE}\n`);
        return 2;
    }
    if (process.stdout.isTTY === true && !flags.has("--json")) {
        process.stdout.write("Checking your setup…\n");
    }
    let loaded: Awaited<ReturnType<typeof loadHeadless>>;
    try {
        loaded = await loadHeadless();
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
                ...(loaded.jigListedButMissing === undefined
                    ? {}
                    : { jigListedButMissing: loaded.jigListedButMissing }),
                ...(loaded.projectSkipped === undefined ? {} : { projectSkipped: loaded.projectSkipped }),
            },
            {
                network: flags.has("--network"),
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
        process.stdout.write(`${JSON.stringify({ ...report, failures: failed }, null, 2)}\n`);
    } else {
        const shown = formatDoctor(report, { quiet: flags.has("--quiet"), command: "jig" });
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

/** Runs the setup and returns its exit code: 0 done or nothing to do, 1 failed, 130 cancelled. */
async function setup(): Promise<number> {
    if (process.stdin.isTTY !== true || process.stdout.isTTY !== true) {
        process.stderr.write("Setup needs a terminal with a screen. Run jig setup from a terminal.\n");
        return 1;
    }
    const ui = terminalUi();
    ui.notify("Starting jig setup…", "info");
    let loaded: Awaited<ReturnType<typeof loadHeadless>>;
    try {
        loaded = await loadHeadless();
    } catch (error) {
        ui.notify(`jig setup could not start: ${errorMessage(error)}`, "error");
        ui.close();
        return 1;
    }
    const skipped = loaded.projectSkipped;
    if (!loaded.jigInPi) {
        const message =
            skipped?.jigIncluded === true
                ? skipped.setupLine
                : (() => {
                      const pkg = ownPackage();
                      const where = installLocation(pkg.repository) ?? "github.com/Dev-Mriganka/jig";
                      return skipped === undefined && loaded.jigListedButMissing !== undefined
                          ? `Pi lists Jig, but its files are not there: ${loaded.jigListedButMissing.problem}\nInstall it with: pi install git:${where}\nThen run jig setup again.`
                          : `Jig is not installed in Pi yet, so there is nothing to set up for.\nInstall it with: pi install git:${where}\nThen run jig setup again.`;
                  })();
        ui.notify(message, "error");
        ui.close();
        return 1;
    }
    if (skipped !== undefined) {
        // A company can live only in this folder's project packages: say what was skipped and how to allow it, then stop.
        if (loaded.state.companies.size === 0) {
            ui.notify(skipped.setupLine, "error");
            ui.close();
            return 1;
        }
        ui.notify(skipped.setupLine, "warning");
    }
    try {
        const step = await companyStep(loaded.state, ui);
        if (step === "cancel") return 130;
        if (step === "failed") return 1;
        return await runSetup(loaded.state, ui);
    } catch (error) {
        ui.notify(`Setup stopped: ${errorMessage(error)}`, "error");
        return 1;
    } finally {
        ui.close();
    }
}

/** `jig`: the word picks the command. Returns the process exit code. */
export async function main(argv: readonly string[]): Promise<number> {
    const [word, ...rest] = argv;
    if (word === undefined || word === "--help" || word === "-h" || word === "help") {
        process.stdout.write(`${USAGE}\n`);
        return word === undefined ? 2 : 0;
    }
    if (word === "--version" || word === "-v") {
        process.stdout.write(`${jigPackage().version ?? "unknown"}\n`);
        return 0;
    }
    if (word === "doctor") return doctor(rest);
    if (word === "setup") {
        if (rest.length > 0) {
            process.stderr.write(`jig setup takes no options.\n${USAGE}\n`);
            return 2;
        }
        return setup();
    }
    process.stderr.write(`Unknown command ${word}\n${USAGE}\n`);
    return 2;
}
