// The public request format: a reader writes one JSON file; jig-session takes it. Import this from the published package,
// never from Jig's src/. The TypeScript copy beside it is what the session itself uses.
import { randomBytes } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync } from "node:fs";
import path from "node:path";

export const REQUEST_SCHEMA = 1;
export const MAX_REQUEST_BYTES = 64 * 1024;
const ID = /^[A-Za-z0-9._:-]{1,100}$/;
const NAME = /^[A-Za-z0-9_.:/-]{1,128}$/;
const isRec = (value) => typeof value === "object" && value !== null && !Array.isArray(value);

export function parseRequest(text) {
    let raw;
    try {
        raw = JSON.parse(text);
    } catch {
        return { error: "the request is not JSON" };
    }
    if (!isRec(raw)) return { error: "the request is not an object" };
    if (raw.schema !== REQUEST_SCHEMA) return { error: `the request's schema is not ${REQUEST_SCHEMA}` };
    const id = typeof raw.id === "string" && ID.test(raw.id) ? raw.id : null;
    const switches = (field) => {
        const value = raw[field];
        if (value === undefined) return {};
        if (!isRec(value)) return `"${field}" must map names to true or false`;
        const out = {};
        for (const [name, on] of Object.entries(value)) {
            if (typeof on !== "boolean" || !NAME.test(name)) return `"${field}" must map names to true or false`;
            out[name] = on;
        }
        return out;
    };
    const tools = switches("tools"),
        skills = switches("skills");
    if (typeof tools === "string") return { error: tools };
    if (typeof skills === "string") return { error: skills };
    if (raw.reload !== undefined && typeof raw.reload !== "boolean") return { error: '"reload" must be true or false' };
    return { request: { schema: REQUEST_SCHEMA, id, tools, skills, reload: raw.reload === true } };
}

export function takeRequest(file) {
    const taken = `${file}.${process.pid}.${randomBytes(4).toString("hex")}.taking`;
    try {
        renameSync(file, taken);
    } catch {
        return undefined;
    }
    try {
        if (statSync(taken).size > MAX_REQUEST_BYTES) return null;
        return readFileSync(taken, "utf8");
    } catch {
        return undefined;
    } finally {
        rmSync(taken, { force: true });
    }
}

export function ensureRequestsDir(dir) {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
}

export function sweepRequests(dir, live, keep, now = Date.now()) {
    let names;
    try {
        names = readdirSync(dir);
    } catch {
        return [];
    }
    const removed = [];
    for (const name of names) {
        if (name === keep) continue;
        const file = path.join(dir, name);
        let old = false;
        try {
            old = now - statSync(file).mtimeMs > 60_000;
        } catch {
            continue;
        }
        const stray = name.endsWith(".json") ? !live(name) : old;
        if (stray) {
            rmSync(file, { force: true });
            removed.push(name);
        }
    }
    return removed;
}
