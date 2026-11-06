// The tool checks of `/jig doctor`: the login tools, the sandbox and the records folder. Each starts a program only to
// ask a login tool for its status; none signs in, and none writes.
import { fork } from "node:child_process";
import { accessSync, constants, existsSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import type { DoctorContext, DoctorLine, DoctorOptions } from "./doctor.ts";
import { findOnPath, sectionTexts } from "./doctor-secrets.ts";
import { run as runProgram } from "./exec.ts";
import { shorten } from "./secret-status.ts";
import { APPARMOR_SYSCTL, distroOf, findPrograms, installCommand } from "./kit/sandbox-programs.ts";
import type { ProgramPaths } from "./kit/sandbox-programs.ts";

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

export async function sandboxChecks(context: DoctorContext, options: DoctorOptions): Promise<DoctorLine[]> {
    const platform = options.platform ?? process.platform;
    const provider = context.sandbox;
    if (provider === undefined) {
        if (context.filtered?.sandbox !== undefined) return [];
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
    if (!provider.active && context.standalone === true) return await sandboxHostChecks(context, options);
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
                    level: "ok",
                    title: "Records",
                    detail: `${shown} will be made on first use.`,
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

/** Starts the broker for real and waits for its ready event, or says why it could not. */
async function brokerStart(script: string): Promise<string | undefined> {
    if (!existsSync(script)) return `the broker script is not there: ${script}`;
    return await new Promise((resolve) => {
        const child = fork(script, [], {
            stdio: ["ignore", "ignore", "pipe", "ipc"],
            execArgv: [],
            serialization: "json",
        });
        let said = "";
        child.stderr?.setEncoding("utf8");
        child.stderr?.on("data", (text: string) => (said += text));
        const timer = setTimeout(() => {
            child.kill();
            resolve(`the broker did not say ready in 5 s${said === "" ? "" : `: ${said.slice(-200)}`}`);
        }, 5_000);
        child.on("message", (message: unknown) => {
            if (typeof message === "object" && message !== null && (message as { event?: unknown }).event === "ready") {
                clearTimeout(timer);
                child.kill();
                resolve(undefined);
            }
        });
        child.on("error", (error) => {
            clearTimeout(timer);
            resolve(`the broker could not start: ${error.message}`);
        });
        child.on("exit", (code) => {
            clearTimeout(timer);
            resolve(`the broker exited at start (${code ?? "signal"})${said === "" ? "" : `: ${said.slice(-200)}`}`);
        });
    });
}

/** What the sandbox needs on this machine, checked for real: programs, then a new user namespace on Linux/WSL. */
async function sandboxHostChecks(context: DoctorContext, options: DoctorOptions): Promise<DoctorLine[]> {
    const platform = options.platform ?? process.platform;
    if (platform === "darwin") {
        return [
            {
                id: "sandbox.programs",
                group: "sandbox",
                level: "ok",
                title: "Sandbox",
                detail: "the sandbox is part of macOS; nothing to install.",
            },
        ];
    }
    if (platform !== "linux") {
        return [
            {
                id: "sandbox.programs",
                group: "sandbox",
                level: "fail",
                title: "Sandbox",
                detail: `${platform} is not supported yet; Linux, WSL2 and macOS are.`,
            },
        ];
    }
    const section = context.sections.get("sandbox") as { programs?: ProgramPaths } | undefined;
    const settings = section?.programs ?? {};
    const osRelease = (() => {
        try {
            return readFileSync("/etc/os-release", "utf8");
        } catch {
            return "";
        }
    })();
    const distro = distroOf(osRelease);
    const writable = (place: string): boolean => {
        try {
            accessSync(place, constants.W_OK);
            return true;
        } catch {
            return false;
        }
    };
    const lines: DoctorLine[] = [];
    if (context.sections.has("sandbox")) {
        const script =
            options.brokerScript ??
            fileURLToPath(new URL("../../../plugins/jig-sandbox/broker/broker.mjs", import.meta.url));
        const problem = await brokerStart(script);
        lines.push(
            problem === undefined
                ? {
                      id: "sandbox.broker",
                      group: "sandbox",
                      level: "ok",
                      title: "Sandbox broker",
                      detail: "the broker started and said it was ready.",
                  }
                : {
                      id: "sandbox.broker",
                      group: "sandbox",
                      level: "fail",
                      title: "Sandbox broker",
                      detail: `${problem}; every bash command would be refused.`,
                      fix: "Reinstall Jig; the broker is part of the package.",
                  },
        );
    }
    const found = findPrograms("linux", settings, context.env.PATH, writable);
    for (const missing of found.missing) {
        lines.push({
            id: `sandbox.program.${missing.name}`,
            group: "sandbox",
            level: "fail",
            title: `Sandbox program ${missing.command}`,
            detail: `${missing.command} is not found; the sandbox cannot start without it, and bash would be refused.`,
            fix: installCommand("linux", [{ name: missing.name }], distro),
        });
    }
    if (found.missing.length === 0) {
        lines.push({
            id: "sandbox.programs",
            group: "sandbox",
            level: "ok",
            title: "Sandbox programs",
            detail: "bwrap, socat and rg are found.",
        });
    }
    const bwrap = found.found.bwrap;
    if (bwrap === undefined) return lines;
    const run = options.run ?? runProgram;
    const result = await run(bwrap, ["--unshare-user", "--ro-bind", "/", "/", "--", "/bin/true"], { timeoutMs: 5_000 });
    if (result.code === 0) {
        lines.push({
            id: "sandbox.start",
            group: "sandbox",
            level: "ok",
            title: "Sandbox start",
            detail: "a real command ran in a new user namespace.",
        });
        return lines;
    }
    const said = (result.stderr || result.stdout).trim().split("\n")[0] ?? "";
    const sysctl = /namespace|apparmor|permission denied|operation not permitted/i.test(said);
    lines.push({
        id: "sandbox.start",
        group: "sandbox",
        level: "fail",
        title: "Sandbox start",
        detail: `bwrap could not make a user namespace${said === "" ? "." : `: ${said.slice(0, 200)}`}`,
        fix: sysctl ? APPARMOR_SYSCTL : "Run /sandbox doctor in Pi for the full check.",
    });
    return lines;
}
