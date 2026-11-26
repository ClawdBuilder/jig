// How the gateway finds and loads connectors. A connector is a plugin's `connector.ts`: a default export of the shape `ConnectorModule`
// (`engine-tool.ts`) that hands the plugin's tools and its registration to a host that is not Pi.
//
// Which files to load is written down in the package's own `package.json`, under `jig.connectors` (a plugin name and a path), so the gateway
// loads code from a list a person can read and not from a folder it scanned. jig-core names no plugin in an import: the path is computed
// and the file is loaded here, which the boundary test (`boundaries.test.ts`) does not read as an import.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { ConnectorModule } from "../engine-tool.ts";

/** One entry of `jig.connectors`: the plugin's name and the connector file, as an absolute path. */
export interface ConnectorFile {
    name: string;
    file: string;
}

/**
 * Whether `target` is inside `folder` or is the folder. The way from one to the other must not start with `..` as a whole name (a folder named `..assets` is
 * inside) and must not be absolute (on Windows, another drive has no relative way). `api` is for a test that shows the Windows case.
 */
export function isInside(
    folder: string,
    target: string,
    api: Pick<typeof path, "relative" | "isAbsolute" | "sep"> = path,
): boolean {
    const relative = api.relative(folder, target);
    return relative !== ".." && !relative.startsWith(`..${api.sep}`) && !api.isAbsolute(relative);
}

/** A plugin's name is the name of its built file, so it may not hold a path. */
const PLUGIN_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/**
 * The entries of `jig.connectors` in a `package.json`, in the order the file lists them. From source the file is the path in the list: relative to the
 * package's folder, and it stays inside it. Built (`builtFolder` is the folder of the built gateway) it is `connectors/<name>.mjs` in that folder, for the
 * same names: the build writes one file for each entry, so which layout applies is said by the caller and is not guessed from a file name.
 */
export function connectorFiles(packageFile: string | URL, builtFolder?: string | URL): ConnectorFile[] {
    const file = typeof packageFile === "string" ? packageFile : fileURLToPath(packageFile);
    const folder = path.dirname(file);
    const manifest = JSON.parse(readFileSync(file, "utf8")) as { jig?: { connectors?: unknown } };
    const listed = manifest.jig?.connectors;
    if (listed === undefined) return [];
    if (typeof listed !== "object" || listed === null || Array.isArray(listed)) {
        throw new Error("jig.connectors in package.json must be an object of plugin names and paths");
    }
    return Object.entries(listed).map(([name, value]) => {
        if (typeof value !== "string" || value === "") {
            throw new Error(`jig.connectors.${name} in package.json must be a path`);
        }
        if (builtFolder !== undefined) {
            if (!PLUGIN_NAME.test(name)) throw new Error(`jig.connectors.${name} in package.json is not a plugin name`);
            const built = typeof builtFolder === "string" ? builtFolder : fileURLToPath(builtFolder);
            return { name, file: path.join(built, "connectors", `${name}.mjs`) };
        }
        const resolved = path.resolve(folder, value);
        if (!isInside(folder, resolved)) {
            throw new Error(`jig.connectors.${name} in package.json points outside the package`);
        }
        return { name, file: resolved };
    });
}

/** What is wrong with a value that should be a `ConnectorModule`, in one line, or undefined when it has the shape. */
function shapeProblem(value: unknown): string | undefined {
    if (typeof value !== "object" || value === null) return "it has no default export that is an object";
    const connector = value as Record<string, unknown>;
    if (typeof connector.name !== "string" || connector.name === "") return "its name is missing";
    if (!Array.isArray(connector.tools)) return "its tools are not a list";
    for (const tool of connector.tools as unknown[]) {
        const one = tool as Record<string, unknown> | null;
        if (typeof one !== "object" || one === null) return "a tool is not an object";
        for (const key of ["tool", "plugin", "label", "description"]) {
            if (typeof one[key] !== "string" || one[key] === "") return `a tool has no ${key}`;
        }
        if (typeof one.input !== "object" || one.input === null) return `tool ${String(one.tool)} has no input schema`;
        for (const key of ["classify", "execute"]) {
            if (typeof one[key] !== "function") return `tool ${String(one.tool)} has no ${key} function`;
        }
    }
    const kept = connector.notOffered;
    if (kept !== undefined) {
        if (typeof kept !== "object" || kept === null) return "notOffered is not an object";
        for (const actions of Object.values(kept)) {
            if (!Array.isArray(actions) || actions.some((action) => typeof action !== "string")) {
                return "notOffered must name actions as a list of texts for each tool";
            }
        }
    }
    if (connector.register !== undefined && typeof connector.register !== "function")
        return "register is not a function";
    return undefined;
}

/**
 * Loads one connector file and checks its shape. It only imports the file: nothing is registered and nothing is declared, which the
 * gateway does at the first call. A file that cannot be loaded, or that has the wrong shape, throws an error that names the file.
 */
export async function loadConnector(file: string): Promise<ConnectorModule> {
    let loaded: { default?: unknown };
    try {
        loaded = (await import(pathToFileURL(file).href)) as { default?: unknown };
    } catch (error) {
        throw new Error(
            `connector ${file} could not be loaded: ${error instanceof Error ? error.message : String(error)}`,
            {
                cause: error,
            },
        );
    }
    const problem = shapeProblem(loaded.default);
    if (problem !== undefined) throw new Error(`connector ${file} is not a connector: ${problem}`);
    return loaded.default as ConnectorModule;
}
