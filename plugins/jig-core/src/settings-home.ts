// Where the settings folder is when no Pi says so: the folder that holds `jig.json`. The gateway and, later, the hook and the doctor
// are told where it is and search nowhere else. The first of these that gives a folder wins:
//   1. an argument `--home <folder>` in the agent's entry for the program;
//   2. the variable `JIG_HOME`;
//   3. the default Jig home (`~/.jig`), but only when it holds a `jig.json`.
// An empty value counts as not set: Claude Code passes an empty string for a value nobody set, so `--home ""` and `JIG_HOME=""` fall
// through to the next one. A named folder is used even when it holds no `jig.json` yet, so the program says so instead of guessing.
import { existsSync } from "node:fs";
import path from "node:path";
import { HOME_FOLDER } from "./cli/home.ts";
import { CONFIG_FILE_NAME } from "./paths.ts";

/** Which of the three gave the folder. */
export type SettingsSource = "argument" | "environment" | "default";

export interface SettingsHome {
    /** The folder, as an absolute path. `jig.json` is in it, or will be. */
    folder: string;
    source: SettingsSource;
}

/** The value of the first `--home <folder>` or `--home=<folder>`, or undefined when there is none. */
function argumentOf(args: readonly string[]): string | undefined {
    for (const [index, arg] of args.entries()) {
        if (arg === "--home") return args[index + 1];
        if (arg.startsWith("--home=")) return arg.slice("--home=".length);
    }
    return undefined;
}

/** A value that names a folder: not missing and not blank. */
function named(value: string | undefined): string | undefined {
    const trimmed = value?.trim();
    return trimmed === undefined || trimmed === "" ? undefined : trimmed;
}

/** The settings folder, or undefined when none of the three gives one. `home` is the person's home folder. */
export function settingsHome(args: readonly string[], env: NodeJS.ProcessEnv, home: string): SettingsHome | undefined {
    const fromArgument = named(argumentOf(args));
    if (fromArgument !== undefined) return { folder: path.resolve(fromArgument), source: "argument" };
    const fromEnvironment = named(env.JIG_HOME);
    if (fromEnvironment !== undefined) return { folder: path.resolve(fromEnvironment), source: "environment" };
    const fallback = path.join(home, HOME_FOLDER);
    return existsSync(path.join(fallback, CONFIG_FILE_NAME)) ? { folder: fallback, source: "default" } : undefined;
}
