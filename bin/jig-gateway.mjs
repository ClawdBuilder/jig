#!/usr/bin/env node
// The start file of the command `jig-gateway`: the Jig gateway, an MCP server over standard input and output, for an agent that is not Pi. Plain
// JavaScript on purpose: no type stripper, no Jig home and no Pi, so it starts as fast as Node does and works from a bare install. It loads the built gateway
// (plugins/jig-core/dist/jig-gateway.mjs, which `npm run build:gateway` writes and the package ships) and runs it.
//
// The built file is found from this file's own location. Node gives a module its real path, so this holds when npm starts the file through the link it makes in
// a bin folder.
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const gateway = new URL("../plugins/jig-core/dist/jig-gateway.mjs", import.meta.url);
if (!existsSync(fileURLToPath(gateway))) {
    process.stderr.write(
        "jig-gateway: the built gateway is missing. Run `npm run build:gateway` in the Jig repository, or reinstall the package.\n",
    );
    process.exit(1);
}

const { runGateway } = await import(gateway.href);
await runGateway(process.argv.slice(2), process.env);
