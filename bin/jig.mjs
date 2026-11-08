#!/usr/bin/env node
// The `jig` command. Help and version are answered before Pi or any plugin is imported, so they stay fast and work without Pi.
import { readFileSync } from "node:fs";
import { register } from "node:module";

const args = process.argv.slice(2);
const first = args[0];
const packageVersion = (() => {
    try {
        return JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).version ?? "unknown";
    } catch {
        return "unknown";
    }
})();

if (args.includes("--help") || args.includes("-h")) {
    register(new URL("./jig-strip-hooks.mjs", import.meta.url), import.meta.url);
    const { helpFor, nearestCommand, USAGE } = await import("../plugins/jig-core/src/cli/help.ts");
    const topic = first !== undefined && !first.startsWith("-") && first !== "help" ? first : undefined;
    if (topic === undefined) {
        process.stdout.write(`${USAGE}\n`);
    } else {
        const text = helpFor(topic);
        if (text !== undefined) process.stdout.write(`${text}\n`);
        else {
            const near = nearestCommand(topic);
            process.stderr.write(
                `Unknown command ${topic}.${near ? ` Did you mean jig ${near}?` : ""}\nRun jig --help for the commands.\n`,
            );
            process.exitCode = 2;
        }
    }
} else if (first === "--version" || first === "-v") {
    const json = args.includes("--json");
    const extra = args.filter((word) => word !== "--json");
    if (extra.length > 1) {
        process.stderr.write(`jig --version takes no arguments except --json.\nRun jig --help for usage.\n`);
        process.exitCode = 2;
    } else {
        process.stdout.write(
            json ? `${JSON.stringify({ schema: 1, version: packageVersion })}\n` : `${packageVersion}\n`,
        );
    }
} else if (first === undefined || first === "--help" || first === "-h" || first === "help") {
    register(new URL("./jig-strip-hooks.mjs", import.meta.url), import.meta.url);
    const { helpFor, nearestCommand, USAGE } = await import("../plugins/jig-core/src/cli/help.ts");
    const topic = first === "help" ? args[1] : undefined;
    if (topic === undefined) {
        process.stdout.write(`${USAGE}\n`);
        process.exitCode = first === undefined ? 2 : 0;
    } else if (args.length > 2) {
        process.stderr.write("jig help takes one command name.\nRun jig --help for the commands.\n");
        process.exitCode = 2;
    } else {
        const text = helpFor(topic);
        if (text === undefined) {
            const near = nearestCommand(topic);
            process.stderr.write(
                `Unknown command ${topic}.${near ? ` Did you mean jig ${near}?` : ""}\nRun jig --help for the commands.\n`,
            );
            process.exitCode = 2;
        } else {
            process.stdout.write(`${text}\n`);
        }
    }
} else {
    const { register: registerHook } = await import("node:module");
    registerHook(new URL("./jig-strip-hooks.mjs", import.meta.url), import.meta.url);
    const PI = "@earendil-works/pi-coding-agent";
    const { existsSync } = await import("node:fs");
    const { delimiter, dirname, join } = await import("node:path");
    const { realpathSync } = await import("node:fs");
    const { fileURLToPath } = await import("node:url");
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
        if (named !== undefined) return isPi(named) ? named : undefined;
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
    const host = piHostDir();
    if (host === undefined) {
        process.stderr.write(
            "jig needs Pi installed: install it with npm install -g @earendil-works/pi-coding-agent, or set PI_HOST_DIR to its package folder.\n",
        );
        process.exit(1);
    }
    registerHook(new URL(`./jig-host-hooks.mjs?host=${encodeURIComponent(host)}`, import.meta.url), import.meta.url);
    const { main } = await import("../plugins/jig-core/src/cli/main.ts");
    process.exitCode = await main(args, host);
}
