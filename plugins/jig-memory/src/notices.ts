// What jig-memory says while it works: a line on Pi's screen, the first line of an error for a notice that must stay one
// line, and the empty-files warning, which a crash or an unfinished write may have earned.
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { MEMORY_EMPTY_FILES_MESSAGE } from "../../jig-core/src/kit/jig-messages.ts";
import { emptyFilesText, findEmptyFiles } from "./empty-files.ts";
import { ticketPaths } from "./store.ts";

/** Shows a line to the person when Pi has a screen; print and RPC modes have nowhere to show it. */
export function note(ctx: ExtensionContext, text: string, level: "info" | "warning" = "info"): void {
    if (ctx.hasUI) ctx.ui.notify(text, level);
}

/** An error's first line, for a notice that must stay one line. */
export function reason(error: unknown): string {
    return (error instanceof Error ? error.message : String(error)).split("\n")[0] ?? "";
}

/** Empty files in the ticket folder, which a crash or an unfinished write may have left: the agent and the user are told.
 *  Nothing is repaired. */
export function warnEmptyFiles(pi: ExtensionAPI, ctx: ExtensionContext, folder: string, key: string): void {
    try {
        const now = new Date();
        const found = findEmptyFiles(ticketPaths(folder, key).dir, now);
        const text = emptyFilesText(key, found, now);
        if (text === undefined) return;
        pi.sendMessage(
            {
                customType: MEMORY_EMPTY_FILES_MESSAGE,
                content: text,
                display: false,
                details: { key, files: found.shown.map((entry) => entry.file), total: found.total },
            },
            { triggerTurn: false },
        );
        note(ctx, text, "warning");
    } catch (error) {
        note(ctx, `Could not look for empty files in ${key}: ${reason(error)}`, "warning");
    }
}
