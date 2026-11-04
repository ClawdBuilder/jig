// The tool checks of `/jig doctor`: the login tools, the sandbox and the records folder. Each starts a program only to
// ask a login tool for its status; none signs in, and none writes.
import { accessSync, constants, statSync } from "node:fs";
import { homedir } from "node:os";
import type { DoctorContext, DoctorLine, DoctorOptions } from "./doctor.ts";
import { findOnPath, sectionTexts } from "./doctor-secrets.ts";
import { run as runProgram } from "./exec.ts";
import { shorten } from "./secret-status.ts";

export async function loginChecks(context: DoctorContext, options: DoctorOptions): Promise<DoctorLine[]> {
    const texts = sectionTexts(context).map((text) => text.toLowerCase());
    const lookup =
        options.pathLookup ?? ((program: string, env: NodeJS.ProcessEnv) => findOnPath(program, env, options.platform));
    const lines: DoctorLine[] = [];
    const checks: Array<{
        tool: string;
        word: string;
        args: string[];
        login: string;
        label: string;
        why?: string;
        needed?: boolean;
    }> = [
        {
            tool: "gh",
            word: "github",
            args: ["auth", "status", "--no-refresh"],
            login: "gh auth login",
            label: "GitHub login",
        },
        { tool: "glab", word: "gitlab", args: ["auth", "status"], login: "glab auth login", label: "GitLab login" },
    ];
    for (const item of context.onboarding?.items ?? []) {
        if (item.kind !== "login" || checks.some((check) => check.tool === item.tool)) continue;
        checks.push({
            tool: item.tool,
            word: item.label.toLowerCase(),
            args: [...item.status],
            login: item.login,
            label: item.label,
            needed: true,
            ...(item.why === undefined ? {} : { why: item.why }),
        });
    }
    for (const check of checks) {
        const used =
            check.needed === true ||
            Object.hasOwn(context.commands, check.tool) ||
            texts.some((text) => text.includes(check.word));
        if (!used) {
            lines.push({
                id: `logins.${check.tool}`,
                group: "logins",
                level: "skip",
                title: check.label,
                detail: "not needed by your settings.",
            });
            continue;
        }
        if (lookup(check.tool, context.env) === undefined) {
            lines.push({
                id: `logins.${check.tool}`,
                group: "logins",
                level: "fail",
                title: check.label,
                detail: `${check.tool} is not installed, but your settings use ${check.word}.`,
                fix: `Install ${check.tool}, then run ${check.login}.`,
            });
            continue;
        }
        try {
            const result = await (options.run ?? runProgram)(check.tool, check.args, {
                timeoutMs: options.timeoutMs ?? 5000,
                maxOutputBytes: 8192,
                ...(context.workingDir === "" ? {} : { cwd: context.workingDir }),
            });
            if (result.timedOut) {
                lines.push({
                    id: `logins.${check.tool}`,
                    group: "logins",
                    level: "warn",
                    title: check.label,
                    detail: "the check took too long.",
                    fix: `Run ${check.tool} auth status in a terminal.`,
                });
            } else if (result.code === 0) {
                lines.push({
                    id: `logins.${check.tool}`,
                    group: "logins",
                    level: "ok",
                    title: check.label,
                    detail: check.why === undefined ? "signed in." : `signed in. ${check.why}`,
                });
            } else {
                lines.push({
                    id: `logins.${check.tool}`,
                    group: "logins",
                    level: "warn",
                    title: check.label,
                    detail: "not signed in.",
                    fix: check.login,
                });
            }
        } catch {
            lines.push({
                id: `logins.${check.tool}`,
                group: "logins",
                level: "warn",
                title: check.label,
                detail: "could not be checked.",
                fix: `Run ${check.tool} auth status in a terminal.`,
            });
        }
    }
    return lines;
}

export function sandboxChecks(context: DoctorContext, options: DoctorOptions): DoctorLine[] {
    const platform = options.platform ?? process.platform;
    const provider = context.sandbox;
    if (provider === undefined) {
        return [
            {
                id: "sandbox.provider",
                group: "sandbox",
                level: "warn",
                title: "Sandbox",
                detail: "bash is not sandboxed; a shell command can read your credentials.",
                fix: "Install jig-sandbox, or run Pi inside a container.",
            },
        ];
    }
    if (!provider.active) {
        return [
            {
                id: "sandbox.provider",
                group: "sandbox",
                level: "fail",
                title: "Sandbox",
                detail: provider.note ?? "the sandbox is installed but not running.",
                fix: "Run /sandbox doctor.",
            },
        ];
    }
    const lines: DoctorLine[] = [
        {
            id: "sandbox.provider",
            group: "sandbox",
            level: "ok",
            title: "Sandbox",
            detail: `bash is sandboxed${provider.mode === undefined ? "" : `, network ${provider.mode}`}.`,
        },
    ];
    if (platform === "darwin") {
        lines.push({
            id: "sandbox.programs",
            group: "sandbox",
            level: "skip",
            title: "Sandbox programs",
            detail: "the sandbox is part of macOS.",
        });
        return lines;
    }
    if (platform !== "linux") {
        lines.push({
            id: "sandbox.programs",
            group: "sandbox",
            level: "skip",
            title: "Sandbox programs",
            detail: "the sandbox is not available on this system.",
        });
        return lines;
    }
    const lookup =
        options.pathLookup ?? ((program: string, env: NodeJS.ProcessEnv) => findOnPath(program, env, platform));
    const missing = ["bwrap", "socat", "rg"].filter((program) => lookup(program, context.env) === undefined);
    lines.push(
        missing.length === 0
            ? {
                  id: "sandbox.programs",
                  group: "sandbox",
                  level: "ok",
                  title: "Sandbox programs",
                  detail: "bwrap, socat and rg were found.",
              }
            : {
                  id: "sandbox.programs",
                  group: "sandbox",
                  level: "fail",
                  title: "Sandbox programs",
                  detail: `missing: ${missing.join(", ")}.`,
                  fix: "sudo apt install bubblewrap socat ripgrep",
              },
    );
    return lines;
}

export function recordsChecks(context: DoctorContext, options: DoctorOptions): DoctorLine[] {
    const home = options.home ?? homedir();
    const shown = shorten(context.stateDir, home);
    if (context.recordsProblem !== undefined) {
        return [
            {
                id: "records.writable",
                group: "records",
                level: "fail",
                title: "Records",
                detail: context.recordsProblem,
                fix: `Make ${shown} writable for your user.`,
            },
        ];
    }
    try {
        const info = statSync(context.stateDir);
        if (!info.isDirectory()) {
            return [
                {
                    id: "records.writable",
                    group: "records",
                    level: "fail",
                    title: "Records",
                    detail: `${shown} is not a folder.`,
                    fix: `Move it aside, or set JIG_STATE_DIR to another folder.`,
                },
            ];
        }
        accessSync(context.stateDir, constants.W_OK);
        return [
            {
                id: "records.writable",
                group: "records",
                level: "ok",
                title: "Records",
                detail: `${shown} is writable.`,
            },
        ];
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") {
            return [
                {
                    id: "records.writable",
                    group: "records",
                    level: "warn",
                    title: "Records",
                    detail: `${shown} does not exist yet; it is made on first use.`,
                },
            ];
        }
        return [
            {
                id: "records.writable",
                group: "records",
                level: "fail",
                title: "Records",
                detail: `${shown} cannot be written.`,
                fix: `Make it writable for your user, or set JIG_STATE_DIR to another folder.`,
            },
        ];
    }
}
