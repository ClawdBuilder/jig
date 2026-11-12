#!/usr/bin/env node
// The `jig` command: Pi for the Jig home, `~/.jig` or JIG_HOME. It hands over to the Jig installed in the home, so a global
// copy, a checkout and npx all run that one version, then routes on the first word:
//   doctor, setup, update   Jig's own commands (see plugins/jig-core/src/cli/main.ts)
//   help, --help, -h        Jig's help
//   --version, -v           Jig's version
//   --                      Pi, with the words after it
//   install, remove, uninstall, list, config, auth, mcp
//                           Pi's own command, through Jig's launcher
//   anything else           Pi: no word, a flag, or a message in one word with spaces
// Help and version are answered before Pi or any plugin is imported, so they stay fast and work without Pi.
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PI = "@earendil-works/pi-coding-agent";
const JIG = "@clawdbuilder/jig";
const JIG_COMMANDS = new Set(["doctor", "setup", "update"]);
const args = process.argv.slice(2);
const first = args[0];
const self = fileURLToPath(import.meta.url);
const packageVersion = (() => {
    try {
        return JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).version ?? "unknown";
    } catch {
        return "unknown";
    }
})();

// --- The home, before anything else. `jig` is Pi for this folder and ignores an outer PI_CODING_AGENT_DIR.
const home = (() => {
    const named = process.env.JIG_HOME?.trim();
    return named === undefined || named === "" ? path.join(homedir(), ".jig") : path.resolve(named);
})();
process.env.PI_CODING_AGENT_DIR = home;

const real = (file) => {
    try {
        return realpathSync(file);
    } catch {
        return undefined;
    }
};

// --- One Jig version: a copy started from anywhere else runs the home's copy, with the same arguments and the home set.
const homeCommand = path.join(home, "npm", "node_modules", JIG, "bin", "jig.mjs");
if (real(homeCommand) !== undefined && real(homeCommand) !== real(self)) {
    const handed = spawnSync(process.execPath, [homeCommand, ...args], { stdio: "inherit", env: process.env });
    process.exit(handed.status ?? 1);
}

// --- No Jig in the home: only the bootstrap, the help and the version can run.
if (!existsSync(homeCommand) && !["setup", "help", "--help", "-h", "--version", "-v"].includes(first ?? "")) {
    process.stderr.write(`Jig is not installed in ${home}. Run: npx ${JIG} setup\n`);
    process.exit(2);
}

/** Pi for this home, through the launcher, which sets nothing and finds the stock Pi on PATH itself. */
function startPi(words) {
    const launcher = fileURLToPath(new URL("./pi", import.meta.url));
    const result = spawnSync(launcher, words, {
        stdio: "inherit",
        env: { ...process.env, PI_CODING_AGENT_DIR: home, JIG_COMMAND: "jig" },
    });
    if (result.error !== undefined) {
        process.stderr.write(`jig could not start Pi's launcher (${launcher}): ${result.error.message}\n`);
        process.exit(1);
    }
    process.exit(result.status ?? 1);
}

/** The host hooks and the type stripping every Jig command needs: Pi's packages, and TypeScript from node_modules. */
async function loadHooks() {
    const strip = await import("./jig-strip-hooks.mjs");
    const { register, registerHooks } = await import("node:module");
    const named = process.env.JIG_PI_HOST ?? process.env.PI_HOST_DIR;
    const isPi = (folder) => {
        try {
            return JSON.parse(readFileSync(path.join(folder, "package.json"), "utf8")).name === PI;
        } catch {
            return false;
        }
    };
    const host = (() => {
        if (named !== undefined && isPi(named)) return named;
        const globalRoot = path.join(path.dirname(process.execPath), "..", "lib", "node_modules", ...PI.split("/"));
        if (isPi(globalRoot)) return globalRoot;
        for (const folder of (process.env.PATH ?? "").split(path.delimiter)) {
            const candidate = path.join(folder, "pi");
            if (!existsSync(candidate)) continue;
            let resolved;
            try {
                resolved = realpathSync(candidate);
            } catch {
                continue;
            }
            let dir = path.dirname(resolved);
            for (let level = 0; level < 8; level++) {
                if (isPi(dir)) return dir;
                const parent = path.dirname(dir);
                if (parent === dir) break;
                dir = parent;
            }
        }
        return undefined;
    })();
    if (host === undefined) {
        if (typeof registerHooks === "function") registerHooks({ load: strip.loadTypescript });
        else register(new URL("./jig-strip-hooks.mjs", import.meta.url), import.meta.url);
        return;
    }
    const hostHooks = await import(
        new URL(`./jig-host-hooks.mjs?host=${encodeURIComponent(host)}`, import.meta.url).href
    );
    if (typeof registerHooks === "function") {
        registerHooks({ resolve: hostHooks.resolve, load: strip.loadTypescript });
    } else {
        register(new URL("./jig-strip-hooks.mjs", import.meta.url), import.meta.url);
        register(new URL(`./jig-host-hooks.mjs?host=${encodeURIComponent(host)}`, import.meta.url), import.meta.url);
    }
}

async function loadHelp() {
    const { register, registerHooks } = await import("node:module");
    const hooks = await import("./jig-strip-hooks.mjs");
    if (typeof registerHooks === "function") registerHooks({ load: hooks.loadTypescript });
    else register(new URL("./jig-strip-hooks.mjs", import.meta.url), import.meta.url);
    return import("../plugins/jig-core/src/cli/help.ts");
}

/** `jig --help` and `jig help <command>`: the words, with no Pi and no plugin loaded. */
async function help(words) {
    const { helpFor, nearestCommand, USAGE } = await loadHelp();
    const topic = words[0];
    if (topic === undefined) {
        process.stdout.write(`${USAGE}\n`);
        process.exit(0);
    }
    if (words.length > 1) {
        process.stderr.write("jig help takes one command name.\nRun jig --help for the commands.\n");
        process.exit(2);
    }
    const text = helpFor(topic);
    if (text !== undefined) {
        process.stdout.write(`${text}\n`);
        process.exit(0);
    }
    const near = nearestCommand(topic);
    process.stderr.write(
        `Unknown command ${topic}.${near === undefined ? "" : ` Did you mean jig ${near}?`}\nRun jig --help for the commands.\n`,
    );
    process.exit(2);
}

if (first === undefined || first === "--") {
    startPi(first === "--" ? args.slice(1) : args);
} else if (first === "-h" || first === "--help") {
    await help([]);
} else if (first === "-v" || first === "--version") {
    const json = args.includes("--json");
    const extra = args.slice(1).filter((word) => word !== "--json");
    if (extra.length > 0) {
        process.stderr.write("jig --version takes no arguments except --json.\nRun jig --help for usage.\n");
        process.exit(2);
    }
    process.stdout.write(json ? `${JSON.stringify({ schema: 1, version: packageVersion })}\n` : `${packageVersion}\n`);
} else if (first === "help") {
    await help(args.slice(1));
} else if (JIG_COMMANDS.has(first)) {
    await loadHooks();
    let main;
    try {
        main = await import("../plugins/jig-core/src/cli/main.ts");
    } catch (error) {
        process.stderr.write(`jig ${first} could not start: ${String(error?.message ?? error)}\n`);
        process.exit(1);
    }
    process.exit(await main.run(first, args.slice(1)));
} else {
    // Pi's own command, a flag, or a message: Pi with the home, through the launcher.
    startPi(args);
}
