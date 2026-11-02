// The review offered after a run shows what the agent did, not the commits that arrived with a merge, a pull or a rebase.
// Real repositories: a bare remote, a colleague's clone that pushes to it, and the agent's repository in Pi's workspace.
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, afterEach, before, beforeEach, test } from "node:test";
import { ReviewCoordinator } from "../src/coordinator.ts";
import type { Git } from "../src/git.ts";
import { workspaceDirFor } from "../src/settings.ts";
import { installFakeJig } from "./support/fake-jig.ts";
import type { FakeJig } from "./support/fake-jig.ts";
import { context, fakeHost } from "./support/harness.ts";
import { git } from "./support/git.ts";

const cleanups: Array<() => Promise<void> | void> = [];
let jig: FakeJig;
const agentRoots = new Map<string, string>();

type Stored = { fileScope: string; iterations: Array<{ diff: string }> };
const readRecords = (workspace: string): Stored[] => {
    const dir = path.join(workspaceDirFor(agentRoots.get(workspace)!, workspace), "reviews");
    if (!existsSync(dir)) return [];
    return readdirSync(dir)
        .filter((name) => name.endsWith(".json"))
        .map((name) => JSON.parse(readFileSync(path.join(dir, name), "utf8")) as Stored);
};
const filesOf = (diff: string): string[] => [...diff.matchAll(/^diff --git a\/(\S+)/gm)].map((match) => match[1]!);
const NOTHING = "Nothing to review: the run only merged origin/develop.";

before(() => {
    jig = installFakeJig();
});
after(() => jig.remove());
beforeEach(() => {
    process.env.BROWSER = "true";
});
afterEach(async () => {
    for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
    delete process.env.BROWSER;
});

/** git that may fail: a merge with conflicts exits 1, and the test goes on to resolve it. */
function tryGit(cwd: string, ...args: string[]): void {
    try {
        git(cwd, ...args);
    } catch {
        // expected
    }
}

/**
 * `orders-api` in Pi's workspace is on `feature/PROJ-7`, which left `develop` with one commit of its own; both are pushed to a
 * bare remote. `colleague` is another clone of it, and `push` puts a commit of theirs on a branch of the remote.
 */
function newWorkspace(options: { git?: Git } = {}) {
    const base = mkdtempSync(path.join(os.tmpdir(), "jig-review-incoming-"));
    const agentRoot = mkdtempSync(path.join(os.tmpdir(), "jig-review-root-"));
    const root = path.join(base, "workspace");
    const repo = path.join(root, "orders-api");
    const remote = path.join(base, "origin.git");
    const mate = path.join(base, "colleague");
    git(base, "init", "-q", "--bare", "-b", "develop", remote);
    git(base, "init", "-q", "-b", "develop", repo);
    for (const file of ["Service.java", "Other.java", "A.java", "B.java", "C.java"])
        writeFileSync(path.join(repo, file), "one\n");
    git(repo, "add", ".");
    git(repo, "commit", "-q", "-m", "init");
    git(repo, "remote", "add", "origin", remote);
    git(repo, "push", "-q", "origin", "develop");
    git(repo, "checkout", "-q", "-b", "feature/PROJ-7");
    writeFileSync(path.join(repo, "Service.java"), "one\nfeature line\n");
    git(repo, "commit", "-q", "-am", "PROJ-7 earlier work");
    git(repo, "push", "-q", "-u", "origin", "feature/PROJ-7");
    git(base, "clone", "-q", remote, mate);

    roots(agentRoot, root);
    const host = fakeHost();
    const coordinator = new ReviewCoordinator(host.pi, root, {
        root: agentRoot,
        ...(options.git ? { git: options.git } : {}),
    });
    coordinator.register();
    const session = context(root);
    session.answer = (title) => title === "Review generated code?";
    cleanups.push(async () => {
        await host.fire("session_shutdown", session.ctx);
        rmSync(base, { recursive: true, force: true });
        rmSync(agentRoot, { recursive: true, force: true });
    });

    const push = (branch: string, files: Record<string, string>): void => {
        git(mate, "fetch", "-q", "origin");
        git(mate, "checkout", "-q", "-B", branch, `origin/${branch}`);
        for (const [file, text] of Object.entries(files)) writeFileSync(path.join(mate, file), text);
        git(mate, "add", ".");
        git(mate, "commit", "-q", "-m", `colleague on ${branch}`);
        git(mate, "push", "-q", "origin", branch);
    };
    /** One agent run: `change` stands for what the agent does in the repository, and bash has used it. */
    const run = async (change: () => void): Promise<void> => {
        await host.fire("agent_start", session.ctx);
        await coordinator.runStartTaken();
        change();
        await host.fire("tool_call", session.ctx, {
            toolName: "bash",
            input: { command: `cd ${repo} && git status` },
        });
        await host.fire("agent_end", session.ctx);
    };
    /** The files of the review the run offered, as paths from Pi's folder. */
    const reviewed = (): string[] => {
        const records = readRecords(root);
        assert.ok(records.every((record) => record.fileScope === "touched"));
        return records.flatMap((record) => filesOf(record.iterations.at(-1)?.diff ?? "")).sort();
    };
    const diff = (): string => readRecords(root)[0]?.iterations.at(-1)?.diff ?? "";
    return { root, repo, host, session, push, run, reviewed, diff, base, mate };
}
function roots(agentRoot: string, root: string): void {
    agentRoots.set(root, agentRoot);
}

/** The colleague's work on develop: three files, one of them Service.java's neighbour. */
const COLLEAGUE = { "A.java": "one\ncolleague\n", "B.java": "one\ncolleague\n", "Other.java": "one\ncolleague\n" };

test("a clean merge of origin/develop offers no review, and says why", async () => {
    const w = newWorkspace();
    w.push("develop", COLLEAGUE);
    await w.run(() => {
        git(w.repo, "fetch", "-q", "origin");
        git(w.repo, "merge", "-q", "origin/develop", "-m", "Merge origin/develop");
    });
    assert.deepEqual(w.reviewed(), []);
    assert.deepEqual(w.session.asked, []);
    assert.deepEqual(w.session.notices, [NOTHING]);
});

test("a merge the agent resolved by hand offers only the resolution", async () => {
    const w = newWorkspace();
    w.push("develop", { ...COLLEAGUE, "Service.java": "one\ncolleague line\n" });
    await w.run(() => {
        git(w.repo, "fetch", "-q", "origin");
        tryGit(w.repo, "merge", "origin/develop");
        writeFileSync(path.join(w.repo, "Service.java"), "one\nfeature line and colleague line\n");
        git(w.repo, "commit", "-q", "-a", "-m", "Merge origin/develop, keep both");
    });
    assert.deepEqual(w.reviewed(), ["orders-api/Service.java"]);
    assert.match(w.diff(), /^\+feature line and colleague line$/m);
    assert.doesNotMatch(w.diff(), /A\.java|B\.java|Other\.java/, "the colleague's files are not in it");
    assert.match(w.session.asked[0] ?? "", /changed 1 file\./);
});

test("a merge followed by an agent edit offers only the edit, even in a file the merge changed", async () => {
    const w = newWorkspace();
    w.push("develop", COLLEAGUE);
    await w.run(() => {
        git(w.repo, "fetch", "-q", "origin");
        git(w.repo, "merge", "-q", "origin/develop", "-m", "Merge origin/develop");
        writeFileSync(path.join(w.repo, "Other.java"), "one\ncolleague\nagent edit\n");
    });
    assert.deepEqual(w.reviewed(), ["orders-api/Other.java"]);
    assert.match(w.diff(), /^\+agent edit$/m);
    assert.doesNotMatch(w.diff(), /^\+colleague$/m, "the colleague's line is context, not a change");
    assert.match(w.session.asked[0] ?? "", /changed 1 file\./);
});

test("a resolution and an edit afterwards both show, and nothing else", async () => {
    const w = newWorkspace();
    w.push("develop", { ...COLLEAGUE, "Service.java": "one\ncolleague line\n" });
    await w.run(() => {
        git(w.repo, "fetch", "-q", "origin");
        tryGit(w.repo, "merge", "origin/develop");
        writeFileSync(path.join(w.repo, "Service.java"), "one\nresolved\n");
        git(w.repo, "commit", "-q", "-a", "-m", "Merge origin/develop");
        writeFileSync(path.join(w.repo, "C.java"), "one\nagent edit\n");
    });
    assert.deepEqual(w.reviewed(), ["orders-api/C.java", "orders-api/Service.java"]);
});

test("the agent's own commit, made before it merges, still shows", async () => {
    const w = newWorkspace();
    w.push("develop", COLLEAGUE);
    await w.run(() => {
        writeFileSync(path.join(w.repo, "C.java"), "one\nagent commit\n");
        git(w.repo, "commit", "-q", "-am", "PROJ-7 agent work");
        git(w.repo, "fetch", "-q", "origin");
        git(w.repo, "merge", "-q", "origin/develop", "-m", "Merge origin/develop");
    });
    assert.deepEqual(w.reviewed(), ["orders-api/C.java"]);
    assert.match(w.diff(), /^\+agent commit$/m);
});

test("a run with only the agent's own commit is reviewed as before, also after it pushed", async () => {
    const w = newWorkspace();
    await w.run(() => {
        writeFileSync(path.join(w.repo, "C.java"), "one\nagent commit\n");
        git(w.repo, "commit", "-q", "-am", "PROJ-7 agent work");
        git(w.repo, "push", "-q");
    });
    assert.deepEqual(w.reviewed(), ["orders-api/C.java"]);
    assert.equal(
        w.session.notices.some((notice) => notice.startsWith("Nothing to review")),
        false,
    );
});

test("commits the agent made on another branch and merged in are the agent's", async () => {
    const w = newWorkspace();
    await w.run(() => {
        git(w.repo, "checkout", "-q", "-b", "scratch");
        writeFileSync(path.join(w.repo, "C.java"), "one\nscratch work\n");
        git(w.repo, "commit", "-q", "-am", "scratch");
        git(w.repo, "checkout", "-q", "feature/PROJ-7");
        git(w.repo, "merge", "-q", "--no-ff", "scratch", "-m", "Merge scratch");
    });
    assert.deepEqual(w.reviewed(), ["orders-api/C.java"]);
});

test("a pull that fast-forwards, and a reset to the fetched upstream, bring in nothing of the agent's", async () => {
    for (const how of ["pull", "reset"] as const) {
        const w = newWorkspace();
        w.push("feature/PROJ-7", { "A.java": "one\ncolleague\n", "B.java": "one\ncolleague\n" });
        await w.run(() => {
            if (how === "pull") git(w.repo, "pull", "-q", "--ff-only");
            else {
                git(w.repo, "fetch", "-q", "origin");
                git(w.repo, "reset", "-q", "--hard", "origin/feature/PROJ-7");
            }
        });
        assert.deepEqual(w.reviewed(), [], how);
        assert.deepEqual(w.session.asked, [], how);
        assert.equal(w.session.notices.length, 1, how);
        assert.match(
            w.session.notices[0]!,
            /^Nothing to review: the run only (pulled|reset to origin\/feature\/PROJ-7)\.$/,
            how,
        );
    }
});

test("a rebase onto upstream brings in nothing of the agent's; its own commit and edits after it still show", async () => {
    const plain = newWorkspace();
    plain.push("develop", COLLEAGUE);
    await plain.run(() => {
        git(plain.repo, "fetch", "-q", "origin");
        git(plain.repo, "rebase", "-q", "origin/develop");
    });
    assert.deepEqual(plain.reviewed(), []);
    assert.deepEqual(plain.session.asked, []);
    assert.match(plain.session.notices[0] ?? "", /^Nothing to review: the run only rebased onto origin\/develop\.$/);

    const own = newWorkspace();
    own.push("develop", COLLEAGUE);
    await own.run(() => {
        writeFileSync(path.join(own.repo, "C.java"), "one\nagent commit\n");
        git(own.repo, "commit", "-q", "-am", "PROJ-7 agent work");
        git(own.repo, "fetch", "-q", "origin");
        git(own.repo, "rebase", "-q", "origin/develop");
        writeFileSync(path.join(own.repo, "Other.java"), "one\ncolleague\nagent edit\n");
    });
    assert.deepEqual(own.reviewed(), ["orders-api/C.java", "orders-api/Other.java"]);
    assert.match(own.diff(), /^\+agent commit$/m);
    assert.match(own.diff(), /^\+agent edit$/m);
    assert.doesNotMatch(own.diff(), /^\+colleague$/m);
});

test("an explicit branch review is unchanged: the whole branch since it left develop", async () => {
    const w = newWorkspace();
    w.push("develop", COLLEAGUE);
    await w.run(() => {
        git(w.repo, "fetch", "-q", "origin");
        git(w.repo, "merge", "-q", "origin/develop", "-m", "Merge origin/develop");
    });
    await w.host.run("code-review", "--branch", w.session.ctx);
    const [record] = readRecords(w.root);
    assert.equal(record?.fileScope, "branch");
    assert.deepEqual(filesOf(record!.iterations.at(-1)!.diff), ["orders-api/Service.java"]);
    assert.match(record!.iterations.at(-1)!.diff, /^\+feature line$/m);
});

test("two unrelated lines merged in one run are both left out", async () => {
    const w = newWorkspace();
    w.push("develop", { "A.java": "one\ncolleague\n" });
    git(w.mate, "checkout", "-q", "-b", "release", "origin/develop");
    writeFileSync(path.join(w.mate, "B.java"), "one\nrelease\n");
    git(w.mate, "commit", "-q", "-am", "release work");
    git(w.mate, "push", "-q", "origin", "release");
    await w.run(() => {
        git(w.repo, "fetch", "-q", "origin");
        git(w.repo, "merge", "-q", "origin/develop", "-m", "Merge develop");
        git(w.repo, "merge", "-q", "origin/release", "-m", "Merge release");
    });
    assert.deepEqual(w.reviewed(), []);
    assert.deepEqual(w.session.notices, [
        "Nothing to review: the run only merged origin/develop and merged origin/release.",
    ]);
});

test("git without merge-tree --write-tree, or without the reflog, falls back to the whole range and never fails", async () => {
    const withoutMergeTree: Git = (repo, args, timeoutMs) =>
        args[0] === "merge-tree"
            ? Promise.resolve({ code: 129, stdout: "", stderr: "unknown option: --write-tree", timedOut: false })
            : jig.api.exec.git(repo, args, { timeoutMs });
    const w = newWorkspace({ git: withoutMergeTree });
    w.push("develop", COLLEAGUE);
    await w.run(() => {
        git(w.repo, "fetch", "-q", "origin");
        git(w.repo, "merge", "-q", "origin/develop", "-m", "Merge origin/develop");
    });
    assert.deepEqual(w.reviewed(), ["orders-api/A.java", "orders-api/B.java", "orders-api/Other.java"]);

    const v = newWorkspace();
    v.push("develop", COLLEAGUE);
    await v.run(() => {
        git(v.repo, "fetch", "-q", "origin");
        git(v.repo, "merge", "-q", "origin/develop", "-m", "Merge origin/develop");
        rmSync(path.join(v.repo, ".git", "logs"), { recursive: true, force: true });
    });
    assert.deepEqual(v.reviewed(), ["orders-api/A.java", "orders-api/B.java", "orders-api/Other.java"]);
});
