// What the stock Pi calls each extension in its start-up list and its extension pickers. Pi builds that label in its interactive mode,
// as a private method, and no request of its RPC mode returns it. So this asks Pi's own code, with the input Pi gives it: each
// extension's file and its source information (what `get_commands` and `getAllTools` report as `sourceInfo`).
//
// Pi's rule, read in dist/modes/interactive/interactive-mode.js (Pi 1.4): a local extension is named by the shortest end of its path
// that no other extension shares, after a trailing index.ts is dropped, so `plugins/jig-core/src/index.ts` is `jig-core/src` and
// `plugins/jig-core/index.ts` is `jig-core`. An extension from a git or npm package is `<package>:<its folder in the package>`.
import path from "node:path";
import { pathToFileURL } from "node:url";

/** The labels for `extensions` ({ path, sourceInfo }), in the same order, as the Pi in `piDir` shows them. */
export async function extensionLabels(piDir, extensions) {
    const file = path.join(piDir, "dist/modes/interactive/interactive-mode.js");
    const { InteractiveMode } = await import(pathToFileURL(file).href);
    const method = InteractiveMode?.prototype?.getCompactExtensionLabels;
    if (typeof method !== "function") {
        throw new Error(
            `The Pi at ${piDir} has no InteractiveMode.getCompactExtensionLabels, so it labels extensions another way now: update test/support/pi-labels.mjs`,
        );
    }
    // The method uses only other methods of its class, so an object that has the prototype and nothing else is enough.
    return method.call(Object.create(InteractiveMode.prototype), extensions);
}
