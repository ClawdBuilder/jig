// Writes the gateway as plain JavaScript, so that a program with no type stripper and no installed dependency can run it (`npm run build:gateway`):
//   plugins/jig-core/dist/jig-gateway.mjs        the engine, the gateway, the MCP SDK and `marked`, in one file
//   plugins/jig-core/dist/connectors/<name>.mjs  one file for each entry of `jig.connectors` in package.json, with TypeBox inside
//   plugins/jig-core/dist/tools.json             what a model is shown: the tools as the built gateway lists them, and the connector of each
//   plugins/jig-core/dist/theme.css              a copy of plugins/jig-core/src/kit/theme.css, which kit/theme.ts reads beside the bundle
// The files are committed. `--check` builds again into a temporary folder and compares every file with the committed one, byte for byte (`npm run check`
// runs it). `--out <folder>` writes to another folder, or, with `--check`, compares with it. Run from anywhere: the repository root is found from this file.
import { spawn } from "node:child_process";
import {
    existsSync,
    mkdirSync,
    mkdtempSync,
    readdirSync,
    readFileSync,
    rmSync,
    statSync,
    writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

const root = path.resolve(import.meta.dirname, "..");
const DIST = "plugins/jig-core/dist";
const GATEWAY = "plugins/jig-core/src/gateway/main.ts";
const THEME = "plugins/jig-core/src/kit/theme.css";
const REBUILD = "node scripts/build-gateway.mjs";
/** What a bundle of ES modules needs where a dependency of its own still calls `require`. Phase 0 measured this form. */
const REQUIRE_BANNER = 'import { createRequire as __cr } from "node:module"; const require = __cr(import.meta.url);';
/** A connector's name becomes the name of its file, so it may not hold a path. */
const CONNECTOR_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
/** The request that asks a gateway for its tools, in the form of revision 2026-07-28. */
const LIST_REQUEST = {
    jsonrpc: "2.0",
    id: 1,
    method: "tools/list",
    params: {
        _meta: {
            "io.modelcontextprotocol/protocolVersion": "2026-07-28",
            "io.modelcontextprotocol/clientCapabilities": {},
            "io.modelcontextprotocol/clientInfo": { name: "jig-build", version: "0" },
        },
    },
};

const manifest = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));

/** The oldest Node.js the package runs on, as esbuild names it: `>=22.19.0` gives `node22.19.0`, so the output uses nothing newer. */
function nodeTarget() {
    const found = /\d+\.\d+\.\d+/.exec(manifest.engines?.node ?? "");
    if (found === null) throw new Error('package.json needs "engines.node" with a version, such as ">=22.19.0"');
    return `node${found[0]}`;
}

/** The entries of `jig.connectors`: the plugin's name and the source file of its connector. */
function connectorList() {
    const listed = manifest.jig?.connectors ?? {};
    return Object.entries(listed).map(([name, source]) => {
        if (!CONNECTOR_NAME.test(name) || typeof source !== "string" || source === "") {
            throw new Error(`jig.connectors.${name} in package.json must be a plugin name and a path`);
        }
        return { name, source };
    });
}

/**
 * One file of JavaScript from one entry, with everything it needs inside. Notes on the options, all of them measured:
 * - The repository root is the working folder, so that the path comments in the output are relative to it and name no machine.
 * - `tsconfigRaw` is empty: the root tsconfig.json maps `typebox` and the Pi packages to a private copy of Pi, and esbuild would follow it.
 * - A Pi package is external, so that an import of one would stay in the output as a bare import, which the build test refuses.
 * - No minifying, no source map, no legal comments: the file is read in review, and the same sources give the same bytes.
 */
async function bundle(entry, options = {}) {
    const result = await build({
        absWorkingDir: root,
        entryPoints: [entry],
        outfile: "bundle.mjs",
        write: false,
        bundle: true,
        platform: "node",
        format: "esm",
        target: nodeTarget(),
        external: ["@earendil-works/*"],
        tsconfigRaw: "{}",
        legalComments: "none",
        minify: false,
        sourcemap: false,
        banner: { js: REQUIRE_BANNER },
        logLevel: "warning",
        ...options,
    });
    return Buffer.from(result.outputFiles[0].contents);
}

/** Asks a built gateway for its tools, as an agent would, and waits for it to leave when its input ends. */
function askForTools(gateway, folder) {
    return new Promise((resolve, reject) => {
        const child = spawn(process.execPath, [gateway], {
            cwd: folder,
            env: { PATH: process.env.PATH ?? "", HOME: folder },
            stdio: ["pipe", "pipe", "pipe"],
        });
        let out = "";
        let err = "";
        let answer;
        const timer = setTimeout(() => child.kill(), 30_000);
        child.stderr.on("data", (chunk) => {
            err += chunk;
        });
        child.stdout.on("data", (chunk) => {
            out += chunk;
            const end = out.indexOf("\n");
            if (end < 0 || answer !== undefined) return;
            answer = JSON.parse(out.slice(0, end));
            child.stdin.end();
        });
        child.on("error", reject);
        child.on("close", (code) => {
            clearTimeout(timer);
            if (answer?.result?.tools === undefined || code !== 0) {
                reject(
                    new Error(`the built gateway did not list its tools (exit ${code}): ${err.trim() || out.trim()}`),
                );
            } else if (answer.result.nextCursor !== undefined) {
                reject(
                    new Error(
                        "the built gateway lists its tools on more than one page, which tools.json does not hold",
                    ),
                );
            } else {
                resolve(answer.result.tools);
            }
        });
        child.stdin.write(`${JSON.stringify(LIST_REQUEST)}\n`);
    });
}

/**
 * Makes every file of the output in a folder that has the layout of the package, `plugins/jig-core/dist` below a copy of package.json, because the
 * gateway finds its connector files and its version from there. The tool list is asked of the built gateway in that folder: it is what an agent is shown.
 */
async function makeIn(scratch) {
    const dist = path.join(scratch, DIST);
    mkdirSync(path.join(dist, "connectors"), { recursive: true });
    writeFileSync(path.join(scratch, "package.json"), readFileSync(path.join(root, "package.json")));
    writeFileSync(path.join(dist, "jig-gateway.mjs"), await bundle(GATEWAY, { define: { BUILT_GATEWAY: "true" } }));
    // TypeBox stays a peer dependency of the package (Pi supplies it), so each connector file carries its own copy.
    for (const { name, source } of connectorList()) {
        writeFileSync(path.join(dist, "connectors", `${name}.mjs`), await bundle(source));
    }
    writeFileSync(path.join(dist, "theme.css"), readFileSync(path.join(root, THEME)));

    // The gateway's own tool, `jig`, comes from no connector file: the runtime calls its connector jig-core.
    const owners = new Map();
    for (const { name } of connectorList()) {
        const file = path.join(dist, "connectors", `${name}.mjs`);
        const connector = (await import(pathToFileURL(file).href)).default;
        for (const tool of connector.tools) owners.set(tool.tool, name);
    }
    const tools = (await askForTools(path.join(dist, "jig-gateway.mjs"), scratch))
        .map((tool) => ({
            name: tool.name,
            title: tool.title,
            description: tool.description,
            inputSchema: tool.inputSchema,
            connector: owners.get(tool.name) ?? "jig-core",
        }))
        .sort((a, b) => (a.name < b.name ? -1 : 1));
    writeFileSync(path.join(dist, "tools.json"), `${JSON.stringify(tools, null, 4)}\n`);
    return dist;
}

/** Every file below `folder`, by path relative to it with forward slashes, sorted. */
function filesUnder(folder) {
    if (!existsSync(folder)) return [];
    return readdirSync(folder, { recursive: true })
        .map((entry) => String(entry).split(path.sep).join("/"))
        .filter((entry) => statSync(path.join(folder, entry)).isFile())
        .sort();
}

function sizeOf(file) {
    return `${(statSync(file).size / 1024).toFixed(0)} KB`;
}

function argumentsOf(args) {
    const options = { check: false, out: path.join(root, DIST) };
    for (let index = 0; index < args.length; index++) {
        const arg = args[index];
        if (arg === "--check") options.check = true;
        else if (arg === "--out" && args[index + 1] !== undefined) options.out = path.resolve(args[++index]);
        else throw new Error(`unknown argument ${arg}. Usage: ${REBUILD} [--check] [--out <folder>]`);
    }
    return options;
}

async function main() {
    const options = argumentsOf(process.argv.slice(2));
    const shown = path.relative(root, options.out) || ".";
    const scratch = mkdtempSync(path.join(tmpdir(), "jig-gateway-build-"));
    try {
        const made = await makeIn(scratch);
        const now = filesUnder(made);
        if (options.check) {
            const before = filesUnder(options.out);
            const problems = [
                ...before
                    .filter((file) => !now.includes(file))
                    .map((file) => `${file}: is there, but the build does not make it`),
                ...now
                    .filter((file) => !before.includes(file))
                    .map((file) => `${file}: is made by the build, but is not there`),
                ...now
                    .filter((file) => before.includes(file))
                    .filter(
                        (file) =>
                            !readFileSync(path.join(made, file)).equals(readFileSync(path.join(options.out, file))),
                    )
                    .map((file) => `${file}: differs from the build`),
            ];
            if (problems.length > 0) {
                console.error(
                    `${shown} is not what the sources build to:\n  ${problems.join("\n  ")}\nrun \`${REBUILD}\` and commit ${shown}/`,
                );
                process.exitCode = 1;
            } else {
                console.log(`${shown} is current: ${now.length} files, identical to a fresh build`);
            }
            return;
        }
        // The connectors folder is all generated, so a connector that is gone leaves no file behind.
        rmSync(path.join(options.out, "connectors"), { recursive: true, force: true });
        for (const file of now) {
            mkdirSync(path.dirname(path.join(options.out, file)), { recursive: true });
            writeFileSync(path.join(options.out, file), readFileSync(path.join(made, file)));
        }
        console.log(
            `wrote ${now.length} files to ${shown}: ${now.map((file) => `${file} (${sizeOf(path.join(made, file))})`).join(", ")}`,
        );
    } finally {
        rmSync(scratch, { recursive: true, force: true });
    }
}

try {
    await main();
} catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 2;
}
