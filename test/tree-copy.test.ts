// scripts/lib/tree-copy.mjs, which check-gateway.mjs and check-claude-plugin.mjs use to copy the working tree: the files a commit would hold, and no
// others. A temporary git repository has a tracked file, a new file, an ignored file and a tracked file that was deleted.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
// @ts-expect-error the copy is plain JavaScript
import { copyTree, filesOfTree } from "../scripts/lib/tree-copy.mjs";

const git = (cwd: string, ...args: string[]): void => {
    execFileSync(
        "git",
        ["-c", "user.name=Tree Copy", "-c", "user.email=tree@example.com", "-c", "commit.gpgsign=false", ...args],
        {
            cwd,
            stdio: "ignore",
        },
    );
};

const put = (repo: string, file: string, text: string): void => {
    mkdirSync(path.dirname(path.join(repo, file)), { recursive: true });
    writeFileSync(path.join(repo, file), text);
};

/** A repository with a committed file, a committed file that was then deleted, and, uncommitted, a new file and two ignored ones. */
function makeRepository(t: { after: (fn: () => void) => void }): { root: string; repo: string } {
    const root = mkdtempSync(path.join(tmpdir(), "jig-tree-copy-"));
    t.after(() => rmSync(root, { recursive: true, force: true }));
    const repo = path.join(root, "repo");
    mkdirSync(repo);
    git(repo, "init", "-q");
    put(repo, ".gitignore", "ignored.log\nbuild/\n");
    put(repo, "kept.txt", "tracked\n");
    put(repo, "dir/inner.txt", "tracked in a folder\n");
    put(repo, "gone.txt", "tracked, then deleted\n");
    git(repo, "add", "-A");
    git(repo, "commit", "-q", "-m", "First");
    rmSync(path.join(repo, "gone.txt"));
    put(repo, "fresh/new.txt", "not added yet\n");
    put(repo, "a file é.txt", "a name with a space and an accent\n");
    put(repo, "ignored.log", "ignored\n");
    put(repo, "build/out.js", "ignored folder\n");
    return { root, repo };
}

test("the files are the tracked ones and the new ones: not an ignored file, and not a tracked file that was deleted", (t) => {
    const { repo } = makeRepository(t);
    assert.deepEqual([...filesOfTree(repo)].sort(), [
        ".gitignore",
        "a file é.txt",
        "dir/inner.txt",
        "fresh/new.txt",
        "kept.txt",
    ]);
});

test("copyTree writes those files, with their text and their folders, to a target that did not exist, and nothing else", (t) => {
    const { root, repo } = makeRepository(t);
    const target = path.join(root, "copy");
    const copied = copyTree(repo, target) as string[];
    assert.deepEqual(copied.sort(), [".gitignore", "a file é.txt", "dir/inner.txt", "fresh/new.txt", "kept.txt"]);
    assert.equal(readFileSync(path.join(target, "dir/inner.txt"), "utf8"), "tracked in a folder\n");
    assert.equal(readFileSync(path.join(target, "fresh/new.txt"), "utf8"), "not added yet\n");
    assert.equal(readFileSync(path.join(target, "a file é.txt"), "utf8"), "a name with a space and an accent\n");
    for (const left of ["gone.txt", "ignored.log", "build", ".git"]) {
        assert.equal(existsSync(path.join(target, left)), false, `${left} is not copied`);
    }
});

test("a new file that .gitignore names later leaves the list", (t) => {
    const { repo } = makeRepository(t);
    put(repo, ".gitignore", "ignored.log\nbuild/\nfresh/\n");
    assert.deepEqual([...filesOfTree(repo)].sort(), [".gitignore", "a file é.txt", "dir/inner.txt", "kept.txt"]);
});
