// Where jig-api keeps what it fetches: below the state folder, in `api/`. This is jig-core's rule for the state folder, copied:
// a plugin reaches jig-core through its contract, client and kit (see its contract.ts), the state folder is not among them,
// and the rule is short.
import { chmodSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";

/** `$JIG_STATE_DIR`, else `${XDG_STATE_HOME:-~/.local/state}/jig`. A relative `XDG_STATE_HOME` is ignored, as the XDG
 *  specification says. */
export function stateDir(env: NodeJS.ProcessEnv = process.env): string {
    const chosen = env.JIG_STATE_DIR;
    if (chosen !== undefined && chosen !== "") return resolve(chosen);
    const xdg = env.XDG_STATE_HOME;
    const base = xdg !== undefined && isAbsolute(xdg) ? xdg : join(homedir(), ".local", "state");
    return join(base, "jig");
}

/** The folder of jig-api's own files below the state folder, with `parts` below it. Nothing is created. */
export function apiStateDir(...parts: string[]): string {
    return join(stateDir(), "api", ...parts);
}

/** Creates `api/` and the folders of `parts` below it, each with mode 0700 (tightened when it existed): what is kept
 *  describes the person's collections, so it is private to them. The state folder above belongs to `jig-core`, so its mode
 *  is left alone. Returns the innermost folder. */
export function makePrivateDir(...parts: string[]): string {
    let dir = join(stateDir(), "api");
    for (const part of [undefined, ...parts]) {
        if (part !== undefined) dir = join(dir, part);
        mkdirSync(dir, { recursive: true, mode: 0o700 });
        chmodSync(dir, 0o700);
    }
    return dir;
}
