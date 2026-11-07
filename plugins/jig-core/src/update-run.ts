// Running an update plan, in the one order that leaves the least broken state: Pi first if the release needs a newer one,
// then Pi's Jig copy, then the global command, then a check of both. Every step that changed something is recorded, and a
// failure puts each recorded version back before saying what happened. It runs commands; choosing and confirming happen
// before this module is called.
import { errorMessage } from "./errors.ts";
import type { UpdatePlan } from "./update-plan.ts";

export interface InstallCommand {
    command: string;
    args: string[];
    display: string;
}

export interface CommandResult {
    code: number;
    stdout: string;
    stderr: string;
    timedOut?: boolean;
}

export interface UpdateIo {
    run(command: string, args: readonly string[]): Promise<CommandResult>;
    notify(text: string, level: "info" | "warning" | "error"): void;
    confirm(title: string, message: string): Promise<boolean>;
    /** The commands that install this exact Pi version, or the plain reason they cannot be built. */
    piInstall(version: string): Promise<InstallCommand[] | { problem: string }>;
    piCopyInstall(version: string): InstallCommand;
    /** Put back the exact original source, pinned or not. */
    piCopyRestore(source: string): InstallCommand;
    globalInstall(version: string): InstallCommand;
    /** The versions both copies report after the steps. */
    verify(): Promise<{ pi?: string; piCopy?: string; global?: string }>;
    doctor(): Promise<{ code: number; output: string }>;
}

export interface UpdateResult {
    code: number;
    changed: boolean;
}

function failureText(result: CommandResult): string {
    if (result.timedOut === true) return "timed out";
    const detail = (result.stderr || result.stdout).trim().slice(0, 300);
    return detail === "" ? `exit code ${result.code}` : detail;
}

function isAborted(signal?: AbortSignal): boolean {
    return signal?.aborted === true;
}

async function runCommands(io: UpdateIo, commands: readonly InstallCommand[], signal?: AbortSignal): Promise<void> {
    for (const command of commands) {
        if (isAborted(signal)) throw new Error("Update interrupted.");
        const result = await io.run(command.command, command.args);
        if (result.code !== 0) throw new Error(`${command.display} failed: ${failureText(result)}`);
    }
}

/** Runs the plan. A `false` from the Pi question changes nothing and returns 0. Never throws. */
export async function executeUpdate(plan: UpdatePlan, io: UpdateIo, signal?: AbortSignal): Promise<UpdateResult> {
    if (!plan.changes) {
        io.notify("Both copies are already on this version; nothing was changed.", "info");
        return { code: 0, changed: false };
    }
    const undo: Array<{ label: string; commands: InstallCommand[] }> = [];
    try {
        if (isAborted(signal)) throw new Error("Update interrupted.");
        if (plan.pi !== undefined) {
            const agreed = await io.confirm(
                `Update Pi to ${plan.pi.to}?`,
                `Jig ${plan.target} needs Pi ${plan.pi.to}. If you choose No, nothing is changed.`,
            );
            if (!agreed) {
                io.notify("Nothing was changed.", "info");
                return { code: 0, changed: false };
            }
            const commands = await io.piInstall(plan.pi.to);
            if ("problem" in commands) {
                io.notify(commands.problem, "error");
                return { code: 1, changed: false };
            }
            const back = await io.piInstall(plan.pi.from);
            if ("problem" in back) {
                io.notify(`${back.problem} Nothing was changed.`, "error");
                return { code: 1, changed: false };
            }
            undo.push({ label: `Pi ${plan.pi.from}`, commands: back });
            await runCommands(io, commands, signal);
        }
        if (isAborted(signal)) throw new Error("Update interrupted.");
        if (plan.piCopy?.needed === true) {
            undo.push({
                label: `Pi's Jig copy ${plan.piCopy.from ?? "(version unknown)"}`,
                commands:
                    plan.piCopy.restoreSource === undefined
                        ? plan.piCopy.from === undefined
                            ? []
                            : [io.piCopyInstall(plan.piCopy.from)]
                        : [io.piCopyRestore(plan.piCopy.restoreSource)],
            });
            await runCommands(io, [io.piCopyInstall(plan.target)], signal);
        }
        if (isAborted(signal)) throw new Error("Update interrupted.");
        if (plan.global?.needed === true) {
            undo.push({
                label: `the jig command ${plan.global.from ?? "(version unknown)"}`,
                commands: plan.global.from === undefined ? [] : [io.globalInstall(plan.global.from)],
            });
            await runCommands(io, [io.globalInstall(plan.target)], signal);
        }

        if (isAborted(signal)) throw new Error("Update interrupted.");
        const found = await io.verify();
        const wrong = [
            plan.pi === undefined || found.pi === plan.pi.to
                ? undefined
                : `Pi reports ${found.pi ?? "no version"}, not the tested ${plan.pi.to}`,
            found.piCopy === plan.target ? undefined : `Pi's copy reports ${found.piCopy ?? "no version"}`,
            found.global === plan.target ? undefined : `the jig command reports ${found.global ?? "no version"}`,
        ].filter((entry): entry is string => entry !== undefined);
        if (wrong.length > 0) throw new Error(`the versions do not match: ${wrong.join("; ")}`);

        let doctor: Awaited<ReturnType<UpdateIo["doctor"]>>;
        try {
            doctor = await io.doctor();
        } catch (error) {
            io.notify(`Updated, but the doctor could not run: ${errorMessage(error)}`, "warning");
            doctor = { code: 0, output: "" };
        }
        if (doctor.output.trim() !== "") {
            io.notify(doctor.output.trim(), doctor.code === 0 ? "info" : "warning");
        }
        io.notify(`Updated Jig to ${plan.target}. Open Pi sessions keep the old code until restarted.`, "info");
        return { code: 0, changed: true };
    } catch (error) {
        io.notify(`Update failed: ${errorMessage(error)}`, "error");
        let restored = true;
        for (const step of undo.reverse()) {
            if (step.commands.length === 0) {
                restored = false;
                io.notify(`Could not put ${step.label} back automatically.`, "error");
                continue;
            }
            try {
                if (isAborted(signal)) {
                    restored = false;
                    io.notify(
                        `Could not put ${step.label} back automatically after the interruption; run: ${step.commands.map((command) => command.display).join(" && ")}`,
                        "error",
                    );
                    continue;
                }
                await runCommands(io, step.commands, signal);
                io.notify(`Put ${step.label} back.`, "info");
            } catch (undoError) {
                restored = false;
                io.notify(
                    `Could not put ${step.label} back: ${errorMessage(undoError)}; run: ${step.commands.map((command) => command.display).join(" && ")}`,
                    "error",
                );
            }
        }
        io.notify(
            restored
                ? "Every copy was put back to the version it had before."
                : "Some versions could not be put back; the messages above name them.",
            restored ? "info" : "error",
        );
        return { code: 1, changed: !restored };
    }
}
