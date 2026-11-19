// The words of the update notice, for each way Jig runs (install-mode.ts). In a Jig home `jig update` moves Jig, so the
// notice always says so. In an ordinary Pi folder Pi itself tells the person that a package has an update ("Package
// updates are available"), so Jig speaks only where Pi cannot: an entry pinned to one version (Pi leaves it alone and
// says nothing) and a company's cap on the version (Pi's update ignores it).
import { parseNpmSource } from "./cli/packages.ts";
import type { ListedPackage } from "./cli/packages.ts";
import { updateCommand } from "./install-mode.ts";
import type { InstallMode } from "./install-mode.ts";
import { compareVersions } from "./pi-version.ts";

/** A version Pi counts as pinned: one exact version, as `npm:@clawdbuilder/jig@0.5.10` names it. A range or a tag is not. */
const EXACT_VERSION = /^v?\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

/** The version an npm source names (`npm:@clawdbuilder/jig@0.5.10` gives `0.5.10`), or undefined when it names none. */
function namedVersion(source: string): string | undefined {
    const name = parseNpmSource(source)?.name;
    if (name === undefined) return undefined;
    const rest = source.trim().slice("npm:".length).trim().slice(name.length);
    return rest.startsWith("@") ? rest.slice(1) : undefined;
}

/** Whether a settings entry pins the package `name` to one version. Pi's own update leaves such an entry alone. */
export function isPinned(listed: readonly ListedPackage[], name: string): boolean {
    return listed.some(
        (entry) => parseNpmSource(entry.source)?.name === name && EXACT_VERSION.test(namedVersion(entry.source) ?? ""),
    );
}

/** Pi is newer than the one this Jig is tested with. */
export function piNewerNotice(mode: InstallMode, pi: string, tested: string): string {
    const head = `Pi ${pi} is newer than ${tested}, the version Jig is tested with. If something stops working,`;
    return mode === "home" ? `${head} use jig update in a terminal.` : `${head} install Pi ${tested}.`;
}

/** The running Jig is deprecated on npm. `reason` is npm's own text, already cleaned. */
export function deprecatedNotice(
    mode: InstallMode,
    packageName: string,
    current: string,
    reason: string,
    target: string,
): string {
    const head = `Jig ${current} is deprecated on npm: ${reason}.`;
    if (mode === "home") return `${head} Run jig update in a terminal now.`;
    // A version to move to; when the registry offers none newer there is no command to give.
    return compareVersions(target, current) > 0
        ? `${head} Run ${updateCommand(mode, packageName, target)} in a terminal now.`
        : head;
}

/** A newer Jig is allowed and available. In a Pi folder this is undefined while Pi's own notice says all there is to say. */
export function availableNotice(input: {
    mode: InstallMode;
    packageName: string;
    current: string;
    target: string;
    /** A company's range is why the target is not the newest release. */
    capped: boolean;
    /** The settings entry names one exact version, so Pi's update would skip it. */
    pinned: boolean;
}): string | undefined {
    const { mode, packageName, current, target } = input;
    if (mode === "package" && !input.capped && !input.pinned) return undefined;
    const allows = input.capped ? ` Your company allows up to ${target}.` : "";
    return `Jig ${target} is available (you have ${current}). Run ${updateCommand(mode, packageName, target)} in a terminal.${allows}`;
}
