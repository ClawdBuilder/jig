// `/jig setup`: the questions, the plain summary, and the one confirmation that writes. It is a command, never a tool,
// so the model cannot run it. Every screen is plain words; the only JSON is behind "Show the exact change".
import { homedir } from "node:os";
import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { errorMessage } from "./errors.ts";
import { effectiveDefaults } from "./profile-state.ts";
import { shorten } from "./secret-status.ts";
import { applyAnswer, buildSetupPlan } from "./setup-plan.ts";
import { exactChangeLines, SetupRefused, summaryLines, writeSetup } from "./setup-write.ts";
import type { SetupChange, SetupField, SetupPlan, SetupState } from "./setup-plan.ts";
import type { JigState } from "./state.ts";

/** Runs the whole flow. It writes nothing unless the person confirms the summary. */
export async function runSetup(state: JigState, ctx: ExtensionCommandContext): Promise<void> {
    if (!ctx.hasUI) {
        ctx.ui.notify(
            "Setup needs Pi's screen. Run /jig setup in Pi's terminal, or /jig doctor for a read-only check.",
            "warning",
        );
        return;
    }

    const built = buildSetupPlan(setupState(state));
    if ("problem" in built) {
        ctx.ui.notify(built.problem, "warning");
        return;
    }
    const plan = built.plan;
    if (plan.sections.length === 0) {
        ctx.ui.notify("Nothing needs you right now. /jig doctor has the full check.", "info");
        return;
    }
    const notes = plan.sections.flatMap((section) => section.notes);
    if (plan.sections.every((section) => section.fields.length === 0)) {
        ctx.ui.notify([...notes, "Nothing was written."].join("\n"), "info");
        return;
    }

    ctx.ui.notify("Jig setup asks only what is missing. It never asks for a password or a token.", "info");
    const draft = structuredClone(plan.raw);
    const changes: SetupChange[] = [];

    for (const section of plan.sections) {
        if (section.fields.length === 0) continue;
        const things = section.fields.length === 1 ? "1 thing" : `${section.fields.length} things`;
        const choice = await ctx.ui.select(`${section.label} needs ${things}`, [
            "Answer these",
            "Skip this section",
            "Cancel setup",
        ]);
        if (choice === undefined || choice === "Cancel setup") return cancel(ctx);
        if (choice === "Skip this section") continue;
        for (const field of section.fields) {
            if ((await ask(plan, field, draft, changes, ctx)) === "cancel") return cancel(ctx);
        }
    }

    if (changes.length === 0) {
        ctx.ui.notify([...notes, "Nothing was written."].join("\n"), "info");
        return;
    }

    const summary = summaryLines(plan, changes);
    const confirmation = [...summary, "", "A backup is kept next to your settings file."].join("\n");
    ctx.ui.notify(summary.join("\n"), "info");
    const review = await ctx.ui.select("Review these changes", [
        "Save these changes",
        "Show the exact change",
        "Cancel",
    ]);
    if (review === undefined || review === "Cancel") return cancel(ctx);
    if (review === "Show the exact change") {
        const shown = await ctx.ui.select("The exact change", [
            "Only these fields change:",
            ...exactChangeLines(changes),
        ]);
        if (shown === undefined) return cancel(ctx);
        const ok = await ctx.ui.confirm("Save these changes?", confirmation);
        if (!ok) return cancel(ctx);
    } else {
        const ok = await ctx.ui.confirm("Save these changes?", confirmation);
        if (!ok) return cancel(ctx);
    }

    try {
        const result = writeSetup(plan, changes, state.now());
        const count = result.changes === 1 ? "1 change" : `${result.changes} changes`;
        const lines = [`Saved ${count} to ${shorten(result.file, homedir())}.`];
        if (result.backup !== undefined) lines.push(`Backup: ${shorten(result.backup, homedir())}`);
        lines.push("Run /reload to apply.");
        ctx.ui.notify(lines.join("\n"), "info");
    } catch (error) {
        ctx.ui.notify(
            error instanceof SetupRefused
                ? error.message
                : `Your settings could not be saved. Nothing was written (${errorMessage(error)}).`,
            "error",
        );
    }
}

/** One question at a time; a rejection is a plain sentence, then the same question again. */
async function ask(
    plan: SetupPlan,
    field: SetupField,
    draft: Record<string, unknown>,
    changes: SetupChange[],
    ctx: ExtensionCommandContext,
): Promise<"ok" | "cancel"> {
    for (;;) {
        ctx.ui.notify(`${field.label}: ${field.reason}`, "info");
        const text = await ctx.ui.input(field.question, field.placeholder);
        if (text === undefined) return "cancel";
        const result = applyAnswer(plan, draft, field, text);
        if ("change" in result) {
            changes.push(result.change);
            return "ok";
        }
        ctx.ui.notify(result.problem, "warning");
    }
}

function cancel(ctx: ExtensionCommandContext): void {
    ctx.ui.notify("Nothing was written.", "info");
}

/** The checked part of a running jig-core, with the company's defaults gathered for `layered()`. */
function setupState(state: JigState): SetupState {
    return {
        personal: state.personal,
        sectionChecks: state.sectionChecks,
        defaults: effectiveDefaults(state),
        replace: state.sectionReplace,
        oneOf: state.sectionOneOf,
        union: state.sectionUnion,
        configPath: state.configPath(),
    };
}
