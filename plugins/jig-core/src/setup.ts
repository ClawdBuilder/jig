// `/jig setup`: the questions, the plugin list, the plain summary, and the one confirmation that writes. It is a command,
// never a tool, so the model cannot run it. Every screen is plain words; the only JSON is behind "Show the exact change".
import { homedir } from "node:os";

import { effectiveBackends } from "./config.ts";
import { detectValue } from "./detect.ts";
import type { DetectName } from "./detect.ts";
import { findOnPath } from "./doctor-secrets.ts";
import { errorMessage } from "./errors.ts";
import { activeOnboarding, effectiveDefaults } from "./profile-state.ts";
import { proposalSections } from "./setup-proposal.ts";
import { ask, askMethods } from "./setup-ask.ts";
import { buildSetupPlan } from "./setup-plan.ts";
import type { SetupChange, SetupField, SetupPlan, SetupSection, SetupState } from "./setup-plan.ts";
import { itemAt, introOf, loginsOf } from "./setup-questions.ts";
import { DONE_LINE, changeCount, listScreen, listTitle, pendingLines, pluginLines, readyLines } from "./setup-menu.ts";
import { exactChangeLines, SetupRefused, settingCount, summaryLines, writeSetup } from "./setup-write.ts";
import { labelOf } from "./setup-fields.ts";
import { withTransports } from "./setup-transports.ts";
import { TRANSPORTS_SECTION } from "./transports-section.ts";
import { sectionQuestions } from "./setup-section.ts";
import { shorten } from "./secret-status.ts";
import type { JigState } from "./engine-state.ts";

/** What a screen has to offer: Pi's UI in a session, a terminal in the `jig` command. */
export interface SetupUi {
    select(title: string, options: string[]): Promise<string | undefined>;
    input(title: string, placeholder?: string): Promise<string | undefined>;
    /** A yes/no. `defaultYes` says Enter answers yes (a terminal shows "(Y/n)"); Pi's dialog already has Yes selected. A
     *  question that writes or spends something leaves it out: there No is the default, and consent is the person's word. */
    confirm(title: string, message: string, options?: { defaultYes?: boolean }): Promise<boolean>;
    notify(text: string, level: "info" | "warning" | "error"): void;
}

/** Runs the whole flow. It writes nothing unless the person confirms the summary. */
export async function runSetup(
    state: JigState,
    ui: SetupUi,
    requestedSection?: string,
    apply: "terminal" | "reload" = "terminal",
): Promise<number> {
    let proposed = false;
    let onboarding: ReturnType<typeof activeOnboarding>;
    try {
        onboarding = activeOnboarding(state);
        proposed = proposalSections(onboarding).has(requestedSection ?? "");
    } catch {
        // A test's stand-in may not carry the profile state; there can be no proposal then.
    }
    // `transports` is jig-core's own section, which setup asks too; it is not one a plugin registered.
    const own = requestedSection === TRANSPORTS_SECTION;
    if (requestedSection !== undefined && !own && !state.sectionChecks.has(requestedSection) && !proposed) {
        const known = [...state.sectionChecks.keys(), TRANSPORTS_SECTION].sort();
        ui.notify(
            `Unknown section ${JSON.stringify(requestedSection)}. Known sections: ${known.join(", ") || "none"}.`,
            "error",
        );
        return 2;
    }
    const planState = setupStateFrom(state);
    if (requestedSection !== undefined) planState.requestedSection = requestedSection;
    const built = buildSetupPlan(planState);
    if ("problem" in built) {
        ui.notify(built.problem, "warning");
        return 1;
    }
    const plan = built.plan;
    const draft = structuredClone(plan.raw);
    const changes: SetupChange[] = [];
    // What the company's list or a plugin's list asked setup to look for, looked for once per probe and only when its
    // question comes up.
    const probes = new Map<DetectName, string | undefined>();
    const found = (field: SetupField): string | undefined => {
        const item = itemAt(planState, field.section, field.path);
        if (item === undefined || (item.kind !== "text" && item.kind !== "pick" && item.kind !== "entry"))
            return undefined;
        if (item.detect === undefined) return undefined;
        if (!probes.has(item.detect)) probes.set(item.detect, detectValue(item.detect, state.env));
        const value = probes.get(item.detect);
        if (value === undefined) return undefined;
        return item.kind === "pick" && !item.choices.includes(value) ? undefined : value;
    };

    // A named section asks only its own questions, whether or not it is set up.
    if (requestedSection !== undefined) {
        const sections = plan.sections.filter((section) => section.name === requestedSection);
        if (sections.every((section) => section.fields.length === 0 && !section.askMethod)) {
            ui.notify(`Nothing to ask for ${requestedSection}.`, "info");
            const setup = planState.sectionSetup?.get(requestedSection);
            if (setup?.pending !== undefined)
                ui.notify(pendingLines(labelOf(requestedSection), setup).join("\n"), "info");
            return 0;
        }
        ui.notify("Jig setup asks only what is missing. It never asks for a password or a token.", "info");
        for (const text of plan.intro) ui.notify(text, "info");
        for (const login of plan.logins) ui.notify(loginLine(login, programPresent(planState, login.tool)), "info");
        for (const section of sections) {
            if ((await askSection(state, ui, plan, section, draft, changes, found)) === "cancel") return cancel(ui);
        }
        return finish(ui, plan, changes, apply, state.now);
    }

    // No section named: the company's and the validators' questions first, then the plugin list.
    ui.notify("Jig setup asks only what is missing. It never asks for a password or a token.", "info");
    for (const text of plan.intro) ui.notify(text, "info");
    for (const login of plan.logins) ui.notify(loginLine(login, programPresent(planState, login.tool)), "info");
    for (const section of plan.sections) {
        if (section.fields.length === 0 && !section.askMethod) continue;
        const count = section.fields.length + (section.askMethod ? 1 : 0);
        const things = count === 1 ? "1 thing" : `${count} things`;
        const choice = await ui.select(`${section.label} needs ${things}`, [
            "Answer these",
            "Skip this section",
            "Cancel setup",
        ]);
        if (choice === undefined || choice === "Cancel setup") return cancel(ui);
        if (choice === "Skip this section") continue;
        if ((await askSection(state, ui, plan, section, draft, changes, found)) === "cancel") return cancel(ui);
    }
    const menu = await pluginMenu(state, planState, ui, plan, draft, changes, found);
    if (menu === "cancel") return cancel(ui);
    return finish(ui, plan, changes, apply, state.now);
}

/** The intro line for a login the list names: the person runs it, setup never does. When the program is missing, the line
 *  says so and setup carries on, so a machine without it can still be set up. */
function loginLine(login: { label: string; tool: string; command: string; why?: string }, installed: boolean): string {
    const line = installed
        ? `${login.label}: run \`${login.command}\` in another terminal.`
        : `${login.label}: ${login.tool} is not installed; install it, then run \`${login.command}\` in another terminal.`;
    return `${line}${login.why === undefined ? "" : ` ${login.why}`}`;
}

/** Whether a login's program is on PATH now: a lookup, so setup never starts it. */
function programPresent(state: SetupState, tool: string): boolean {
    return state.pathLookup(tool, state.env) !== undefined;
}

/** One section's questions: its fields, then its sign-in method and that method's fields. */
async function askSection(
    state: JigState,
    ui: SetupUi,
    plan: SetupPlan,
    section: SetupSection,
    draft: Record<string, unknown>,
    changes: SetupChange[],
    found: (field: SetupField) => string | undefined,
): Promise<"ok" | "cancel"> {
    const required = section.fields.filter((field) => field.optional !== true);
    const optional = section.fields.filter((field) => field.optional === true);
    for (const field of required) {
        if ((await ask(state, plan, field, draft, changes, ui, found)) === "cancel") return "cancel";
    }
    if ((await askMethods(state, plan, section, draft, changes, ui, found)) === "cancel") return "cancel";
    for (const field of optional) {
        if ((await ask(state, plan, field, draft, changes, ui, found)) === "cancel") return "cancel";
    }
    return "ok";
}

/** The plugin list: a plugin's questions, a plugin waiting for its questions, or one that needs nothing. Done saves. */
async function pluginMenu(
    state: JigState,
    planState: SetupState,
    ui: SetupUi,
    plan: SetupPlan,
    draft: Record<string, unknown>,
    changes: SetupChange[],
    found: (field: SetupField) => string | undefined,
): Promise<"ok" | "cancel"> {
    for (;;) {
        const lines = pluginLines(planState, draft);
        const options = [...lines.map((line) => line.text), DONE_LINE];
        const choice = await ui.select(listTitle(settingCount(changes)), options);
        if (choice === undefined) {
            // Ctrl+C or Esc at the list: answers not yet saved are offered for saving, never thrown away unasked.
            if (changes.length === 0) return "cancel";
            // Yes is the default: this is the way out of a person who wants out but not to lose their answers, and the
            // review that follows still lets them cancel. Only an explicit no (or a second Ctrl+C) discards.
            const keep = await ui.confirm(
                `Save the ${changeCount(settingCount(changes))} you made?`,
                "Yes goes to the review, where you can still cancel. No writes nothing.",
                { defaultYes: true },
            );
            return keep ? "ok" : "cancel";
        }
        if (!options.includes(choice)) return "cancel";
        if (choice === DONE_LINE) return "ok";
        const line = lines.find((one) => one.text === choice);
        if (line === undefined) return "cancel";
        const setup = planState.sectionSetup?.get(line.section);
        if (setup === undefined) continue;
        if (setup.pending !== undefined) {
            ui.notify(pendingLines(line.label, setup).join("\n"), "info");
            continue;
        }
        if (setup.items === undefined) {
            ui.notify(readyLines(line.label, setup).join("\n"), "info");
            continue;
        }
        for (const text of introOf(undefined, [setup.items])) ui.notify(text, "info");
        for (const login of loginsOf(undefined, [setup.items]))
            ui.notify(loginLine(login, programPresent(planState, login.tool)), "info");
        const questions = sectionQuestions(planState, line.section, draft, true);
        const section: SetupSection = {
            name: line.section,
            label: questions.label,
            fields: questions.fields,
            ...(questions.methods === undefined ? {} : { methods: questions.methods }),
            askMethod: questions.askMethod,
            notes: questions.notes,
        };
        // Ctrl+C inside a question puts this section back as it was and returns to the list, so the sections answered
        // before it are not lost; a second Ctrl+C, at the list, asks whether to keep them.
        const before = { draft: structuredClone(draft), changes: changes.length };
        if ((await askSection(state, listScreen(ui), plan, section, draft, changes, found)) === "cancel") {
            for (const key of Object.keys(draft)) delete draft[key];
            Object.assign(draft, before.draft);
            changes.length = before.changes;
            ui.notify(`${line.label} was left as it was; nothing from it is kept. Back to the list.`, "info");
            continue;
        }
        for (const note of section.notes) ui.notify(note, "info");
    }
}

/** The summary, the one confirmation, and the write. Nothing is written before the yes. */
async function finish(
    ui: SetupUi,
    plan: SetupPlan,
    changes: SetupChange[],
    apply: "terminal" | "reload",
    now: () => Date,
): Promise<number> {
    const notes = [...plan.notes, ...plan.sections.flatMap((section) => section.notes)];
    if (changes.length === 0) {
        ui.notify([...notes, "Nothing was written."].join("\n"), "info");
        return 0;
    }
    const summary = summaryLines(plan, changes);
    const confirmation = [...summary, "", "A backup is kept next to your settings file."].join("\n");
    ui.notify(summary.join("\n"), "info");
    const review = await ui.select("Review these changes", ["Save these changes", "Show the exact change", "Cancel"]);
    if (review === undefined || review === "Cancel") return cancel(ui);
    if (review === "Show the exact change") {
        ui.notify(["Only these fields change:", ...exactChangeLines(changes)].join("\n"), "info");
    }
    const ok = await ui.confirm("Save these changes?", confirmation);
    if (!ok) return cancel(ui);
    try {
        const result = writeSetup(plan, changes, now());
        const count = result.changes === 1 ? "1 change" : `${result.changes} changes`;
        const where = shorten(result.file, homedir());
        const lines = [`Saved ${count} to ${where}${plan.link ? " (through your link)" : ""}.`];
        if (result.backup !== undefined) lines.push(`Backup: ${shorten(result.backup, homedir())}`);
        lines.push(apply === "reload" ? "Run /reload to apply." : "Start Pi again, or run /reload in it, to apply.");
        ui.notify(lines.join("\n"), "info");
        return 0;
    } catch (error) {
        ui.notify(
            error instanceof SetupRefused
                ? error.message
                : `Your settings could not be saved. Nothing was written (${errorMessage(error)}).`,
            "error",
        );
        return 1;
    }
}

function cancel(ui: SetupUi): number {
    ui.notify("Nothing was written.", "info");
    return 130;
}

/** The checked part of a running jig-core, with the company's defaults gathered for `layered()`. */
export function setupStateFrom(state: JigState): SetupState {
    const backends = effectiveBackends(state.personal.config.secrets, state.company);
    const own = withTransports(state.sectionChecks, state.sectionSetup);
    return {
        personal: state.personal,
        sectionChecks: own.sectionChecks,
        defaults: effectiveDefaults(state),
        replace: state.sectionReplace,
        oneOf: state.sectionOneOf,
        union: state.sectionUnion,
        configPath: state.configPath(),
        env: state.env,
        platform: process.platform,
        pathLookup: (program, env) => findOnPath(program, env, process.platform),
        enabledBackends: backends.on,
        disabledBackends: state.personal.config.secrets.disabledBackends,
        companyBackends: backends.byCompany,
        commands: { ...state.company.secretCommands, ...state.personal.config.secrets.commands },
        onboarding: activeOnboarding(state),
        onboardingMethods: state.onboardingMethods,
        sectionSetup: own.sectionSetup,
        companyActive: state.profile.selection.plugin !== undefined,
        pluginTransports: state.transports.pluginNames(),
    };
}
