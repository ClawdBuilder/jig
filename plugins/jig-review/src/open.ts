// Opens a review link with $BROWSER (set it to a Windows opener on WSL), else xdg-open. Best effort: Pi also prints the
// link, so a failed open never blocks the review.
import { spawn } from "node:child_process";
import { browserCommand } from "../../jig-core/src/kit/browser.ts";

/** Starts `program` with `args` and forgets it. A test replaces it. */
export type SpawnDetached = (program: string, args: string[], env: NodeJS.ProcessEnv) => void;

const spawnDetached: SpawnDetached = (program, args, env) => {
    spawn(program, args, { detached: true, stdio: "ignore", env })
        .on("error", () => {})
        .unref();
};

/**
 * Opens a review link with `$BROWSER` (set it to a Windows opener on WSL) or the platform's opener, split as jig-core
 * splits it, so `BROWSER="firefox --new-window"` works here as it does there. Best effort: Pi also prints the link, so a
 * failed open never blocks the review.
 */
export function openUrl(
    url: string,
    env: NodeJS.ProcessEnv = process.env,
    launch: SpawnDetached = spawnDetached,
): Promise<void> {
    const { program, args } = browserCommand(url, env);
    try {
        launch(program, args, env);
    } catch {
        // the printed link still works
    }
    return Promise.resolve();
}
