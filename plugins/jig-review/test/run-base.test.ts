// Where a run's review starts, over real repositories: what counts as the agent's commits, what came in, and the tree to
// diff from.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import type { Git } from "../src/git.ts";
import { describeIncoming, runBases, snapshotReflogs } from "../src/run-base.ts";
import { installFakeJig } from "./support/fake-jig.ts";
import type { FakeJig } from "./support/fake-jig.ts";
import { git } from "./support/git.ts";

let jig: FakeJig;
let dirs: string[] = [];
const viaJig: Git = (repo, args, timeoutMs) => jig.api.exec.git(repo, args, { timeoutMs });

before(() => {
    jig = installFakeJig();
});
after(() => {
    jig.remove();
    for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
    dirs = [];
});

/** A repository on `feature` that left `develop`, which has since gained two commits of other people's: A.txt and B.txt. */
function newRepo() {
    const repo = mkdtempSync(path.join(os.tmpdir(), "jig-review-base-"));
    dirs.push(repo);
    const write = (file: string, text: string) => writeFileSync(path.join(repo, file), text);
    git(repo, "init", "-q", "-b", "develop");
    for (const file of ["A.txt", "B.txt", "C.txt", "S.txt"]) write(file, "one\n");
    git(repo, "add", ".");
    git(repo, "commit", "-q", "-m", "init");
    git(repo, "checkout", "-q", "-b", "feature");
    write("S.txt", "one\nfeature\n");
    git(repo, "commit", "-q", "-am", "feature work");
    git(repo, "checkout", "-q", "develop");
    write("A.txt", "one\nothers\n");
    git(repo, "commit", "-q", "-am", "others 1");
    write("B.txt", "one\nothers\n");
    git(repo, "commit", "-q", "-am", "others 2");
    git(repo, "checkout", "-q", "feature");
    const head = () => git(repo, "rev-parse", "HEAD").trim();
    const tree = (rev: string) => git(repo, "rev-parse", `${rev}^{tree}`).trim();
    /** Starts a run now, and answers for it once `act` has run. */
    const run = async (act: () => void, git2: Git = viaJig) => {
        const start = head();
        const reflogs = await snapshotReflogs([repo], git2);
        act();
        const bases = await runBases({ [repo]: start }, reflogs, git2);
        return { start, base: bases.get(repo) };
    };
    return { repo, write, head, tree, run };
}

test("a clean merge gives a base that is the merge's own tree, and says what it was", async () => {
    const r = newRepo();
    const { base } = await r.run(() => git(r.repo, "merge", "-q", "develop", "-m", "Merge develop"));
    assert.equal(base?.base, r.tree("HEAD"));
    assert.deepEqual(base?.incoming, ["merged develop"]);
});

test("a fast-forward and a reset to a ref give the tree they moved to", async () => {
    for (const move of [
        ["merge", "-q", "--ff-only", "develop"],
        ["reset", "-q", "--hard", "develop"],
    ]) {
        const r = newRepo();
        git(r.repo, "reset", "-q", "--hard", "develop~2"); // feature level with develop's start, so that develop is ahead of it
        const { base } = await r.run(() => git(r.repo, ...move));
        assert.equal(base?.base, r.tree("develop"), move.join(" "));
    }
});

test("a merge resolved by hand gives the merge git makes on its own, markers included, not the resolution", async () => {
    const r = newRepo();
    git(r.repo, "checkout", "-q", "develop");
    r.write("S.txt", "one\nothers\n");
    git(r.repo, "commit", "-q", "-am", "others touch S.txt");
    git(r.repo, "checkout", "-q", "feature");
    const { base } = await r.run(() => {
        try {
            git(r.repo, "merge", "-q", "develop");
        } catch {
            // conflicts, as expected
        }
        r.write("S.txt", "one\nfeature and others\n");
        git(r.repo, "commit", "-q", "-a", "-m", "Merge develop");
    });
    assert.ok(base !== undefined);
    assert.notEqual(base.base, r.tree("HEAD"), "the resolution is what differs");
    assert.match(git(r.repo, "show", `${base.base}:S.txt`), /^<<<<<<< /m);
    assert.equal(git(r.repo, "show", `${base.base}:A.txt`), "one\nothers\n", "what came in cleanly is in the base");
    assert.equal(git(r.repo, "show", `${base.base}:C.txt`), "one\n");
});

test("nothing for a run that did not move HEAD, that only committed, or that has no reflog count", async () => {
    const r = newRepo();
    assert.equal((await r.run(() => {})).base, undefined);
    assert.equal(
        (
            await r.run(() => {
                r.write("C.txt", "one\nagent\n");
                git(r.repo, "commit", "-q", "-am", "agent");
                git(r.repo, "commit", "-q", "--amend", "-m", "agent, reworded");
            })
        ).base,
        undefined,
    );
    const start = r.head();
    git(r.repo, "merge", "-q", "develop", "-m", "Merge develop");
    assert.equal((await runBases({ [r.repo]: start }, {}, viaJig)).size, 0);
});

test("the agent's commits on another branch, merged in, and cherry-picked from it, are not incoming", async () => {
    const r = newRepo();
    const own = await r.run(() => {
        git(r.repo, "checkout", "-q", "-b", "scratch");
        r.write("C.txt", "one\nagent\n");
        git(r.repo, "commit", "-q", "-am", "scratch");
        git(r.repo, "checkout", "-q", "feature");
        git(r.repo, "merge", "-q", "--no-ff", "scratch", "-m", "Merge scratch");
    });
    assert.equal(own.base, undefined);

    const picked = await r.run(() => git(r.repo, "cherry-pick", "develop"));
    assert.equal(picked.base, undefined, "a cherry-pick is a commit the agent made");
});

test("an incoming line under the agent's own merge commit still counts, with the agent's commit before it", async () => {
    const r = newRepo();
    const { base } = await r.run(() => {
        r.write("C.txt", "one\nagent\n");
        git(r.repo, "commit", "-q", "-am", "agent");
        git(r.repo, "merge", "-q", "develop", "-m", "Merge develop");
    });
    assert.ok(base !== undefined);
    assert.equal(git(r.repo, "show", `${base.base}:A.txt`), "one\nothers\n");
    assert.equal(git(r.repo, "show", `${base.base}:C.txt`), "one\n", "the agent's own change is not in the base");
});

test("two unrelated lines make one base with both", async () => {
    const r = newRepo();
    git(r.repo, "checkout", "-q", "-b", "release", "develop~2");
    r.write("C.txt", "one\nrelease\n");
    git(r.repo, "commit", "-q", "-am", "release work");
    git(r.repo, "checkout", "-q", "feature");
    const { base } = await r.run(() => {
        git(r.repo, "merge", "-q", "develop", "-m", "Merge develop");
        git(r.repo, "merge", "-q", "release", "-m", "Merge release");
    });
    assert.equal(base?.base, r.tree("HEAD"));
    assert.deepEqual(base?.incoming, ["merged develop", "merged release"]);
});

test("git without merge-tree --write-tree, or a failing git, gives no answer and no error", async () => {
    const withoutWriteTree: Git = (repo, args, timeoutMs) =>
        args[0] === "merge-tree"
            ? Promise.resolve({ code: 129, stdout: "", stderr: "unknown option: --write-tree", timedOut: false })
            : viaJig(repo, args, timeoutMs);
    const r = newRepo();
    assert.equal(
        (await r.run(() => git(r.repo, "merge", "-q", "develop", "-m", "m"), withoutWriteTree)).base,
        undefined,
    );

    const failing: Git = async () => {
        throw new Error("jig-core refused: .git/config sets core.sshcommand");
    };
    assert.equal((await snapshotReflogs([r.repo], failing))[r.repo], undefined);
    assert.equal((await runBases({ [r.repo]: r.head() }, { [r.repo]: 3 }, failing)).size, 0);
});

test("an expired reflog gives no answer: the entry before the run's is not the starting commit", async () => {
    const r = newRepo();
    const { base } = await r.run(() => {
        git(r.repo, "merge", "-q", "develop", "-m", "Merge develop");
        git(r.repo, "reflog", "expire", "--expire=now", "--all");
    });
    assert.equal(base, undefined);
});

test("describeIncoming names what came in, once each, and ignores the rest", () => {
    assert.deepEqual(
        describeIncoming([
            "merge origin/develop: Merge made by the 'ort' strategy.",
            "merge origin/develop: Fast-forward",
            "pull origin develop: Fast-forward",
            "pull -q --ff-only: Fast-forward",
            "pull: Fast-forward",
            "reset: moving to origin/main",
            "rebase (start): checkout origin/main",
            `pull --rebase (start): checkout ${"a1b2c3d4".repeat(5)}`,
            "checkout: moving from main to feature",
        ]),
        [
            "merged origin/develop",
            "pulled origin develop",
            "pulled",
            "reset to origin/main",
            "rebased onto origin/main",
            "rebased onto a1b2c3d",
        ],
    );
});
