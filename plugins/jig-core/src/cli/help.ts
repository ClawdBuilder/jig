// The CLI's words, kept free of Pi and the plugins so `jig --help`, `--version` and `help <cmd>` stay fast.
export const EXIT_CODES = `Exit codes: 0 success, 1 failure, 2 usage error or a missing required flag.`;

export const USAGE = `Usage: jig [command] [options] [message]

\`jig\` is Pi for the Jig home (~/.jig, or JIG_HOME). Your own \`pi\` is left alone.
The first word decides what runs:

  jig                       start Pi with the Jig home
  jig -c, jig -p "…"        start Pi with Pi's own options
  jig "a message"           start Pi with that message
  jig -- …                  start Pi with what follows, even when it names a command
  jig install <source>      Pi's install in the home; also remove, uninstall, list,
                            config, auth and mcp
  jig doctor                check this machine, the home and the secret stores
  jig setup                 make the home, install Jig in it, then ask what is missing
  jig update                update the packages in the home; never the Pi binary
  jig help [command]        help for a command

Options:
  -h, --help     show this help, or help for a command
  -v, --version  print the Jig version

Pi's own options work too: \`jig --model …\`, \`jig -c\`, \`jig -p "…"\`.
A message that starts with a command name needs \`jig -- "…"\`.
Run \`jig help <command>\` for a command's options and examples.
${EXIT_CODES}`;

const HELP: Record<string, string> = {
    doctor: `Usage: jig doctor [--json] [--network] [--quiet]

Check this machine, the Jig home, the settings, the plugins and the secret stores.
It names the Jig home it checked. Changes nothing.

Options:
  --json     print one JSON report; failures still exit 1
  --network  also probe the configured network endpoints
  --quiet    only warnings and failures
  -h, --help show this help

Examples:
  jig doctor
  jig doctor --json > doctor.json
${EXIT_CODES}`,
    setup: `Usage: jig setup [section] [--bin <folder>] [--source <source>] [--from <folder>] [--yes]

Make the Jig home (~/.jig, or JIG_HOME) and install Jig in it with Pi, then ask
only what is missing and write your settings file once, with a backup.
Running it again does the questions only, and repairs a missing \`jig\` command.

Options:
  --bin <folder>   where the \`jig\` command goes (default: ~/.local/bin)
  --source <source>
                   what \`pi install\` installs (default: this version on npm)
  --from <folder>  an older Jig folder to offer settings from
  --yes, -y        take the safe answers and skip the questions; for scripts
  -h, --help       show this help

The company, profile and credential questions need a terminal. Uninstall is
deleting the home and the \`jig\` command.

Examples:
  npx @clawdbuilder/jig setup
  jig setup
  jig setup jira
${EXIT_CODES}`,
    update: `Usage: jig update [--check] [--json] [--yes] [--to <version>] [target]

Update the packages in the Jig home. Jig never updates the Pi binary: your \`pi\`
and other Jig homes share it.

Targets:
  (none), --all    Jig, then every unpinned package in the home
  --self, self     Jig only (in Pi, --self means Pi itself)
  --extensions     the other packages, not Jig
  --models         Pi's built-in model catalogs only. Pi loads no extensions for
                   this, so providers such as jig-bedrock are not refreshed;
                   /bedrock refresh does that.
  <source>         one package, for example npm:@clawdbuilder/jig-bedrock
  --extension <source>
                   the same, named with a flag

Options:
  --check        say what would change; changes nothing
  --json         print the plan or the result as JSON; stdout is JSON only
  --to <version> move Jig to that published version
  --yes, -y      do not ask; for scripts (also CI=true)
  -a, --approve  passed to Pi
  -na, --no-approve
                 passed to Pi
  -h, --help     show this help

Jig's own entry is pinned to the version setup installed, so \`jig update\`
moves it; pinned packages stay put, as in Pi. \`jig update pi\` and \`--force\`
are refused: in Pi they reinstall the Pi binary. Run that with: pi update --self.

Examples:
  jig update --check
  jig update --self
  jig update npm:@clawdbuilder/jig-bedrock
${EXIT_CODES}`,
};

/** Pi's own package commands, run in the home; each takes what Pi takes. */
const PI_PACKAGES: Record<string, string> = {
    install: `Usage: jig install <source> [-l] [--approve|--no-approve]

Pi's install, in the Jig home: it adds the package to the home's settings and
copies it there. Any Pi package works, for example npm:@scope/name or
git:github.com/owner/repo.
-l writes this folder's .pi/settings.json instead, which your own \`pi\` reads too.
Use \`jig install --help\` for Pi's own help.
${EXIT_CODES}`,
    remove: `Usage: jig remove <source> [-l] [--approve|--no-approve]

Pi's remove, in the Jig home. \`jig uninstall\` is Pi's alias for the same command.
${EXIT_CODES}`,
    list: `Usage: jig list [--approve|--no-approve]

List the packages in the Jig home and in this folder.
${EXIT_CODES}`,
    config: `Usage: jig config [-l] [--approve|--no-approve]

Pi's resource configuration screen, for the Jig home's packages.
${EXIT_CODES}`,
    auth: `Usage: jig auth <login|logout|print-api-key|print-bearer-token|check> …

Pi's sign-in commands, for the Jig home's auth.json.
${EXIT_CODES}`,
    mcp: `Usage: jig mcp <add|remove|list|login|logout> …

Pi's MCP server commands, for the Jig home.
${EXIT_CODES}`,
};

export const COMMANDS = [...Object.keys(HELP), "uninstall"] as string[];

/** The refusal for a word a sub-command does not take, and the way to send that message to Pi instead. */
export function strayWordsMessage(command: string, argv: readonly string[], word: string): string {
    return `jig ${command} takes no words like "${word}". To ask Pi, run: jig "${[command, ...argv].join(" ")}"`;
}

/** The closest command to a misspelling, for "did you mean". */
export function nearestCommand(word: string): string | undefined {
    let best: string | undefined;
    let bestDistance = 3;
    for (const command of COMMANDS) {
        const distance = editDistance(word.toLowerCase(), command);
        if (distance < bestDistance) {
            best = command;
            bestDistance = distance;
        }
    }
    return best;
}

function editDistance(a: string, b: string): number {
    const row = Array.from({ length: b.length + 1 }, (_, i) => i);
    for (let i = 1; i <= a.length; i++) {
        let previous = row[0] as number;
        row[0] = i;
        for (let j = 1; j <= b.length; j++) {
            const current = row[j] as number;
            row[j] = Math.min(
                (row[j] as number) + 1,
                (row[j - 1] as number) + 1,
                previous + (a[i - 1] === b[j - 1] ? 0 : 1),
            );
            previous = current;
        }
    }
    return row[b.length] as number;
}

/** Help for a topic (a command), or undefined when there is no such command. */
export function helpFor(topic: string | undefined): string | undefined {
    if (topic === undefined) return USAGE;
    return HELP[topic] ?? PI_PACKAGES[topic === "uninstall" ? "remove" : topic];
}
