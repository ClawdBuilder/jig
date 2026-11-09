// The CLI's words, kept free of Pi and the plugins so `jig --help`, `--version` and `help <cmd>` stay fast.
export const EXIT_CODES = `Exit codes: 0 success, 1 failure, 2 usage error or a missing required flag.`;

export const USAGE = `Usage: jig <command> [options]

Commands:
  doctor   check this machine, the settings and the secret stores
  setup    ask only what is missing, then write your settings file once
  update   move both copies of Jig to one published version

Options:
  -h, --help     show this help, or help for a command
  -v, --version  print the Jig version

Run \`jig help <command>\` for a command's options and examples.
${EXIT_CODES}`;

const HELP: Record<string, string> = {
    doctor: `Usage: jig doctor [--json] [--network] [--quiet]

Check this machine, the settings, the plugins and the secret stores. Changes nothing.

Options:
  --json     print one JSON report; failures still exit 1
  --network  also probe the configured network endpoints
  --quiet    only warnings and failures
  -h, --help show this help

Examples:
  jig doctor
  jig doctor --json > doctor.json
${EXIT_CODES}`,
    setup: `Usage: jig setup [section]

Ask only what is missing, then write your settings file once, with a backup.
A section you name is asked about even when it is already valid, so you can
change its sign-in. Setup needs a terminal: its company, profile and credential
choices have no safe headless default.

Options:
  -h, --help show this help

Examples:
  jig setup
  jig setup jira
${EXIT_CODES}`,
    update: `Usage: jig update [--check] [--json] [--to <version>] [--yes]

Move Pi's Jig copy and the global jig command to one published version.
Without --check the update asks before changing anything.

Options:
  --check        show the plan and exit; changes nothing
  --json         print the plan/result as JSON; stdout is JSON only
  --to <version> target an exact published version
  --yes, -y      do not ask; for scripts (also CI=true)
  -h, --help     show this help

Examples:
  jig update --check
  jig update --check --json
  jig update --yes
${EXIT_CODES}`,
};

export const COMMANDS = Object.keys(HELP) as Array<keyof typeof HELP>;

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
    return HELP[topic];
}
