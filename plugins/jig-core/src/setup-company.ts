// The company step of setup, shared by the terminal command and `/jig setup` inside Pi. It writes only the profile
// choice, through the same read-again/backup/atomic gate as the rest of setup.
import { buildSetupPlan } from "./setup-plan.ts";
import type { SetupChange } from "./setup-plan.ts";
import { setupStateFrom } from "./setup.ts";
import type { SetupUi } from "./setup.ts";
import { errorMessage } from "./errors.ts";
import { loadPersonalConfig } from "./state.ts";
import type { JigState } from "./state.ts";
import { writeSetup } from "./setup-write.ts";

export interface CompanyStepResult {
    status: "ok" | "cancel" | "failed";
    backup?: string;
    /** The step saved the company choice, so a later "nothing was written" would not be true. */
    wrote?: true;
}

/** The company step: which setup applies, and where. It writes the profile entry, then setup asks the rest. */
export async function companyStep(
    state: JigState,
    ui: SetupUi,
    cwd: string = process.cwd(),
): Promise<CompanyStepResult> {
    const companies = [...state.companies.values()];
    if (companies.length === 0) {
        ui.notify("No company plugin is installed: this setup is just yours.", "info");
        return { status: "ok" };
    }
    const labels = companies.map((company) => `${company.displayName} (${company.name})`);
    const choice = await ui.select("Which company setup do you use?", [...labels, "None, just me"]);
    if (choice === undefined) return { status: "cancel" };
    if (choice === "None, just me") {
        const change: SetupChange = { section: "profile", path: "", label: "Company setup", value: "none" };
        return writeProfile(state, ui, [change], "Company setup: none, just me.");
    }
    const index = labels.indexOf(choice);
    const company = companies[index];
    if (company === undefined) return { status: "cancel" };
    const remoteScope =
        company.remotes.length === 0
            ? undefined
            : `Repositories of ${company.displayName} (${company.remotes.join(", ")})`;
    const where = await ui.select(`Use ${company.displayName}'s setup in:`, [
        "Everywhere",
        `Only in ${cwd}`,
        ...(remoteScope === undefined ? [] : [remoteScope]),
    ]);
    if (where === undefined) return { status: "cancel" };
    const label = company.name;
    const base: SetupChange[] = [
        { section: "profiles", path: `${label}.plugin`, label: "Company setup", value: company.name },
    ];
    const changes: SetupChange[] =
        where === "Everywhere"
            ? [...base, { section: "profile", path: "", label: "Company setup", value: label }]
            : [
                  ...base,
                  {
                      section: "profiles",
                      path: where === remoteScope ? `${label}.when.remotes` : `${label}.when.folders`,
                      label: "Company setup",
                      value: where === remoteScope ? [...company.remotes] : [`${cwd}/**`],
                  },
                  { section: "profile", path: "", label: "Company setup", value: "auto" },
              ];
    const summary =
        where === "Everywhere"
            ? `Company setup: ${company.displayName}, in every folder.`
            : where === remoteScope
              ? `Company setup: ${company.displayName}, in repositories matching ${company.remotes.join(", ")}.`
              : `Company setup: ${company.displayName}, only in ${cwd}.`;
    return writeProfile(state, ui, changes, summary);
}

/** Writes the profile choice with the same gate as the rest: read again, back up, replace atomically. */
async function writeProfile(
    state: JigState,
    ui: SetupUi,
    changes: SetupChange[],
    summary: string,
): Promise<CompanyStepResult> {
    const built = buildSetupPlan(setupStateFrom(state));
    if ("problem" in built) {
        ui.notify(built.problem, "warning");
        return { status: "failed" };
    }
    const ok = await ui.confirm(
        "Save this company choice?",
        `${summary}\n\nA backup is kept next to your settings file.`,
    );
    if (!ok) return { status: "cancel" };
    try {
        const result = writeSetup(built.plan, changes, state.now());
        ui.notify(`Saved to ${result.file}.${result.backup === undefined ? "" : ` Backup: ${result.backup}`}`, "info");
        loadPersonalConfig(state);
        return { status: "ok", wrote: true, ...(result.backup === undefined ? {} : { backup: result.backup }) };
    } catch (error) {
        ui.notify(`The company choice was not saved: ${errorMessage(error)}`, "error");
        return { status: "failed" };
    }
}
