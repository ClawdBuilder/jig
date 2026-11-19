// Where Jig runs: in a Jig home (`jig` is Pi for `~/.jig`) or as an ordinary Pi package (`pi install`, any Pi folder).
// Most messages read the same in both. The few that name a command or a folder come from here, so none of them guesses,
// and nothing a session says names a `jig` terminal command that does not exist where Jig was installed with `pi install`.
import { realpathSync } from "node:fs";
import path from "node:path";
import { jigHome } from "./cli/home.ts";
import { npmInstall } from "./pi-version.ts";

export type InstallMode = "home" | "package";

/** What a person does about a Pi older than this Jig needs. Jig never updates Pi (`jig update` leaves it alone too). */
export const UPDATE_PI = "Update Pi yourself: npm install -g @earendil-works/pi-coding-agent";

/**
 * `"home"` when `agentDir` is the Jig home (`jig`'s own folder), otherwise `"package"`; no folder at all is `"package"`.
 * The caller passes the folder it has: `state.agentDir()` in a session, the doctor context's `agentDir` in the doctor.
 * The only thing read from outside is `jigHome()`, which reads `JIG_HOME`.
 */
export function installMode(agentDir: string): InstallMode {
    return agentDir !== "" && sameFolder(agentDir, jigHome()) ? "home" : "package";
}

/** The same folder: the same resolved path, or, when both exist, the same real path (a home that is a link). */
function sameFolder(one: string, other: string): boolean {
    if (path.resolve(one) === path.resolve(other)) return true;
    try {
        return realpathSync(one) === realpathSync(other);
    } catch {
        return false;
    }
}

/** The command that installs a package: `jig install` for the home, `pi install` for an ordinary Pi folder. */
export function installCommand(mode: InstallMode, spec: string): string {
    return `${mode === "home" ? "jig" : "pi"} install ${spec}`;
}

/** The command that moves Jig to `version`: `jig update` for the home, an install of that version for a Pi folder. */
export function updateCommand(mode: InstallMode, packageName: string | undefined, version: string): string {
    return mode === "home" ? "jig update" : `pi install ${npmInstall(packageName, version)}`;
}

/** How a person signs in to a model provider: `/login` in Pi, and for the home also the terminal command. */
export function signInHint(mode: InstallMode): string {
    return mode === "home"
        ? "Type /login inside jig to choose one, or run `jig auth login <provider>` in a terminal."
        : "Type /login to choose one.";
}

/** The folder, as a line names it. */
export function folderName(mode: InstallMode): string {
    return mode === "home" ? "this Jig home" : "this Pi folder";
}
