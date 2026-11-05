// Node refuses to strip types for a file under node_modules, which is exactly where a globally installed jig lives. This
// hook reads each .ts file itself and strips its types, so the package runs from node_modules like it does from a checkout.
// No dependency: `stripTypeScriptTypes` is part of Node (Jig needs 22.19 or later).
import { readFile } from "node:fs/promises";
import { stripTypeScriptTypes } from "node:module";

// The warning is raised in this loader thread, so the main script's filter does not reach it: drop the default printer here.
process.removeAllListeners("warning");
process.on("warning", () => {});

export async function load(url, context, nextLoad) {
    if (url.startsWith("file:") && url.endsWith(".ts")) {
        const source = await readFile(new URL(url), "utf8");
        return { format: "module", source: stripTypeScriptTypes(source, { mode: "strip" }), shortCircuit: true };
    }
    return nextLoad(url, context);
}
