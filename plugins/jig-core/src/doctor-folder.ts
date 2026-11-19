// The doctor's row for the folder Pi runs with, and the words for who chose it: "from JIG_HOME", "from
// PI_CODING_AGENT_DIR", "the default home" or "the default folder". The `jig` command checks the Jig home; inside Pi this is
// Pi's own folder, which is a Jig home or not (install-mode.ts).
import path from "node:path";
import type { DoctorContext, DoctorLine } from "./doctor.ts";
import { installMode } from "./install-mode.ts";
import { shorten } from "./secret-status.ts";

/** Who chose the folder. `home` is the person's home folder, for `~`. */
export function folderWhy(context: DoctorContext, home: string): string {
    const standalone = context.standalone === true;
    const fromEnv = (context.env.PI_CODING_AGENT_DIR ?? "").trim() !== "";
    // JIG_HOME names the folder only when the folder in use is the Jig home: a Pi folder that is not (Jig installed with
    // `pi install`) is not "from JIG_HOME", however the variable is set.
    const namedJigHome = installMode(context.agentDir) === "home" && (context.env.JIG_HOME ?? "").trim() !== "";
    // The `jig` command sets PI_CODING_AGENT_DIR from the home itself, so in the standalone doctor that variable says
    // nothing about who chose the folder: name the default home, or JIG_HOME when it named one.
    const defaultHome = path.resolve(home, ".jig");
    if (namedJigHome) return "from JIG_HOME";
    if (standalone && path.resolve(context.agentDir) === defaultHome) return "the default home";
    if (fromEnv) return "from PI_CODING_AGENT_DIR";
    return standalone ? "the default home" : "the default folder";
}

/** The row naming the folder Pi runs with: the Jig home in the `jig` command, Pi's folder inside Pi. */
export function folderRow(context: DoctorContext, home: string): DoctorLine {
    const title = context.standalone === true ? "Jig home" : "Pi's folder";
    if (context.agentDir === "") {
        return {
            id: "machine.agent",
            group: "machine",
            level: "fail",
            title,
            detail: "Jig cannot find the folder where Pi keeps its settings.",
            fix: "Restart Pi.",
        };
    }
    return {
        id: "machine.agent",
        group: "machine",
        level: "ok",
        title,
        detail: `${shorten(context.agentDir, home)}, ${folderWhy(context, home)}`,
    };
}
