// A ratchet on source-file size. A file of more than 500 lines is a lot for a newcomer to hold in their head, so the
// files that are already over it are listed, with their size, in `file-sizes-baseline.json`. The test that calls this
// fails when a file new to the list crosses 500, or when a listed file grows; a file that shrinks passes and says to
// lower its number, so the ratchet only turns one way. `docs/decisions.md` says how the big ones were split.
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

export const LIMIT = 500;

/** Every `.ts` file under a folder, skipping `node_modules`, as paths relative to `root`. */
function sourceFilesIn(dir, root, out) {
    let names;
    try {
        names = readdirSync(dir);
    } catch {
        return out; // a plugin with no src folder
    }
    for (const name of names) {
        const full = path.join(dir, name);
        if (name === "node_modules") continue;
        if (statSync(full).isDirectory()) sourceFilesIn(full, root, out);
        else if (name.endsWith(".ts"))
            out.push({ file: path.relative(root, full).split(path.sep).join("/"), lines: linesOf(full) });
    }
    return out;
}

/** The lines in a file, counting the last one only when it is not the empty line after a final newline. */
export function linesOf(file) {
    return readFileSync(file, "utf8").split("\n").length - 1;
}

/** The `src` folders of the plugins and of the example company plugins, with every file's line count. */
export function sourceFiles(root) {
    const out = [];
    for (const group of ["plugins", "examples"]) {
        let names;
        try {
            names = readdirSync(path.join(root, group));
        } catch {
            continue;
        }
        for (const name of names) sourceFilesIn(path.join(root, group, name, "src"), root, out);
    }
    return out.sort((a, b) => a.file.localeCompare(b.file));
}

/**
 * Compares today's sizes with the baseline. `failures` are the reasons to stop: a new file over the limit, or a listed
 * file that grew. `notes` are things to tidy: a file that shrank, so its number can come down, or an entry for a file
 * that is gone or now under the limit.
 */
export function ratchet(entries, baseline, limit = LIMIT) {
    const failures = [];
    const notes = [];
    const seen = new Set();
    for (const { file, lines } of entries) {
        seen.add(file);
        const known = baseline[file];
        if (lines <= limit) {
            if (known !== undefined)
                notes.push(`${file} is ${lines} lines now, under ${limit}: remove it from the baseline`);
            continue;
        }
        if (known === undefined) {
            failures.push(
                `${file} has ${lines} lines and is not in the baseline: split it by job, or add it with the reason`,
            );
        } else if (lines > known) {
            failures.push(`${file} grew from ${known} to ${lines} lines: split it, or lower it back`);
        } else if (lines < known) {
            notes.push(`${file} is ${lines} lines, down from ${known}: lower the baseline to ${lines}`);
        }
    }
    for (const file of Object.keys(baseline)) {
        if (!seen.has(file)) notes.push(`${file} is in the baseline but is not a source file any more: remove it`);
    }
    return { failures, notes };
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
    const root = process.argv[2] ?? path.resolve(import.meta.dirname, "..");
    const baseline = JSON.parse(readFileSync(path.join(root, "scripts", "file-sizes-baseline.json"), "utf8"));
    const { failures, notes } = ratchet(sourceFiles(root), baseline);
    for (const note of notes) console.log(`note ${note}`);
    for (const failure of failures) console.log(`fail ${failure}`);
    const big = sourceFiles(root).filter((entry) => entry.lines > LIMIT).length;
    console.log(`sizes: ${failures.length} failures, ${notes.length} notes (${big} files over ${LIMIT})`);
    process.exit(failures.length === 0 ? 0 : 1);
}
