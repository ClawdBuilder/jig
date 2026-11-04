// The program and arguments that open an address: what `$BROWSER` says, else the platform's opener. Shared by
// jig-core's preview pages and jig-review's review page, so a user who sets `BROWSER="firefox --new-window"` gets the
// same split in both places.

/** The program and arguments that open `url`: `$BROWSER` when set (a program name, optionally followed by plain
 *  arguments, with `%s` standing for the address), else `open` on macOS and `xdg-open` elsewhere. */
export function browserCommand(
    url: string,
    env: NodeJS.ProcessEnv = process.env,
    platform: NodeJS.Platform = process.platform,
): { program: string; args: string[] } {
    const configured = env.BROWSER?.trim();
    const chosen =
        configured !== undefined && configured !== ""
            ? configured.split(/\s+/)
            : [platform === "darwin" ? "open" : "xdg-open"];
    const [program, ...rest] = chosen as [string, ...string[]];
    const args = rest.some((arg) => arg.includes("%s")) ? rest.map((arg) => arg.replaceAll("%s", url)) : [...rest, url];
    return { program, args };
}
