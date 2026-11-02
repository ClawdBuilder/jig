// Where the review of an agent run starts, per repository. The run's diff is taken from the commit HEAD was at when the run began,
// so a merge, a pull or a rebase made in the run would show every commit that came in with it: other people's work, which
// the agent never wrote. This finds the commits that came in and gives a tree to diff from instead: the starting commit plus
// what git's own automatic merge adds from them. Best effort, like the other snapshots: when git cannot tell, there is no
// answer and the review starts at the starting commit, which shows more than the agent did and never less.
import type { Git } from "./git.ts";

/** What came in with the run, and the tree to review against. */
export type RunBase = {
    /** A tree: the starting commit with the incoming commits merged in the way git merges them on its own. */
    base: string;
    /** What came in, in a few words each ("merged origin/develop"). */
    incoming: string[];
};

const GIT_TIMEOUT_MS = 8000;
/** How many commits the run may hold, and how many moves of HEAD, before this gives up. */
const MAX_RUN_COMMITS = 20000;
const MAX_RUN_MOVES = 1000;

/** Reflog subjects of commits git created for the agent: `commit`, `commit (merge)`, `cherry-pick`, `rebase (pick)`. */
const AUTHORED = /^(commit|cherry-pick|revert|am)\b|\((pick|reword|squash|fixup|edit|continue)\)/;
/** Reflog subjects of HEAD moving onto commits that exist already: a merge, a pull, a reset to a ref, a rebase's new base. */
const MOVED_ONTO_OTHERS = /^(merge|pull)\b|^reset: moving to (?!HEAD$)|\(start\)/;

type Move = { sha: string; subject: string };

/**
 * How many entries each repository's HEAD reflog holds (root -> count), taken when the run starts so that afterwards the
 * run's own moves of HEAD can be told from older ones, even when HEAD comes back to a commit it was at before. A repository
 * whose reflog git cannot read is left out.
 */
export async function snapshotReflogs(roots: string[], git: Git): Promise<Record<string, number>> {
    const counts: Record<string, number> = {};
    await Promise.all(
        roots.map(async (root) => {
            try {
                const entries = await reflog(git, root, "%H");
                if (entries !== undefined) counts[root] = entries.length;
            } catch {
                // left out: that repository's review starts at HEAD
            }
        }),
    );
    return counts;
}

/**
 * For each repository whose HEAD moved, the base to review the run from, when commits other than the agent's came in. A
 * repository where nothing came in, or where git cannot tell, has no entry.
 *
 * @param heads Each repository's HEAD when the run started (root -> commit).
 * @param reflogs How many entries its HEAD reflog held then (root -> count), from `snapshotReflogs`.
 */
export async function runBases(
    heads: Record<string, string>,
    reflogs: Record<string, number>,
    git: Git,
): Promise<Map<string, RunBase>> {
    const bases = new Map<string, RunBase>();
    await Promise.all(
        Object.entries(heads).map(async ([root, start]) => {
            try {
                const before = reflogs[root];
                const base = before === undefined ? undefined : await runBase(git, root, start, before);
                if (base !== undefined) bases.set(root, base);
            } catch {
                // best effort: the review then starts at the starting commit
            }
        }),
    );
    return bases;
}

/**
 * The commits made in the run (`start..HEAD`) split in two. The agent's are the ones HEAD's reflog records git creating
 * (a commit, a cherry-pick, a rebase's replayed picks). The incoming ones are every other commit that sits under a merge's
 * other parent or under where a fast-forward, pull, reset or rebase moved HEAD, and has none of the agent's under it. The base
 * is then the starting commit merged with those, so only the agent's commits, its conflict resolutions and its uncommitted
 * edits differ from it.
 */
async function runBase(git: Git, root: string, start: string, reflogBefore: number): Promise<RunBase | undefined> {
    const head = await revParse(git, root, "HEAD");
    if (head === undefined || head === start) return undefined;

    const moves = await movesSince(git, root, start, reflogBefore);
    const commits = await commitsOfRun(git, root, start, head);
    if (moves === undefined || commits === undefined) return undefined;

    const authored = new Set(moves.filter((move) => AUTHORED.test(move.subject)).map((move) => move.sha));
    const parentsInRun = (sha: string): string[] => (commits.get(sha) ?? []).filter((parent) => commits.has(parent));

    // Parents come before their children; a commit is incoming only when everything under it in the run is incoming too.
    const incoming = new Set<string>();
    for (const sha of [...commits.keys()].reverse()) {
        if (!authored.has(sha) && parentsInRun(sha).every((parent) => incoming.has(parent))) incoming.add(sha);
    }

    const entries = moves.filter((move) => !AUTHORED.test(move.subject) && MOVED_ONTO_OTHERS.test(move.subject));
    const sources = new Set(entries.map((move) => move.sha).filter((sha) => commits.has(sha)));
    for (const [, parents] of commits)
        for (const parent of parents.slice(1)) if (commits.has(parent)) sources.add(parent);

    const fromElsewhere = new Set<string>();
    const pending = [...sources].filter((sha) => incoming.has(sha));
    for (let sha = pending.pop(); sha !== undefined; sha = pending.pop()) {
        if (fromElsewhere.has(sha)) continue;
        fromElsewhere.add(sha);
        pending.push(...parentsInRun(sha));
    }
    if (fromElsewhere.size === 0) return undefined;

    const underOthers = new Set([...fromElsewhere].flatMap(parentsInRun));
    const tips = [...fromElsewhere].filter((sha) => !underOthers.has(sha));
    const base = await mergedWith(git, root, start, tips);
    if (base === undefined) return undefined;
    return {
        base,
        incoming: describeIncoming(entries.filter((move) => sources.has(move.sha)).map((move) => move.subject)),
    };
}

async function revParse(git: Git, root: string, ref: string): Promise<string | undefined> {
    const result = await git(root, ["rev-parse", "--verify", "--quiet", ref], GIT_TIMEOUT_MS);
    const sha = result.stdout.trim();
    return result.code === 0 && /^[0-9a-f]{40,64}$/.test(sha) ? sha : undefined;
}

/** HEAD's reflog, newest first, one `format` line per entry; undefined when git cannot read it. */
async function reflog(git: Git, root: string, format: string): Promise<string[] | undefined> {
    const result = await git(root, ["reflog", "show", `--format=${format}`, "HEAD"], GIT_TIMEOUT_MS);
    if (result.code !== 0 || result.timedOut) return undefined;
    return result.stdout.split("\n").filter((line) => line.length > 0);
}

/**
 * The moves of HEAD made since the run started, oldest first: the reflog's entries beyond the `before` that it held then.
 * Undefined when that does not add up (the entry just before them is not the starting commit, as when the reflog was
 * expired), or the run moved HEAD too often: nothing can then be said about who made which commit.
 */
async function movesSince(git: Git, root: string, start: string, before: number): Promise<Move[] | undefined> {
    const lines = await reflog(git, root, "%H%x09%gs");
    if (lines === undefined) return undefined;
    const made = lines.length - before;
    if (before === 0 || made < 1 || made > MAX_RUN_MOVES || !lines[made]?.startsWith(start)) return undefined;
    return lines
        .slice(0, made)
        .map((line) => {
            const [sha = "", subject = ""] = line.split("\t");
            return { sha, subject };
        })
        .reverse();
}

/** The commits that `start..head` holds, each with its parents. Undefined when git fails or there are too many to read. */
async function commitsOfRun(
    git: Git,
    root: string,
    start: string,
    head: string,
): Promise<Map<string, string[]> | undefined> {
    const args = ["rev-list", "--parents", "--topo-order", `--max-count=${MAX_RUN_COMMITS + 1}`, `${start}..${head}`];
    const result = await git(root, args, GIT_TIMEOUT_MS);
    if (result.code !== 0 || result.timedOut) return undefined;
    const commits = new Map<string, string[]>();
    for (const line of result.stdout.split("\n")) {
        const [sha, ...parents] = line.trim().split(" ");
        if (sha) commits.set(sha, parents);
    }
    return commits.size > MAX_RUN_COMMITS ? undefined : commits;
}

/**
 * The tree of `start` with each tip merged in by git's own automatic merge (`git merge-tree --write-tree`, git 2.38 or
 * newer: older git has no answer). A conflict leaves its markers in the tree, so what the agent did to resolve it is the
 * difference from it. A second tip needs a commit to merge into, which `commit-tree` makes; it stays unreferenced.
 */
async function mergedWith(git: Git, root: string, start: string, tips: string[]): Promise<string | undefined> {
    let tree = await mergeTree(git, root, start, tips[0]);
    for (const tip of tips.slice(1)) {
        if (tree === undefined) return undefined;
        const made = await git(
            root,
            ["commit-tree", "--no-gpg-sign", tree, "-p", start, "-m", "jig-review base"],
            GIT_TIMEOUT_MS,
        );
        const commit = made.stdout.trim();
        if (made.code !== 0 || !/^[0-9a-f]{40,64}$/.test(commit)) return undefined;
        tree = await mergeTree(git, root, commit, tip);
    }
    return tree;
}

/** The tree of a merge, written to the object store. Exit 1 is a merge with conflicts, whose tree is still written. */
async function mergeTree(
    git: Git,
    root: string,
    ours: string,
    theirs: string | undefined,
): Promise<string | undefined> {
    if (theirs === undefined) return undefined;
    const result = await git(root, ["merge-tree", "--write-tree", "--no-messages", ours, theirs], GIT_TIMEOUT_MS);
    if (result.timedOut || (result.code !== 0 && result.code !== 1)) return undefined;
    const tree = result.stdout.split("\n")[0]?.trim() ?? "";
    return /^[0-9a-f]{40,64}$/.test(tree) ? tree : undefined;
}

/** What the incoming moves were, from their reflog subjects: "merged origin/develop", "pulled", "rebased onto main". */
export function describeIncoming(subjects: string[]): string[] {
    const found = new Set<string>();
    for (const subject of subjects) {
        const merge = /^merge ([^:]+):/.exec(subject);
        const reset = /^reset: moving to (.+)$/.exec(subject);
        const rebase = /^(?:pull --rebase|rebase)[^:]*\(start\): checkout (.+)$/.exec(subject);
        const pull = /^pull((?: [^:(]*)?):/.exec(subject);
        if (merge) found.add(`merged ${merge[1]}`);
        else if (reset) found.add(`reset to ${reset[1]}`);
        else if (rebase)
            found.add(`rebased onto ${/^[0-9a-f]{40,64}$/.test(rebase[1]!) ? rebase[1]!.slice(0, 7) : rebase[1]}`);
        else if (pull)
            found.add(["pulled", ...pull[1]!.split(" ").filter((word) => word && !word.startsWith("-"))].join(" "));
    }
    return [...found];
}
