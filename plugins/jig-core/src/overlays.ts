// Skill overlays: a company plugin ships `overlays/<skill>.md`, plain Markdown with no front matter, and Pi never loads
// it as a skill. For the active company, jig-core writes a merged copy of each overlaid generic skill under the state
// folder: `<state>/skills/<profile>/<skill>/SKILL.md` is the generic file unchanged plus a section `## <Company> rules`,
// and the generic skill's other files are copied beside it so the relative links in it still resolve. Each turn,
// `applyToPrompt` points the skill in the prompt's list at the merged copy: the model sees one description (the generic
// one) and reads both texts in one file. Skills of a dormant company are left out of the list.
import { cpSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import path from "node:path";
import { replaceFileDurably } from "./kit/files.ts";
import { privateDir } from "./paths.ts";

/** A skill name, as Pi requires: lower-case letters, digits and dashes. Anything else is not an overlay. */
const SKILL_NAME = /^[a-z0-9][a-z0-9-]{0,63}$/;
const MAX_OVERLAY_BYTES = 64 * 1024;
const MAX_COPY_BYTES = 8 * 1024 * 1024;
const MAX_COPY_FILES = 400;

export interface SkillRef {
    name: string;
    /** Path of the SKILL.md Pi loaded. */
    filePath: string;
    baseDir?: string;
}

export interface OverlaySource {
    /** Absolute folder that holds `<skill>.md` files. */
    folder: string;
    /** Shown in the heading: `## <display> rules`. */
    display: string;
}

/** The overlay files of a folder: skill name to text. A file that is not `<skill-name>.md` or is too big is skipped. */
export function readOverlays(folder: string): { overlays: Map<string, string>; skipped: string[] } {
    const overlays = new Map<string, string>();
    const skipped: string[] = [];
    let names: string[];
    try {
        names = readdirSync(folder);
    } catch {
        return { overlays, skipped };
    }
    for (const file of names.sort()) {
        if (!file.endsWith(".md")) continue;
        const skill = file.slice(0, -3);
        const full = path.join(folder, file);
        try {
            if (!SKILL_NAME.test(skill) || !statSync(full).isFile() || statSync(full).size > MAX_OVERLAY_BYTES) {
                skipped.push(file);
                continue;
            }
            overlays.set(skill, readFileSync(full, "utf8"));
        } catch {
            skipped.push(file);
        }
    }
    return { overlays, skipped };
}

/** The text of the merged skill: the generic file as it is, then the company's rules. */
export function mergedText(generic: string, display: string, overlay: string): string {
    const heading = `## ${display.replace(/[\r\n]+/g, " ").trim()} rules`;
    const body = overlay.replace(/^﻿/, "").replace(/\s+$/, "");
    return `${generic.replace(/\s+$/, "")}\n\n${heading}\n\n${body}\n`;
}

/** Where the merged copies of a profile live. */
export function mergedRoot(profile: string): string {
    return path.join(privateDir("skills"), profile);
}

/** Whether a name is safe to use as a folder name here. */
function safeName(name: string): boolean {
    return /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(name);
}

/** Copies a skill's folder (everything but its SKILL.md) beside the merged file. Symbolic links are not followed. */
function copySiblings(from: string, to: string): void {
    let files = 0;
    let bytes = 0;
    const walk = (dir: string): void => {
        for (const name of readdirSync(dir)) {
            const full = path.join(dir, name);
            if (dir === from && name === "SKILL.md") continue;
            const stat = lstatSync(full);
            if (stat.isSymbolicLink()) continue;
            if (stat.isDirectory()) {
                walk(full);
                continue;
            }
            files++;
            bytes += stat.size;
            if (files > MAX_COPY_FILES || bytes > MAX_COPY_BYTES)
                throw new Error("the skill's folder is too big to copy");
        }
    };
    walk(from);
    cpSync(from, to, {
        recursive: true,
        force: true,
        dereference: false,
        filter: (source) =>
            !(path.dirname(source) === from && path.basename(source) === "SKILL.md") &&
            !lstatSync(source).isSymbolicLink(),
    });
}

export interface SyncResult {
    /** Skill name to the merged SKILL.md that replaces it. */
    merged: Map<string, string>;
    /** Overlays with no generic skill loaded, and other things worth saying. */
    notes: string[];
}

/**
 * Writes the merged copies for one profile. `skills` are the generic skills Pi loaded. Copies for skills that are no longer
 * overlaid are removed. Never throws: a skill that cannot be merged stays as it is, and the reason is a note.
 */
export function syncOverlays(profile: string, source: OverlaySource, skills: readonly SkillRef[]): SyncResult {
    const merged = new Map<string, string>();
    const notes: string[] = [];
    if (!safeName(profile)) return { merged, notes: [`profile "${profile}" cannot be used as a folder name`] };
    let root: string;
    try {
        root = mergedRoot(profile);
    } catch (error) {
        return { merged, notes: [`cannot make the state folder for merged skills: ${(error as Error).message}`] };
    }
    const { overlays, skipped } = readOverlays(source.folder);
    for (const file of skipped) notes.push(`overlay ${file} skipped: not <skill-name>.md, not a file, or over 64 KiB`);
    for (const [name, overlay] of overlays) {
        const generic = skills.find((skill) => skill.name === name);
        if (generic === undefined) {
            notes.push(`overlay ${name}.md has no generic skill "${name}" loaded, so it applies to nothing`);
            continue;
        }
        // The generic file may already be a merged copy (a second call in one session): never merge twice.
        if (path.resolve(generic.filePath).startsWith(path.resolve(root) + path.sep)) {
            merged.set(name, generic.filePath);
            continue;
        }
        const folder = path.join(root, name);
        const file = path.join(folder, "SKILL.md");
        try {
            const text = mergedText(readFileSync(generic.filePath, "utf8"), source.display, overlay);
            // Not emptied first: another session of the same profile may be reading the folder. Files are replaced whole.
            mkdirSync(folder, { recursive: true, mode: 0o700 });
            copySiblings(path.dirname(generic.filePath), folder);
            replaceFileDurably(file, text, 0o600);
            merged.set(name, file);
        } catch (error) {
            notes.push(`skill ${name} was not merged: ${(error as Error).message}`);
        }
    }
    // Merged copies of skills that are no longer overlaid
    try {
        for (const entry of readdirSync(root)) {
            if (!merged.has(entry)) rmSync(path.join(root, entry), { recursive: true, force: true });
        }
    } catch {
        // Nothing there yet.
    }
    return { merged, notes };
}

/** Removes the merged copies of every profile that is not `keep` (a profile removed from jig.json leaves none behind). */
export function pruneProfiles(keep: readonly string[]): void {
    try {
        const base = path.join(privateDir(), "skills");
        if (!existsSync(base)) return;
        for (const entry of readdirSync(base))
            if (!keep.includes(entry)) rmSync(path.join(base, entry), { recursive: true, force: true });
    } catch {
        // A courtesy.
    }
}

/**
 * Edits the skill list of one turn: the overlaid skills point at their merged copies, and the skills of dormant companies
 * are left out. Returns a new list; Pi's own skill objects are not changed.
 */
export function applyToPrompt<T extends SkillRef>(
    skills: readonly T[],
    merged: ReadonlyMap<string, string>,
    dormant: ReadonlySet<string>,
): T[] {
    const out: T[] = [];
    for (const skill of skills) {
        if (dormant.has(skill.name)) continue;
        const file = merged.get(skill.name);
        out.push(file === undefined ? skill : { ...skill, filePath: file, baseDir: path.dirname(file) });
    }
    return out;
}
