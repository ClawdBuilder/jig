// `/jig setup`: asks the setup questions inside Pi, through the same dialogs and the same writer as the terminal command.
// It is its own file so `commands.ts` stays under the line ratchet; this is the only part of `/jig` that writes.
import { existsSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { errorMessage } from "./errors.ts";
import { installMode } from "./install-mode.ts";
import { modelStatus } from "./model-auth.ts";
import { findOnPath } from "./doctor-secrets.ts";
import { jigPackage } from "./pi-version.ts";
import { companyStep } from "./setup-company.ts";
import { runSetup } from "./setup.ts";
import type { SetupUi } from "./setup.ts";
import { shorten } from "./secret-status.ts";
import { loadPersonalConfig } from "./state.ts";
import type { JigState } from "./state.ts";

/** Runs `/jig setup [section]`; it returns when the screen is finished. */
export async function runSetupCommand(
    state: JigState,
    ctx: ExtensionCommandContext,
    rest: readonly string[],
): Promise<void> {
    if (rest.length > 1) return notify(ctx, ["Usage: /jig setup [section]"]);
    const section = rest[0];
    const agent = state.agentDir();
    // Pi's dialogs are the same four calls runSetup needs; print and RPC have no screen for it. In the Jig home the `jig`
    // command asks the same questions in a terminal; in any other Pi folder there is no such command, and a setup run
    // from outside would make a second Jig, so the person opens Pi there.
    if (ctx.mode !== "tui" || ctx.hasUI !== true) {
        const lines = ["This Pi mode has no interactive setup screen."];
        if (installMode(agent) === "package") lines.push("Open Pi in a terminal and run /jig setup.");
        else {
            lines.push(
                "Run jig setup in a terminal.",
                "It asks the same questions without Pi, and writes the same file.",
            );
            if (findOnPath("jig", state.env) === undefined) lines.push("Run setup with: npx @clawdbuilder/jig setup");
        }
        return notify(ctx, lines);
    }
    const ui: SetupUi = {
        select: (title, options) => ctx.ui.select(title, options),
        input: (title, placeholder) => ctx.ui.input(title, placeholder),
        // Pi's confirm is a Yes/No list with Yes selected, so a question that defaults to yes needs nothing more here.
        confirm: (title, message) => ctx.ui.confirm(title, message),
        notify: (text, level) => ctx.ui.notify(text, level),
    };
    const file = state.configPath();
    const before = file !== "" && existsSync(file) ? readFileSync(file, "utf8") : undefined;
    const folder = file === "" ? "" : path.dirname(file);
    const prefix = file === "" ? "" : `${path.basename(file)}.`;
    const backupsBefore = new Set(
        folder === "" ? [] : readdirSync(folder).filter((name) => name.startsWith(prefix) && name.endsWith(".bak")),
    );
    let backup: string | undefined;
    const restore = (): void => {
        if (file === "") return;
        if (before === undefined) {
            if (existsSync(file)) unlinkSync(file);
        } else writeFileSync(file, before);
        loadPersonalConfig(state, file);
        if (backup === undefined && file !== "") {
            try {
                const created = readdirSync(folder)
                    .filter((name) => name.startsWith(prefix) && name.endsWith(".bak") && !backupsBefore.has(name))
                    .sort()
                    .at(-1);
                if (created !== undefined) backup = path.join(folder, created);
            } catch {
                // No folder to inspect: the message below simply names no backup.
            }
        }
    };
    try {
        const step = await companyStep(state, ui, ctx.cwd);
        backup = step.backup;
        if (step.status !== "ok") {
            restore();
            const suffix = backup === undefined ? "" : ` Backup: ${shorten(backup, homedir())}.`;
            if (step.status === "cancel")
                ui.notify(`Setup cancelled; ${shorten(file, homedir())} was restored.${suffix}`, "info");
            return;
        }
        const code = await runSetup(state, ui, section, "reload");
        const model = code === 0 ? modelStatus(agent, state.env, state.models) : undefined;
        if (model?.missing === true) ui.notify(model.line, "warning");
        if (code !== 0) {
            restore();
            const suffix = backup === undefined ? "" : ` Backup: ${shorten(backup, homedir())}.`;
            ui.notify(
                code === 130
                    ? `Setup cancelled; ${shorten(file, homedir())} was restored.${suffix}`
                    : `Setup stopped; ${shorten(file, homedir())} was restored.${suffix}`,
                code === 130 ? "info" : "error",
            );
        }
    } catch (error) {
        restore();
        const suffix = backup === undefined ? "" : ` Backup: ${shorten(backup, homedir())}.`;
        ui.notify(`Setup stopped; ${shorten(file, homedir())} was restored.${suffix} ${errorMessage(error)}`, "error");
    }
}

function notify(ctx: ExtensionCommandContext, lines: readonly string[]): void {
    if (lines.length <= 12) ctx.ui.notify(lines.join("\n"), "info");
    else void ctx.ui.select("jig setup", [...lines]);
}
