// The folder jig-api keeps its own files in: private, below jig-core's state folder, and never changing that folder's mode.
import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { apiStateDir, makePrivateDir, stateDir } from "../src/state.ts";

const modeOf = (dir: string): number => statSync(dir).mode & 0o777;

test("makePrivateDir makes api/ and its own folders 0700, and leaves jig-core's state folder as it was", () => {
    const saved = process.env.JIG_STATE_DIR;
    const root = mkdtempSync(path.join(tmpdir(), "jig-api-state-"));
    const state = path.join(root, "jig");
    mkdirSync(state);
    chmodSync(state, 0o755);
    process.env.JIG_STATE_DIR = state;
    try {
        const dir = makePrivateDir("postman-cloud");
        assert.equal(stateDir(), state);
        assert.equal(dir, path.join(state, "api", "postman-cloud"));
        assert.equal(apiStateDir("postman-cloud"), dir, "the folder asked for and the folder made agree");
        assert.equal(modeOf(dir), 0o700);
        assert.equal(modeOf(path.join(state, "api")), 0o700);
        assert.equal(modeOf(state), 0o755, "jig-core's own folder keeps its mode");
        // A file left by an older version still sits in a folder that is now private.
        writeFileSync(path.join(dir, "cache.json"), "{}\n");
        chmodSync(dir, 0o755);
        assert.equal(makePrivateDir("postman-cloud"), dir);
        assert.equal(modeOf(dir), 0o700, "an existing folder is tightened");
    } finally {
        if (saved === undefined) delete process.env.JIG_STATE_DIR;
        else process.env.JIG_STATE_DIR = saved;
        rmSync(root, { recursive: true, force: true });
    }
});
