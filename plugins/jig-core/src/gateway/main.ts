// The gateway: an MCP server over standard input and output that offers Jig's tools to an agent that is not Pi. Run it from source as
// `node plugins/jig-core/src/gateway/main.ts`, or built (`scripts/build-gateway.mjs` bundles this file) as `node plugins/jig-core/dist/jig-gateway.mjs`,
// the file the command `jig-gateway` starts. An agent starts it from its MCP configuration. It serves revision 2026-07-28, and older ones, through
// the SDK's `serveStdio`, which is the only entry that answers the new revision's `server/discover`.
//
// Standard output is the protocol's. Nothing here, and nothing in the engine or a connector it runs, writes to it: a notice goes to standard error.
// When standard input ends the engine's session ends and the process exits with code 0.
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import type { ConnectorModule } from "../engine-tool.ts";
import { errorMessage } from "../errors.ts";
import { jigPackage, packageFile } from "../pi-version.ts";
import { settingsHome } from "../settings-home.ts";
import { connectorFiles, loadConnector } from "./connectors.ts";
import { createGatewayRuntime } from "./runtime.ts";
import { createServerFactory } from "./server.ts";

/**
 * Set by the build (`define` in `scripts/build-gateway.mjs`) to true in the built gateway, and by nothing else: from source the name does not exist. It is
 * how this file knows which layout it is in, said by the build and not guessed from a file name.
 */
declare const BUILT_GATEWAY: boolean | undefined;
const built = typeof BUILT_GATEWAY !== "undefined" && BUILT_GATEWAY;

const usage = (): string => `The Jig gateway: an MCP server over standard input and output.

Usage: ${built ? "jig-gateway" : "main.ts"} [--home <folder>] [--version] [--help]

  --home <folder>  the folder that holds jig.json. Without it the variable JIG_HOME names the folder,
                   and without that the folder ~/.jig is used when it holds a jig.json.
`;

export async function runGateway(argv: readonly string[], env: NodeJS.ProcessEnv): Promise<void> {
    if (argv.includes("--version")) {
        process.stdout.write(`${jigPackage().version ?? "unknown"}\n`);
        return;
    }
    if (argv.includes("--help")) {
        process.stdout.write(usage());
        return;
    }
    const stderr = (line: string): void => void process.stderr.write(`${line}\n`);

    // Loading a connector file only describes its tools. A connector that cannot be loaded leaves its tools out, and `status` says so.
    const connectors: ConnectorModule[] = [];
    const startup: string[] = [];
    // From source the connector files are the paths in package.json; built, they are `connectors/<name>.mjs` beside this file.
    const builtFolder = built ? path.dirname(fileURLToPath(import.meta.url)) : undefined;
    for (const { name, file } of connectorFiles(packageFile(), builtFolder)) {
        try {
            connectors.push(await loadConnector(file));
        } catch (error) {
            stderr(errorMessage(error));
            startup.push(
                `The ${name} connector could not be loaded, so its tools are missing. The gateway's standard error says why.`,
            );
        }
    }

    const runtime = createGatewayRuntime({
        connectors,
        startup,
        settings: settingsHome(argv, env, homedir()),
        env,
        cwd: process.cwd(),
        stderr,
    });
    serveStdio(createServerFactory(runtime, jigPackage().version ?? "0.0.0"), {
        onerror: (error) => stderr(`mcp: ${errorMessage(error)}`),
    });
    // The agent closed its end: end the session, and leave.
    process.stdin.once("end", () => {
        void runtime
            .stop()
            .catch(() => undefined)
            .then(() => process.exit(0));
    });
}

if (import.meta.main) await runGateway(process.argv.slice(2), process.env);
