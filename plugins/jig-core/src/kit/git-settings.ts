// Git settings that make git run a program or redirect a remote, in one table, because two places decide it: jig-core
// refuses a repository whose own configuration sets one before Jig's git runs, and jig-sandbox takes a newly set one out of
// a project's configuration after a command in the sandbox. There were two copies of this list, and they had drifted: one
// knew about shell aliases and the other did not, and keys added to one were missing from the other. A setting here is one
// git would execute with the user's credentials, so the two views must not differ.

/** Keys without a subsection (`core.sshcommand`), in lower case. Their value is not looked at. */
const PLAIN = new Set([
    "core.sshcommand",
    "core.pager",
    "core.editor",
    "core.askpass",
    "core.hookspath",
    "core.gitproxy",
    "credential.helper",
    "diff.external",
    "protocol.allow",
    "uploadpack.packobjectshook",
    "gpg.program",
    "sequence.editor",
    "include.path",
    // Fetch may run an automatic gc, and automatic gc runs this with the shell.
    "gc.recentobjectshook",
    // Listing the tips of a local alternate runs this with the shell.
    "core.alternaterefscommand",
]);

/** Keys that are dangerous under any subsection (`filter.<name>.clean`), by section. */
const SUBSECTION: ReadonlyMap<string, ReadonlySet<string>> = new Map([
    ["credential", new Set(["helper"])],
    ["filter", new Set(["clean", "smudge", "process"])],
    ["diff", new Set(["textconv", "command"])],
    ["merge", new Set(["driver"])],
    ["url", new Set(["insteadof", "pushinsteadof"])],
    ["protocol", new Set(["allow"])],
    ["gpg", new Set(["program", "defaultkeycommand"])],
    ["includeif", new Set(["path"])],
    // For a local-path or file:// remote, git runs the named program on this machine on fetch or push.
    ["remote", new Set(["uploadpack", "receivepack"])],
]);

/** Git's boolean false: `false`, `no`, `off`, `0` or an empty value. A bare key (no `=`) is true. */
function isFalse(value: string | undefined): boolean {
    if (value === undefined) return false;
    const text = value.trim().toLowerCase();
    return text === "" || text === "false" || text === "no" || text === "off" || /^[+-]?0+$/.test(text);
}

/**
 * Whether git would run a program or redirect a remote because of this setting. `name` is the setting's full name as git
 * writes it (`core.sshcommand`, `credential.https://github.com.helper`), and case does not matter, as in git.
 */
export function isDangerousGitSetting(name: string, value?: string): boolean {
    const lower = name.toLowerCase();
    const first = lower.indexOf(".");
    const last = lower.lastIndexOf(".");
    if (first < 0) return false;
    const section = lower.slice(0, first);
    // An alias that starts with `!` runs a shell command, so a repository's own configuration is not a place for one.
    if (section === "alias") return (value ?? "").trimStart().startsWith("!");
    // `submodule.<name>.update` runs a command only when its value starts with `!`; a checkout or a rebase is safe.
    if (section === "submodule" && lower.endsWith(".update")) return (value ?? "").trimStart().startsWith("!");
    if (first === last) {
        // `core.fsmonitor=false` is the safe setting, and the one Jig's own git calls set.
        if (lower === "core.fsmonitor") return !isFalse(value);
        return PLAIN.has(lower);
    }
    return SUBSECTION.get(section)?.has(lower.slice(last + 1)) === true;
}
