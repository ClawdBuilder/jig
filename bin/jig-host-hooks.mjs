// The `jig` command needs Pi's own packages (the extension API, the terminal components) exactly as Pi maps them for an
// extension. When they are not resolvable from the jig package, bin/jig.mjs finds the installed Pi and names it here.
const hostDir = process.env.JIG_PI_HOST;
const host = /^(?:typebox|@earendil-works\/pi-(?:coding-agent|tui|ai|agent-core))(?:\/|$)/;

export async function resolve(specifier, context, next) {
    if (hostDir === undefined || hostDir === "" || !host.test(specifier)) return next(specifier, context);
    return next(specifier, { ...context, parentURL: new URL(`file://${hostDir}/host.mjs`).href });
}
