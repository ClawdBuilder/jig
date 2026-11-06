// The main checks of `/jig doctor`: this machine, the configuration and the protected files. The secret checks are in
// doctor-secrets.ts and the tool checks in doctor-tools.ts. Every check returns lines and changes no setting.
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { DoctorContext, DoctorGroupId, DoctorLine, DoctorOptions } from "./doctor.ts";
import { networkChecks } from "./doctor-network.ts";
import { checkSecrets } from "./doctor-secrets.ts";
import { loginChecks, recordsChecks, sandboxChecks } from "./doctor-tools.ts";
import {
    compareVersions,
    currentPiRequirement,
    jigPackage,
    meetsMinimum,
    minimumVersion,
    npmInstall,
    piVersion,
    reinstallFix,
} from "./pi-version.ts";
import { stateDir } from "./paths.ts";
import { renamedInRules } from "./kit/action-names.ts";
import { activeOnboarding, effectiveDefaults } from "./profile-state.ts";
import { sectionState } from "./section-state.ts";
import { shorten } from "./secret-status.ts";
import type { JigState } from "./state.ts";

/** The checks, in the order the report shows their groups. */
export const DOCTOR_CHECKS: ReadonlyArray<
    readonly [DoctorGroupId, (context: DoctorContext, options: DoctorOptions) => Promise<DoctorLine[]> | DoctorLine[]]
> = [
    ["machine", machineChecks],
    ["config", configChecks],
    ["secrets", checkSecrets],
    ["logins", loginChecks],
    ["network", networkChecks],
    ["sandbox", sandboxChecks],
    ["records", recordsChecks],
];

/** The checked part of a running jig-core. */
export function doctorContext(state: JigState): DoctorContext {
    const sections = new Map<string, unknown>(effectiveDefaults(state));
    for (const [name, value] of state.personal.sections) sections.set(name, value);
    return {
        env: state.env,
        personal: state.personal,
        sectionChecks: state.sectionChecks,
        company: state.company,
        sections,
        commands: { ...state.company.secretCommands, ...state.personal.config.secrets.commands },
        protectedPaths: () => state.policy().protectedPaths,
        sandbox: state.sandbox,
        recordsProblem: state.recordsProblem,
        agentDir: state.agentDir(),
        configPath: state.configPath(),
        stateDir: stateDir(state.env),
        workingDir: state.workingDir,
        secrets: { passStoreDir: () => state.secrets.passStoreDir() },
        now: state.now,
        onboarding: activeOnboarding(state),
    };
}

function machineChecks(context: DoctorContext, options: DoctorOptions): DoctorLine[] {
    const requirement = currentPiRequirement();
    const platform = options.platform ?? process.platform;
    const home = options.home ?? homedir();
    const node = options.nodeVersion ?? process.versions.node;
    const pkg = jigPackage();
    const required = minimumVersion(pkg.node) ?? "22.19.0";
    const pi = (options.piVersion ?? piVersion)();
    const jig = options.jigVersion === null ? undefined : (options.jigVersion ?? pkg.version);
    const wsl =
        platform === "linux" && (context.env.WSL_DISTRO_NAME !== undefined || context.env.WSL_INTEROP !== undefined);
    const system = platform === "darwin" ? "macOS" : platform === "win32" ? "Windows" : wsl ? "Linux (WSL)" : "Linux";

    const lines: DoctorLine[] = [
        {
            id: "machine.node",
            group: "machine",
            level: meetsMinimum(node, required) ? "ok" : "fail",
            title: "Node.js",
            detail: `${node} (Jig needs ${required} or later)`,
            ...(meetsMinimum(node, required) ? {} : { fix: `Install Node.js ${required} or later.` }),
        },
        {
            id: "machine.pi",
            group: "machine",
            // The command itself stops when Pi is absent; here, an unreadable version says nothing about the session, so
            // it is a skip, not a problem to fix, inside Pi and outside it.
            level:
                pi === undefined
                    ? "skip"
                    : !meetsMinimum(pi, requirement.minimum) || compareVersions(pi, requirement.tested) > 0
                      ? "warn"
                      : "ok",
            title: "Pi",
            detail:
                pi === undefined
                    ? "version unknown"
                    : !meetsMinimum(pi, requirement.minimum)
                      ? `${pi} (Jig needs ${requirement.minimum} or later)`
                      : compareVersions(pi, requirement.tested) > 0
                        ? `${pi} (newer than ${requirement.tested}, the version Jig is tested with)`
                        : pi,
            ...(pi !== undefined && !meetsMinimum(pi, requirement.minimum)
                ? { fix: "Run jig update in a terminal; it installs the tested Pi." }
                : {}),
        },
        context.standalone === true && context.jigInPi === false && context.projectSkipped?.jigIncluded === true
            ? {
                  id: "machine.jig",
                  group: "machine",
                  level: "skip",
                  title: "Jig",
                  detail: `listed in this folder's Pi packages, which were ${context.projectSkipped.detail}`,
                  fix: context.projectSkipped.fix ?? "Open Pi here and choose Trust, then run jig doctor again.",
              }
            : context.standalone === true && context.jigInPi === false
              ? {
                    id: "machine.jig",
                    group: "machine",
                    level: "fail",
                    title: "Jig",
                    detail:
                        context.jigListedButMissing === undefined
                            ? "not installed in Pi yet, so Pi does not load Jig's plugins."
                            : `Pi lists it, but its files are not there: ${context.jigListedButMissing.problem}`,
                    fix: `Install it: pi install ${npmInstall(pkg.name)}`,
                }
              : {
                    id: "machine.jig",
                    group: "machine",
                    level: jig === undefined ? "warn" : "ok",
                    title: "Jig",
                    detail: jig ?? "could not be read",
                    ...(jig === undefined ? { fix: reinstallFix(options.jigRepository ?? pkg.repository) } : {}),
                },
        ...(context.standalone === true && (context.jigCopies?.length ?? 0) > 1
            ? [
                  {
                      id: "machine.jig.copies",
                      group: "machine" as const,
                      level: "warn" as const,
                      title: "Two copies of Jig",
                      detail: `Pi loads ${context.jigCopies?.length ?? 0} copies: ${(context.jigCopies ?? [])
                          .map((copy) => `${copy.version ?? "unknown version"} (${copy.source})`)
                          .join(", ")}.`,
                      fix: `Install one version: pi install ${npmInstall(pkg.name)}`,
                  },
              ]
            : context.standalone === true &&
                jig !== undefined &&
                context.jigInPiVersion !== undefined &&
                context.jigInPiVersion !== jig
              ? [
                    {
                        id: "machine.jig.copies",
                        group: "machine" as const,
                        level: "warn" as const,
                        title: "Two copies of Jig",
                        detail: `this command is ${jig}, and the copy Pi loads is ${context.jigInPiVersion}.`,
                        fix: `Install one version: pi install ${npmInstall(pkg.name)}`,
                    },
                ]
              : []),
        ...(!existsSync(
            options.rolesFolder ?? fileURLToPath(new URL("../../../plugins/jig-agents/agents", import.meta.url)),
        )
            ? [
                  {
                      id: "machine.roles",
                      group: "machine" as const,
                      level: "fail" as const,
                      title: "Agent roles",
                      detail: "the built-in roles folder is missing, so child agents lose reviewer, scout and worker.",
                      fix: "Reinstall Jig; the built-in roles are part of the package.",
                  },
              ]
            : []),
        { id: "machine.system", group: "machine", level: "ok", title: "System", detail: system },
    ];

    if (context.agentDir === "") {
        lines.push({
            id: "machine.agent",
            group: "machine",
            level: "fail",
            title: "Pi's folder",
            detail: "Jig cannot find the folder where Pi keeps its settings.",
            fix: "Restart Pi.",
        });
    } else {
        lines.push({
            id: "machine.agent",
            group: "machine",
            level: "ok",
            title: "Pi's folder",
            detail: shorten(context.agentDir, home),
        });
    }
    return lines;
}

function configChecks(context: DoctorContext, options: DoctorOptions): DoctorLine[] {
    const home = options.home ?? homedir();
    const shown = context.configPath === "" ? "" : shorten(context.configPath, home);
    const lines: DoctorLine[] = [
        {
            id: "config.file",
            group: "config",
            level: context.configPath === "" ? "fail" : "ok",
            title: "Settings file",
            detail:
                context.configPath === ""
                    ? "Pi has not told Jig where its settings are."
                    : context.personal.found
                      ? shown
                      : `none yet at ${shown}; the built-in defaults apply`,
            ...(context.configPath === "" ? { fix: "Restart Pi." } : {}),
        },
    ];

    const sections = [...context.sectionChecks.keys()].sort();
    const unreadable = context.personal.problems.some((problem) => problem.key === "(file)");
    const problems = context.personal.problems.filter((problem) => !sections.includes(problem.key));
    const MAX_PROBLEMS = 12;
    for (const [index, problem] of problems.slice(0, MAX_PROBLEMS).entries()) {
        lines.push({
            id: `config.problem.${index}`,
            group: "config",
            level: "fail",
            title: problem.key === "(file)" ? "The settings file cannot be read" : "A setting needs fixing",
            detail: problem.key === "(file)" ? problem.message : `${problem.key}: ${problem.message}`,
            fix:
                problem.source === "company"
                    ? "A company plugin gave this default; tell whoever writes it."
                    : `Fix it in ${shorten(problem.source, home)}.`,
        });
    }
    if (problems.length > MAX_PROBLEMS) {
        lines.push({
            id: "config.problems.more",
            group: "config",
            level: "skip",
            title: "More settings problems",
            detail: `${problems.length - MAX_PROBLEMS} more; /jig lists every one.`,
        });
    }

    if (unreadable) {
        lines.push({
            id: "config.sections",
            group: "config",
            level: "skip",
            title: "Plugin sections",
            detail: "Their state is unknown until the settings file can be read.",
        });
        return [...lines, ...protectedLines(context, options)];
    }

    if (context.filtered?.core !== undefined) {
        lines.push({
            id: "config.filtered.core",
            group: "config",
            level: "fail",
            title: "Jig's core is filtered out",
            detail: "Pi's settings load Jig but leave out its core, so the rules, approvals and protected paths would not run.",
            fix: `In ${context.filtered.core.settings}, remove the filter that leaves out plugins/jig-core/index.ts (or make it include that file).`,
        });
    }
    if (context.filtered?.sandbox !== undefined) {
        lines.push({
            id: "config.filtered.sandbox",
            group: "config",
            level: "fail",
            title: "Jig's sandbox is filtered out",
            detail: "Pi's settings load Jig but leave out the sandbox, so bash would run without it.",
            fix: `In ${context.filtered.sandbox.settings}, remove the filter that leaves out plugins/jig-sandbox/index.ts (or make it include that file).`,
        });
    }
    for (const feature of context.filtered?.alwaysOn ?? []) {
        lines.push({
            id: `config.filtered.always.${feature.feature}`,
            group: "config",
            level: "warn",
            title: `Jig's ${feature.feature} tools are off in Pi's settings`,
            detail: "The tools are not loaded, and their section in jig.json is kept.",
            fix: `In ${feature.settings}, remove the filter that leaves out plugins/${feature.plugin}/index.ts.`,
        });
    }
    for (const feature of context.filtered?.features ?? []) {
        lines.push({
            id: `config.filtered.${feature.feature}`,
            group: "config",
            level: "skip",
            title: `Feature ${feature.feature}`,
            detail: "off in Pi's settings; its section in jig.json is kept and comes back with it.",
        });
    }

    if (context.projectSkipped !== undefined) {
        lines.push({
            id: "config.project-trust",
            group: "config",
            level: "skip",
            title: "This folder's Pi packages",
            detail: context.projectSkipped.detail,
            fix: context.projectSkipped.fix ?? "Open Pi here and choose Trust, then run jig doctor again.",
        });
    }

    for (const [index, renamed] of renamedInRules([
        ...context.personal.config.rules,
        ...context.personal.config.classify,
    ]).entries()) {
        lines.push({
            id: `config.renamed.${index}`,
            group: "config",
            level: "warn",
            title: `Rule action ${renamed.from} is now ${renamed.to}`,
            detail:
                "A rule in your settings names the action's old, hyphenated name. It still applies through 0.4.x, and it will " +
                "stop applying in 0.5.0.",
            fix: `Change ${renamed.from} to ${renamed.to} where it appears in your Jig settings.`,
        });
    }

    const notSet: string[] = [];
    for (const name of sections) {
        const state = sectionState(context.personal, name);
        if (state === "loaded") {
            lines.push({ id: `config.section.${name}`, group: "config", level: "ok", title: name, detail: "loaded" });
        } else if (state === "company defaults incomplete") {
            const messages = context.personal.incomplete.get(name) ?? [];
            lines.push({
                id: `config.section.${name}`,
                group: "config",
                level: "warn",
                title: name,
                detail: firstMessages(messages),
                fix: `Add the missing value to ${shown}.`,
            });
        } else if (state === "not set or invalid") {
            const messages = context.personal.problems
                .filter((problem) => problem.key === name)
                .map((problem) => problem.message);
            lines.push({
                id: `config.section.${name}`,
                group: "config",
                level: "fail",
                title: name,
                detail: messages.length === 0 ? "the section did not pass its check" : firstMessages(messages),
                fix: `Fix it in ${shown}.`,
            });
        } else {
            notSet.push(name);
        }
    }
    lines.push(...onboardingLines(context, shown));

    if (notSet.length > 0) {
        lines.push({
            id: "config.sections.not-set",
            group: "config",
            level: "skip",
            title: "Not set",
            detail: `${notSet.join(", ")}; each plugin uses its defaults.`,
        });
    }
    if (sections.length === 0) {
        lines.push({
            id: "config.sections",
            group: "config",
            level: "skip",
            title: "Plugin sections",
            detail: "No plugin registered one.",
        });
    }
    return [...lines, ...protectedLines(context, options)];
}

function protectedLines(context: DoctorContext, options: DoctorOptions): DoctorLine[] {
    const home = options.home ?? homedir();
    try {
        const entries = context.protectedPaths();
        const secret = entries.filter((entry) => entry.kind === "secret").length;
        const guarded = entries.filter((entry) => entry.kind === "guarded").length;
        if (context.agentDir === "") {
            return [
                {
                    id: "config.protected",
                    group: "config",
                    level: "skip",
                    title: "Protected files",
                    detail: "Pi's folder is not known yet.",
                },
            ];
        }
        const covered = entries.some(
            (entry) =>
                entry.kind === "guarded" &&
                (entry.path === context.agentDir || context.agentDir.startsWith(`${entry.path}${path.sep}`)),
        );
        return covered
            ? [
                  {
                      id: "config.protected",
                      group: "config",
                      level: "ok",
                      title: "Protected files",
                      detail: `${secret} secret, ${guarded} guarded (Pi's folder is one).`,
                  },
              ]
            : [
                  {
                      id: "config.protected",
                      group: "config",
                      level: "fail",
                      title: "Pi's folder is not protected",
                      detail: "A file tool could change your settings and rules.",
                      fix: "Restart Pi. If this stays, report it.",
                  },
              ];
    } catch {
        return [
            {
                id: "config.protected",
                group: "config",
                level: "fail",
                title: "Protected files",
                detail: `The list could not be read${context.agentDir === "" ? "" : ` for ${shorten(context.agentDir, home)}`}.`,
                fix: "Restart Pi.",
            },
        ];
    }
}

function firstMessages(messages: readonly string[]): string {
    if (messages.length === 0) return "the check did not say what is missing.";
    const [first, ...rest] = messages;
    const more = rest.length === 0 ? "" : ` (and ${rest.length} more)`;
    return `${first}${more}`;
}

/** What the active company's onboarding list says its people must supply, for the sections that are not loaded yet. */
function onboardingLines(context: DoctorContext, settingsShown: string): DoctorLine[] {
    const entry = context.onboarding;
    if (entry === undefined) return [];
    const lines: DoctorLine[] = [];
    for (const [index, item] of entry.items.entries()) {
        if (item.kind === "info" || item.kind === "login") continue;
        const state = sectionState(context.personal, item.section);
        if (state === "loaded") continue;
        const store = item.kind === "reference" ? (item.preferredStore ?? entry.preferredStore) : undefined;
        const hint = item.kind === "reference" ? item.addHints?.[store ?? "env"] : undefined;
        lines.push({
            id: `config.need.${index}`,
            group: "config",
            level: "warn",
            title: `You need: ${item.label}`,
            detail:
                item.why ??
                `Add ${item.section}.${item.path} to ${settingsShown}, or run jig setup and it asks for it.`,
            fix: hint ?? "Run jig setup and it asks for this.",
        });
    }
    return lines;
}
