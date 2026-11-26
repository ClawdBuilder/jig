// The files of a working tree as the next commit would hold them, and a copy of them in another folder.
//
// A check that packs or installs this repository must see what a clone of the commit would have, not what lies in the working folder: no
// node_modules, no build output nobody commits, no editor leftovers. git knows that list, so this file asks it. Only Node's own modules are
// imported, so a script that uses it runs before `npm ci`.
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, statSync } from "node:fs";
import path from "node:path";

/** What `git ls-files` may print for a big tree: well over the largest tree this repository will have. */
const LIST_BYTES = 64 * 1024 * 1024;

/**
 * The files of `repo` that the next commit would hold: the tracked files, and the new files git would add (not the ignored ones). A tracked
 * file that was deleted is left out, and so is a path that is not a file (a submodule's folder). Names are relative and written with "/".
 */
export function filesOfTree(repo) {
    const listed = execFileSync("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard"], {
        cwd: repo,
        encoding: "utf8",
        maxBuffer: LIST_BYTES,
    });
    // A file with a merge conflict is listed once for each stage, so the names go through a set.
    return [...new Set(listed.split("\0"))].filter((file) => file !== "" && isFile(path.join(repo, file)));
}

/** Copies the files of `repo` to `target`, which may not exist yet, with the same relative names. Returns the names. */
export function copyTree(repo, target) {
    const files = filesOfTree(repo);
    for (const file of files) {
        mkdirSync(path.dirname(path.join(target, file)), { recursive: true });
        copyFileSync(path.join(repo, file), path.join(target, file));
    }
    return files;
}

function isFile(file) {
    try {
        return statSync(file).isFile();
    } catch {
        return false;
    }
}
