// What a tree-moving git operation would change in the files that run later outside the sandbox. One resolver, used by
// the gate (before the call) and by each plan/run (before the command), from the real repository and the real refs.
import { PI_PROJECT_PATHS } from "../../jig-core/src/kit/pi-project-paths.ts";
import { isRepositoryRunsLater } from "../../jig-core/src/kit/runs-later.ts";
import type { GitSettings } from "./config.ts";
import { git, gitOut } from "./run.ts";

export interface GuardTarget {
    root: string;
    /** HEAD before the operation. */
    from: string;
    /** The commits the operation would bring in, each with what the question says it is. */
    targets: Array<{ sha: string; label: string }>;
}

/** Whether a repository-relative path is one the file tools guard and that runs later. */
export function guardedRelative(path: string): boolean {
    // Fold case on every platform: over-asking on Linux is safe, and macOS/Windows would otherwise let .PI through.
    const normalized = path.split("\\").join("/").toLowerCase();
    const named = (relative: string): boolean => {
        const name = relative.toLowerCase();
        return (
            normalized === name ||
            normalized.startsWith(`${name}/`) ||
            normalized.includes(`/${name}/`) ||
            normalized.endsWith(`/${name}`)
        );
    };
    // The working tree's own .git/config is the file-tools-only exception; a nested repository's is still guarded.
    if (normalized === ".git/config") return false;
    for (const item of PI_PROJECT_PATHS) if (named(item)) return true;
    return isRepositoryRunsLater(normalized) || named(".envrc");
}

async function sha(root: string, ref: string, signal?: AbortSignal): Promise<string | undefined> {
    const out = await git(root, ["rev-parse", "--verify", `${ref}^{commit}`], { signal });
    return out.code === 0 ? out.stdout.trim() : undefined;
}

/** The HEAD sha, or an empty string for a repository with no commit yet. */
export async function headSha(root: string, signal?: AbortSignal): Promise<string> {
    return (await sha(root, "HEAD", signal)) ?? "";
}

/** The files in `from..to` that guardedRelative names. */
export async function guardedChanges(root: string, from: string, to: string, signal?: AbortSignal): Promise<string[]> {
    if (from === "" || to === "" || from === to) return [];
    const out = await git(root, ["diff", "--name-only", "-z", from, to], { signal });
    if (out.code !== 0) throw new Error(`could not read the change between ${from.slice(0, 7)} and ${to.slice(0, 7)}`);
    return out.stdout.split("\u0000").filter((name) => name !== "" && guardedRelative(name));
}

/** The guarded files a stash would restore: tracked, index, and the untracked third parent. */
export async function guardedStashChanges(root: string, stash: string, signal?: AbortSignal): Promise<string[]> {
    const parents = (await gitOut(root, ["rev-list", "--parents", "-n", "1", stash], { signal }))
        .trim()
        .split(/\s+/)
        .slice(1);
    const files = new Set<string>();
    for (const parent of parents) {
        for (const name of await guardedChanges(root, parent, stash, signal)) files.add(name);
    }
    if (parents[2] !== undefined) {
        const out = await git(root, ["ls-tree", "-r", "--name-only", "-z", parents[2] ?? ""], { signal });
        if (out.code === 0)
            for (const name of out.stdout.split("\u0000")) if (name !== "" && guardedRelative(name)) files.add(name);
    }
    return [...files];
}

/** The default base branch the mirror tools use: the section's, else origin's default, else main. */
export async function baseOf(root: string, settings: GitSettings, signal?: AbortSignal): Promise<string> {
    if (settings.base !== undefined && settings.base !== "") return settings.base;
    const head = await gitOut(root, ["symbolic-ref", "--short", "refs/remotes/origin/HEAD"], { signal }).catch(
        () => "",
    );
    const name = head.trim().replace(/^origin\//, "");
    return name === "" ? "main" : name;
}

/** Split a base against the repository's real remote names, longest first. */
async function splitBase(
    root: string,
    base: string,
    signal?: AbortSignal,
): Promise<{ remote: string; branch: string }> {
    const remotes = (await gitOut(root, ["remote"], { signal }))
        .split("\n")
        .map((name) => name.trim())
        .filter((name) => name !== "")
        .sort((left, right) => right.length - left.length);
    for (const remote of remotes) {
        if (base.startsWith(`${remote}/`) && base.length > remote.length + 1) {
            return { remote, branch: base.slice(remote.length + 1) };
        }
    }
    return { remote: "origin", branch: base };
}

/**
 * The real repository and the commits a tree-moving action would apply. `undefined` for an action that does not change
 * the working tree, or when a target does not exist locally yet (the gate asks when it cannot tell).
 */
export async function guardedTargets(
    action: string,
    input: Readonly<Record<string, unknown>>,
    root: string,
    settings: GitSettings,
    signal?: AbortSignal,
): Promise<GuardTarget | undefined> {
    const text = (value: unknown): string | undefined =>
        typeof value === "string" && value !== "" ? value : undefined;
    const from = await headSha(root, signal);
    const operation = text(input.operation);
    const wanted: Array<{ ref: string; label: string }> = [];
    switch (action) {
        case "sync":
            wanted.push({ ref: "@{upstream}", label: "@{upstream}" });
            break;
        case "merge": {
            const branch = text(input.branch);
            const base = text(input.base) ?? (await baseOf(root, settings, signal));
            const split = await splitBase(root, base, signal);
            wanted.push(
                ...(branch === undefined
                    ? [
                          {
                              ref: `refs/remotes/${split.remote}/${split.branch}`,
                              label: `${split.remote}/${split.branch}`,
                          },
                      ]
                    : [
                          { ref: `refs/heads/${branch}`, label: branch },
                          { ref: `refs/remotes/origin/${branch}`, label: `origin/${branch}` },
                      ]),
            );
            break;
        }
        case "rebase": {
            const base = text(input.base) ?? (await baseOf(root, settings, signal));
            const split = await splitBase(root, base, signal);
            wanted.push({
                ref: `refs/remotes/${split.remote}/${split.branch}`,
                label: `${split.remote}/${split.branch}`,
            });
            break;
        }
        case "branch": {
            if (operation === "switch") {
                const branch = text(input.branch);
                if (branch === undefined) return undefined;
                wanted.push(
                    { ref: `refs/heads/${branch}`, label: branch },
                    { ref: `refs/remotes/origin/${branch}`, label: `origin/${branch}` },
                );
            } else if (operation === "create") {
                const base = text(input.base) ?? (await baseOf(root, settings, signal));
                const split = await splitBase(root, base, signal);
                wanted.push({
                    ref: `refs/remotes/${split.remote}/${split.branch}`,
                    label: `${split.remote}/${split.branch}`,
                });
            } else return undefined;
            break;
        }
        case "cherry_pick": {
            if (!Array.isArray(input.revs)) return undefined;
            for (const rev of input.revs) if (typeof rev === "string") wanted.push({ ref: rev, label: rev });
            break;
        }
        case "stash": {
            if (operation !== "pop" && operation !== "apply") return undefined;
            const index = Math.max(0, Math.min(99, Math.trunc(typeof input.index === "number" ? input.index : 0)));
            wanted.push({ ref: `stash@{${index}}`, label: `stash@{${index}}` });
            break;
        }
        default:
            return undefined;
    }
    const targets: Array<{ sha: string; label: string }> = [];
    for (const item of wanted) {
        const found = await sha(root, item.ref, signal);
        if (found === undefined) continue;
        targets.push({ sha: found, label: item.label });
    }
    return targets.length === 0 ? undefined : { root, from, targets };
}

/** The guarded files a target would change. */
export async function guardedPathsFor(target: GuardTarget, action: string, signal?: AbortSignal): Promise<string[]> {
    const files = new Set<string>();
    for (const one of target.targets) {
        const found =
            action === "stash"
                ? await guardedStashChanges(target.root, one.sha, signal)
                : await guardedChanges(target.root, target.from, one.sha, signal);
        for (const path of found) files.add(path);
    }
    return [...files];
}

/** The files a later target would change that the plan did not expect: a fetch brought them after the question. */
export function newGuarded(before: readonly string[], after: readonly string[]): string[] {
    const known = new Set(before);
    return after.filter((path) => !known.has(path));
}

export function lateGuardError(paths: readonly string[]): Error {
    return new Error(
        `the fetch brought changes to files Pi loads (${paths.slice(0, 5).join(", ")}${paths.length > 5 ? ", …" : ""}); nothing was applied. Run this again and the person will be asked`,
    );
}

/** The guarded files between two commits with their blob ids: the same path with new content is a change. */
export async function guardedSnapshots(
    root: string,
    from: string,
    to: string,
    signal?: AbortSignal,
): Promise<Map<string, string>> {
    const found = new Map<string, string>();
    if (from === "" || to === "" || from === to) return found;
    const out = await git(root, ["diff", "--raw", "-z", from, to], { signal });
    if (out.code !== 0) throw new Error(`could not read the change between ${from.slice(0, 7)} and ${to.slice(0, 7)}`);
    const parts = out.stdout.split("\u0000");
    for (let index = 0; index + 1 < parts.length; index += 2) {
        const meta = parts[index] ?? "";
        const path = parts[index + 1] ?? "";
        const blob = /^:[0-9]+ [0-9]+ [0-9a-f]+ ([0-9a-f]+) /.exec(meta)?.[1];
        if (path !== "" && blob !== undefined && guardedRelative(path)) found.set(path, blob);
    }
    return found;
}

/** Paths new or with a different blob after a fetch. */
export function newGuardedSnapshots(before: ReadonlyMap<string, string>, after: ReadonlyMap<string, string>): string[] {
    return [...after].filter(([path, blob]) => before.get(path) !== blob).map(([path]) => path);
}
