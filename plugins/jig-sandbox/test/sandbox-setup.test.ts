// Session folders live under the system temp folder. A session can run for days without touching its folder, so time
// alone must never delete it; only a dead owner does. A folder a reaper removed while the session lives is recreated.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, test } from "node:test";
import { nodeFiles } from "../src/files.ts";
import { ensureSessionFolders, makeSessionFolders } from "../src/sandbox-setup.ts";

const ROOT = path.resolve(import.meta.dirname, "../../..");
const roots: string[] = [];

function tempRoot(): string {
    const root = mkdtempSync(path.join(tmpdir(), "jig-sessions-"));
    roots.push(root);
    return root;
}

afterEach(() => {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function deps(tmpRoot: string, now = Date.now()): Parameters<typeof makeSessionFolders>[0] {
    return { tmpRoot, uid: process.getuid?.() ?? 1000, files: nodeFiles, now: () => now };
}

describe("session folders", () => {
    test("a live owner past the old 24-hour limit keeps its folder", async () => {
        const tmpRoot = tempRoot();
        const day = 24 * 60 * 60 * 1_000;
        const script = `
            import { makeSessionFolders } from ${JSON.stringify(path.join(ROOT, "plugins/jig-sandbox/src/sandbox-setup.ts"))};
            import { nodeFiles } from ${JSON.stringify(path.join(ROOT, "plugins/jig-sandbox/src/files.ts"))};
            const folder = makeSessionFolders({ tmpRoot: ${JSON.stringify(tmpRoot)}, uid: ${process.getuid?.() ?? 1000}, files: nodeFiles, now: () => Date.now() }, "older");
            process.stdout.write(folder + "\\n");
            setInterval(() => {}, 1000);
        `;
        const child = spawn(process.execPath, ["--input-type=module", "-e", script], { cwd: ROOT });
        const folder = await new Promise<string>((resolve, reject) => {
            let text = "";
            const timer = setTimeout(() => reject(new Error("child did not name its folder")), 10_000);
            child.stdout.on("data", (chunk: Buffer) => {
                text += chunk.toString();
                const line = text.split("\n")[0];
                if (line) {
                    clearTimeout(timer);
                    resolve(line);
                }
            });
            child.on("error", reject);
        });
        assert.ok(existsSync(folder));
        const now = Date.now() + day * 2;
        const second = makeSessionFolders(deps(tmpRoot, now), "newer");
        assert.ok(existsSync(folder), "the older live session's folder stays");
        assert.ok(existsSync(second));
        child.kill("SIGKILL");
        await new Promise((resolve) => child.once("exit", resolve));
        makeSessionFolders(deps(tmpRoot, now), "third");
        assert.equal(existsSync(folder), false, "the dead owner's folder goes");
    });

    test("a folder with no owner record is left alone", () => {
        const tmpRoot = tempRoot();
        const folder = makeSessionFolders(deps(tmpRoot), "gone");
        rmSync(path.join(folder, "owner"), { force: true });
        makeSessionFolders(deps(tmpRoot, Date.now() + 48 * 3_600_000), "next");
        assert.ok(existsSync(folder), "cannot be proved dead, so it is not removed");
    });

    test("a root that another user or the world can enter is refused", () => {
        const tmpRoot = tempRoot();
        const folder = path.join(tmpRoot, "jig-sandbox-1000", "session");
        mkdirSync(path.dirname(folder), { recursive: true, mode: 0o700 });
        chmodSync(path.dirname(folder), 0o777);
        assert.throws(() => ensureSessionFolders(folder), /not a private folder owned by this user/);
    });

    test("a session folder that vanished is recreated for a restart", () => {
        const tmpRoot = tempRoot();
        const folder = path.join(tmpRoot, "jig-sandbox-1000", "lost-session");
        ensureSessionFolders(folder);
        assert.ok(existsSync(path.join(folder, "broker")));
        assert.ok(existsSync(path.join(folder, "tmp")));
        assert.match(readFileSync(path.join(folder, "owner"), "utf8"), new RegExp(`^${process.pid} `));
        rmSync(folder, { recursive: true, force: true });
        ensureSessionFolders(folder);
        assert.ok(existsSync(path.join(folder, "broker")));
        assert.ok(existsSync(path.join(folder, "tmp")));
    });
});
