// Choosing the version `jig update` moves to: the newest stable release, a `--to` version, and the highest version every
// installed company package's `jig.range` allows. Ranges are the small comparator set a company states, not a general
// semver implementation: a range this cannot read is refused rather than guessed.
import { compareVersions } from "./pi-version.ts";

export interface RegistryRelease {
    version?: string;
    deprecated?: string;
    /** The Pi versions this Jig release states. */
    jig?: { agents?: { pi?: { minimum?: unknown; tested?: unknown } } };
}

export interface RegistryMetadata {
    versions?: Record<string, RegistryRelease>;
}

export interface CompanyRange {
    package: string;
    range: string;
}

export type RangeCheck = (version: string) => boolean;

export interface SelectedTarget {
    version: string;
    release: RegistryRelease;
    /** The newest stable release, before the company cap. */
    newest: string;
    /** The company packages that held the target back, and their ranges. */
    cappedBy: CompanyRange[];
}

/** Every stable version in the registry, highest first. A prerelease is never a target. */
export function stableVersions(metadata: RegistryMetadata): string[] {
    const versions = Object.keys(metadata.versions ?? {});
    return versions.filter((version) => /^\d+\.\d+\.\d+$/.test(version)).sort((a, b) => compareVersions(b, a));
}

/** The parsed range, or undefined when it uses syntax this does not read. `>=0.4.1 <0.5.0` and `^0.4.1` are enough. */
export function parseRange(text: string): RangeCheck | undefined {
    const trimmed = text.trim();
    if (trimmed === "" || trimmed === "*") return () => true;
    const alternatives = trimmed.split("||").map((part) => part.trim());
    const checks: RangeCheck[] = [];
    for (const alternative of alternatives) {
        if (alternative === "") return undefined;
        const tokens = alternative.split(/\s+/);
        const parts: Array<(version: string) => boolean> = [];
        for (const token of tokens) {
            const match = /^(>=|<=|>|<|=|\^|~)?v?(\d+)\.(\d+)\.(\d+)$/.exec(token);
            if (match === null) return undefined;
            const operator = match[1] ?? "=";
            const version = `${match[2]}.${match[3]}.${match[4]}`;
            if (operator === ">=") parts.push((candidate) => compareVersions(candidate, version) >= 0);
            else if (operator === ">") parts.push((candidate) => compareVersions(candidate, version) > 0);
            else if (operator === "<=") parts.push((candidate) => compareVersions(candidate, version) <= 0);
            else if (operator === "<") parts.push((candidate) => compareVersions(candidate, version) < 0);
            else if (operator === "=") parts.push((candidate) => compareVersions(candidate, version) === 0);
            else if (operator === "^") {
                const [major = 0, minor = 0, patch = 0] = version.split(".").map(Number);
                const upper = major > 0 ? `${major + 1}.0.0` : minor > 0 ? `0.${minor + 1}.0` : `0.0.${patch + 1}`;
                parts.push(
                    (candidate) => compareVersions(candidate, version) >= 0 && compareVersions(candidate, upper) < 0,
                );
            } else {
                const [major = 0, minor = 0] = version.split(".").map(Number);
                parts.push(
                    (candidate) =>
                        compareVersions(candidate, version) >= 0 &&
                        compareVersions(candidate, `${major}.${minor + 1}.0`) < 0,
                );
            }
        }
        if (parts.length === 0) return undefined;
        checks.push((version) => parts.every((check) => check(version)));
    }
    return (version) => checks.some((check) => check(version));
}

/** The target the registry offers, inside every company range. */
export function selectTarget(
    metadata: RegistryMetadata,
    company: readonly CompanyRange[],
    requested?: string,
): { target: SelectedTarget } | { problem: string } {
    const versions = stableVersions(metadata);
    if (versions.length === 0) return { problem: "The registry lists no stable Jig release." };
    const newest = versions[0] as string;
    const parsed: Array<{ company: CompanyRange; check: RangeCheck }> = [];
    for (const entry of company) {
        const check = parseRange(entry.range);
        if (check === undefined) {
            return { problem: `${entry.package} states a Jig range this cannot read: ${entry.range}` };
        }
        parsed.push({ company: entry, check });
    }
    const allowed = (version: string) => parsed.every((entry) => entry.check(version));
    if (requested !== undefined) {
        if (!/^\d+\.\d+\.\d+$/.test(requested)) return { problem: "Choose a stable version such as 0.5.0." };
        if (!versions.includes(requested)) return { problem: `Jig ${requested} is not published.` };
        if (!allowed(requested)) {
            const holders = parsed.filter((entry) => !entry.check(requested)).map((entry) => entry.company.package);
            return { problem: `Jig ${requested} is outside the company range set by ${holders.join(", ")}.` };
        }
        const release = metadata.versions?.[requested];
        if (release === undefined) return { problem: `Jig ${requested} is not published.` };
        return {
            target: {
                version: requested,
                release,
                newest,
                cappedBy: parsed
                    .filter((entry) => versionHeld(requested, newest, entry.check))
                    .map((entry) => entry.company),
            },
        };
    }
    const version = versions.find((candidate) => allowed(candidate));
    if (version === undefined) {
        return { problem: "No Jig release fits every company range." };
    }
    const release = metadata.versions?.[version];
    if (release === undefined) return { problem: `Jig ${version} is not published.` };
    return {
        target: {
            version,
            release,
            newest,
            cappedBy:
                version === newest
                    ? []
                    : parsed.filter((entry) => versionHeld(version, newest, entry.check)).map((entry) => entry.company),
        },
    };
}

/** Whether a company range is why `version` is not `newest`: it allows the candidate but not the newest. */
function versionHeld(version: string, newest: string, check: RangeCheck): boolean {
    return version !== newest && check(version) && !check(newest);
}
