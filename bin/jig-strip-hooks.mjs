// Node refuses to strip types for a file under node_modules, which is exactly where a globally installed jig lives. This
// hook reads each .ts file itself and strips its types, so the package runs from node_modules like it does from a checkout.
// It is synchronous so `module.registerHooks` can use it in-thread on Node 22.19+; `module.register` gets the same function.
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";

export function loadTypescript(url, context, nextLoad) {
    if (url.startsWith("file:") && url.endsWith(".ts")) {
        const source = readFileSync(new URL(url), "utf8");
        if (url.includes("/node_modules/"))
            return { format: "module", source: stripTypeScriptTypes(source, { mode: "strip" }), shortCircuit: true };
        return { format: "module-typescript", source, shortCircuit: true };
    }
    return nextLoad(url, context);
}

export function load(url, context, nextLoad) {
    if (url.startsWith("file:") && url.endsWith(".ts")) {
        const source = readFileSync(new URL(url), "utf8");
        return { format: "module", source: stripTypeScriptTypes(source, { mode: "strip" }), shortCircuit: true };
    }
    return nextLoad(url, context);
}
