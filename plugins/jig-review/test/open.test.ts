// Opening the review page: `$BROWSER` is split into a program and arguments, the same way jig-core splits it for its
// preview pages, so a value with arguments opens instead of being looked up as one long program name.
import assert from "node:assert/strict";
import { test } from "node:test";
import { openUrl } from "../src/open.ts";

test("$BROWSER is a program and arguments, and %s stands for the address", async () => {
    const started: Array<{ program: string; args: string[] }> = [];
    const launch = (program: string, args: string[]) => void started.push({ program, args });

    await openUrl("http://localhost:1234/review", { BROWSER: "firefox --new-window" }, launch);
    assert.deepEqual(started, [{ program: "firefox", args: ["--new-window", "http://localhost:1234/review"] }]);

    started.length = 0;
    await openUrl("http://localhost:1234/review", { BROWSER: "chromium --app=%s" }, launch);
    assert.deepEqual(started, [{ program: "chromium", args: ["--app=http://localhost:1234/review"] }]);
});

test("with no $BROWSER the platform's opener is used", async () => {
    const started: string[] = [];
    await openUrl("http://localhost:1234/review", {}, (program) => void started.push(program));
    assert.deepEqual(started, [process.platform === "darwin" ? "open" : "xdg-open"]);
});
