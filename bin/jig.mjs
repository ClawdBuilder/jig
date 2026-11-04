#!/usr/bin/env node
// The `jig` command: doctor and setup from a terminal, with no Pi session. The implementation is TypeScript in the package,
// which Node runs directly (the same way Pi runs the plugins). Pi's own packages are found beside the installed `pi`
// program when the jig package does not carry them, as a package installed by `pi install` does not.
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { register } from "node:module";
import { delimiter, dirname, join } from "node:path";

// A globally installed package lives under node_modules, where Node will not strip TypeScript itself. The hook below does
// it, and says so without the experimental warning Node prints for the API it uses.
process.removeAllListeners("warning");
process.on("warning", (warning) => {
    if (/stripTypeScriptTypes|Type Stripping|type stripping/i.test(warning.message)) return;
    process.stderr.write(`${warning.stack ?? warning.message}\n`);
});
register(new URL("./jig-strip-hooks.mjs", import.meta.url), import.meta.url);

const PI = "@earendil-works/pi-coding-agent";

/** The package.json of a folder that is Pi, or undefined. */
function isPi(folder) {
    const manifest = join(folder, "package.json");
    if (!existsSync(manifest)) return false;
    try {
        return JSON.parse(readFileSync(manifest, "utf8")).name === PI;
    } catch {
        return false;
    }
}

function piHostDir() {
    const named = process.env.JIG_PI_HOST ?? process.env.PI_HOST_DIR;
    if (named !== undefined && isPi(named)) return named;
    // Next to the node this runs on: npm's global folder, where `npm install -g` puts Pi (nvm, the usual mac and Linux
    // layouts). This is the common case and does not depend on PATH holding anything but `pi`'s name.
    const globalRoot = join(dirname(process.execPath), "..", "lib", "node_modules", PI);
    if (isPi(globalRoot)) return globalRoot;
    for (const folder of (process.env.PATH ?? "").split(delimiter)) {
        const candidate = join(folder, "pi");
        if (!existsSync(candidate)) continue;
        let real;
        try {
            real = realpathSync(candidate);
        } catch {
            continue;
        }
        let dir = dirname(real);
        for (let level = 0; level < 8; level++) {
            const manifest = join(dir, "package.json");
            if (existsSync(manifest)) {
                try {
                    if (JSON.parse(readFileSync(manifest, "utf8")).name === PI) return dir;
                } catch {
                    // Keep walking.
                }
            }
            const parent = dirname(dir);
            if (parent === dir) break;
            dir = parent;
        }
    }
    return undefined;
}

try {
    // Resolvable from here (a checkout with the host packages linked, a global install beside Pi): nothing to map.
    await import.meta.resolve?.(PI);
} catch {
    const host = piHostDir();
    if (host === undefined) {
        process.stderr.write(
            "jig needs Pi installed: install it with npm install -g @earendil-works/pi-coding-agent, or set PI_HOST_DIR to its package folder.\n",
        );
        process.exit(1);
    }
    // The hook runs on Node's loader thread, which does not see a variable set now: the folder travels in its URL.
    register(new URL(`./jig-host-hooks.mjs?host=${encodeURIComponent(host)}`, import.meta.url), import.meta.url);
}

const { main } = await import("../plugins/jig-core/src/cli/main.ts");
process.exitCode = await main(process.argv.slice(2));
