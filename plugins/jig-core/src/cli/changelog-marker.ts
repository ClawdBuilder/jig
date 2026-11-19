// Keeps Pi's "last changelog shown" marker for Jig across `jig update`. Pi keys that marker in the home's settings.json as
// `extensionChangelogVersions[JSON.stringify({ source, scope })]` (core/source-info.js `getSourcePackageKey`), and Jig's
// own entry is pinned, so every release is a new source and so a new key. Pi reads a key with no saved version as a fresh
// install: it records the current version and shows nothing, so Jig's changelog would never show. After `pi install` moves
// Jig, this file gives the new key the version the person last saw, and drops the keys of the pinned sources that are gone.
// It changes that one field of settings.json and nothing else Pi keeps there, and never another package's key.
import { readFileSync, realpathSync, statSync } from "node:fs";
import path from "node:path";
import { errorMessage } from "../errors.ts";
import { replaceFileDurably } from "../kit/files.ts";
import { compareVersions } from "../pi-version.ts";
import { homeVersion } from "./home.ts";
import { parseNpmSource } from "./packages.ts";

const FIELD = "extensionChangelogVersions";
const VERSION = /^\d+\.\d+\.\d+/;

/** Pi's key for a package source: the source, then the scope, as JSON, in that order (`getSourcePackageKey`). */
export function changelogKey(source: string, scope: "user" | "project"): string {
    return JSON.stringify({ source, scope });
}

function isObject(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The source string of the home's own entry for a package, as Pi lists it in settings.json `packages`. */
function listedSource(settings: Record<string, unknown>, name: string): string | undefined {
    for (const entry of Array.isArray(settings.packages) ? settings.packages : []) {
        const source = typeof entry === "string" ? entry : isObject(entry) ? entry.source : undefined;
        if (typeof source === "string" && parseNpmSource(source)?.name === name) return source;
    }
    return undefined;
}

/** Whether a key is an older user-scope source of the same npm package: another version, or none. */
function isOlderSourceKey(key: string, newKey: string, name: string): boolean {
    if (key === newKey) return false;
    try {
        const parsed: unknown = JSON.parse(key);
        return (
            isObject(parsed) &&
            parsed.scope === "user" &&
            typeof parsed.source === "string" &&
            parseNpmSource(parsed.source)?.name === name
        );
    } catch {
        return false;
    }
}

/** The indent Pi's own save would use, found from the file: its first indented line, else Pi's two spaces. */
function indentOf(text: string): string | number | undefined {
    if (!text.trim().includes("\n")) return undefined;
    return /^([ \t]+)"/m.exec(text)?.[1] ?? 2;
}

/**
 * Moves the marker of a pinned Jig source to the new one. Returns whether the file was written. A missing file,
 * a file without the field, no older Jig key, or no Jig entry in `packages` changes nothing. The value carried is the newest
 * version an older key held that is not newer than `installed`; a value already on the new key is never replaced.
 */
export function carryChangelogMarker(home: string, name: string, installed: string): boolean {
    const link = path.join(home, "settings.json");
    let file: string;
    let text: string;
    try {
        file = realpathSync(link);
        text = readFileSync(file, "utf8");
    } catch {
        return false;
    }
    const body = text.replace(/^﻿/, "");
    let settings: unknown;
    try {
        settings = JSON.parse(body);
    } catch {
        return false;
    }
    if (!isObject(settings) || !isObject(settings[FIELD])) return false;
    const versions = settings[FIELD];
    const source = listedSource(settings, name);
    if (source === undefined) return false;
    const newKey = changelogKey(source, "user");
    const older = Object.keys(versions).filter((key) => isOlderSourceKey(key, newKey, name));
    if (older.length === 0) return false;

    let seen: string | undefined;
    for (const key of older) {
        const value = versions[key];
        if (typeof value !== "string" || !VERSION.test(value) || compareVersions(value, installed) > 0) continue;
        if (seen === undefined || compareVersions(value, seen) > 0) seen = value;
    }
    const carry = seen !== undefined && !versions[newKey];
    const kept = Object.entries(versions)
        .filter(([key]) => !older.includes(key))
        .map(([key, value]): [string, unknown] => [key, carry && key === newKey ? seen : value]);
    if (carry && !(newKey in versions)) kept.push([newKey, seen]);
    settings[FIELD] = Object.fromEntries(kept);

    const trailing = body.endsWith("\n") ? "\n" : "";
    replaceFileDurably(
        file,
        `${text.startsWith("﻿") ? "﻿" : ""}${JSON.stringify(settings, null, indentOf(body))}${trailing}`,
        statSync(file).mode & 0o777,
    );
    return true;
}

/**
 * After `pi install` moved Jig: when the version in the home changed, carries the changelog marker. The update has
 * already succeeded, so a problem here is one line on stderr, never a failed update.
 */
export function keepJigChangelogMarker(home: string, name: string, before: string): void {
    const now = homeVersion(home, name);
    if (now === undefined || now === before) return;
    try {
        carryChangelogMarker(home, name, now);
    } catch (error) {
        process.stderr.write(
            `Jig ${now} is installed, but its changelog marker in ${path.join(home, "settings.json")} could not be moved: ${errorMessage(error)}\n` +
                "Pi may not show Jig's new changelog entries on its next start.\n",
        );
    }
}
