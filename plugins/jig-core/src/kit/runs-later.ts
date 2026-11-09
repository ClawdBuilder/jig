// Everything that runs later outside the sandbox: the sandbox locks it for bash, and Pi's file tools ask before writing it.
// One table, shared by both, so a path added to one is not forgotten by the other. Paths start with `~/` or are relative
// to a project. Groups say the reason; `ask` paths put a program on PATH instead, so a person may allow the write.
export interface RunsLaterPath {
    /** `~/...` in the home folder, or relative to a project folder. */
    path: string;
    group: string;
    /** Home, project, or a repository below the project. */
    scope: "home" | "project" | "repository";
    /** Ask the person instead of refusing: a toolchain or shell file a person may want to change. */
    ask?: boolean;
}

const home = (group: string, ...paths: string[]): RunsLaterPath[] =>
    paths.map((path) => ({ path, group, scope: "home" }));
const project = (group: string, ...paths: string[]): RunsLaterPath[] =>
    paths.map((path) => ({ path, group, scope: "project" }));
const repo = (group: string, ...paths: string[]): RunsLaterPath[] =>
    paths.map((path) => ({ path, group, scope: "repository" }));

export const RUNS_LATER: readonly RunsLaterPath[] = [
    ...home(
        "shell",
        "~/.bashrc",
        "~/.bash_profile",
        "~/.bash_login",
        "~/.bash_logout",
        "~/.bash_aliases",
        "~/.profile",
        "~/.zshrc",
        "~/.zshenv",
        "~/.zprofile",
        "~/.zlogin",
        "~/.zlogout",
        "~/.config/fish",
    ),
    ...home(
        "session",
        "~/.config/systemd/user",
        "~/.config/autostart",
        "~/.config/environment.d",
        "~/.xprofile",
        "~/.xinitrc",
        "~/.xsessionrc",
        "~/.tmux.conf",
        "~/.config/tmux",
    ),
    ...home("git", "~/.gitconfig", "~/.config/git"),
    ...home("agents", "~/.agents", "~/.claude/settings.json", "~/.claude/settings.local.json"),
    ...home(
        "build",
        "~/.gradle/init.gradle",
        "~/.gradle/init.gradle.kts",
        "~/.gradle/init.d",
        "~/.m2/extensions.xml",
        "~/.cargo/config.toml",
        "~/.cargo/config",
        "~/.config/pip/pip.conf",
        "~/.pip/pip.conf",
    ),
    ...home("path", "~/.local/bin", "~/.npm-global/bin"),
    ...home(
        "toolchain",
        "~/.sdkman",
        "~/.nvm",
        "~/.pyenv",
        "~/.rbenv",
        "~/.rustup",
        "~/.cargo/bin",
        "~/.asdf",
        "~/.local/share/mise",
        "~/.volta",
        "~/.bun",
        "~/.deno",
        "~/go/bin",
    ).map((item) => ({ ...item, ask: true })),
    ...home("session", "~/Library/LaunchAgents").map((item) => ({ ...item })),
    ...repo("agents", ".claude/settings.json", ".claude/settings.local.json"),
    ...repo("build", ".mvn/extensions.xml", ".mvn/jvm.config"),
    ...repo("ide", ".vscode/tasks.json", ".vscode/settings.json", ".idea/workspace.xml", ".idea/runConfigurations"),
    ...repo("git", ".git/config"),
    ...repo("hooks", ".git/hooks"),
    ...project("shell", ".envrc"),
];

/** The paths of one scope, with `~` expanded to the home folder; project paths are joined under each folder given. */
export function runsLaterPaths(
    scope: RunsLaterPath["scope"],
    options: { home: string; folders: readonly string[]; platform?: NodeJS.Platform },
): RunsLaterPath[] {
    const separator = (options.platform ?? process.platform) === "win32" ? "\\" : "/";
    const result: RunsLaterPath[] = [];
    for (const item of RUNS_LATER) {
        if (item.scope !== scope) continue;
        const bases = scope === "home" ? [""] : options.folders;
        for (const base of bases) {
            if (scope === "home") {
                result.push({ ...item, path: item.path.replace(/^~\//, `${options.home}${separator}`) });
            } else {
                result.push({ ...item, path: `${base}${separator}${item.path.split("/").join(separator)}` });
            }
        }
    }
    return result;
}

/** Whether a repository-relative path is one of the repository-scope list. */
export function isRepositoryRunsLater(relative: string): boolean {
    // Folded on every platform, as the file tools do: an over-ask on Linux is safer than .PI on macOS or Windows.
    const normalized = relative.split("\\").join("/").toLowerCase();
    return RUNS_LATER.some(
        (item) =>
            item.scope === "repository" &&
            (normalized === item.path.toLowerCase() ||
                normalized.startsWith(`${item.path.toLowerCase()}/`) ||
                normalized.includes(`/${item.path.toLowerCase()}/`)),
    );
}
