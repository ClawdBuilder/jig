// A closed world for bin/pi, the launcher: a temporary home and folder, and a PATH that holds only fake programs and links to a
// short list of harmless coreutils. Nothing real can be found on it: no real Pi or tmux, and the process environment is not
// inherited, so no real agent folder, credential or terminal variable reaches the launcher. (test/support/hermetic.mjs gives the
// test process itself a world of its own too; this one is for the child, which gets exactly the variables a test names.)
//
// The fakes write what they were called with to $FAKE_LOG, one line per call, fields separated by a tab, the program first:
//   pi       prints its arguments and a few variables on stdout (see sawPi)
//   tmux     answers list-sessions from $FAKE_TMUX_SESSIONS, show-environment from $FAKE_TMUX_ENV, has-session by whether
//            $FAKE_TMUX_ALIVE exists, and exits with $FAKE_TMUX_NEW_STATUS or $FAKE_TMUX_ATTACH_STATUS for the sessions it starts or
//            attaches; it never starts a server. When it is asked to start a session it also logs a `tmux-client-env` line for
//            every variable of its own environment: that is what the real tmux client sends to the server
//   timeout  logs, then runs the real timeout, so the fake interop probe really runs
import { spawn } from "node:child_process";
import {
    chmodSync,
    existsSync,
    mkdirSync,
    mkdtempSync,
    readFileSync,
    realpathSync,
    rmSync,
    symlinkSync,
    writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { removeTree } from "./remove-tree.ts";
import { fileURLToPath } from "node:url";

export const REPO = realpathSync(path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url)))));
export const LAUNCHER = path.join(REPO, "bin", "pi");

/** The programs the launcher uses besides its own shell builtins. They are linked, so they run as the real ones. */
const COREUTILS = ["bash", "basename", "cat", "cut", "date", "dirname", "readlink", "sort", "tr"];

const LOG = `{ printf "%s" "\${0##*/}"; for a in "$@"; do printf "\\t%s" "$a"; done; printf "\\n"; } >> "$FAKE_LOG"`;

const PI = `#!/bin/bash
for a in "$@"; do printf 'arg:%s\\n' "$a"; done
for n in PI_CODING_AGENT_DIR PASSWORD_STORE_DIR GNUPGHOME AWS_PROFILE WSL_INTEROP PI_BIN JIG_HOME JIG_TMUX_SESSION; do
    if [ -n "\${!n+x}" ]; then printf 'env:%s=%s\\n' "$n" "\${!n}"; else printf 'env:%s=<unset>\\n' "$n"; fi
done
`;

const TMUX = `#!/bin/bash
${LOG}
for a in "$@"; do
    if [ "$a" = new-session ]; then
        for n in $(compgen -e); do printf 'tmux-client-env\\t%s\\t%s\\n' "$n" "\${!n}" >> "$FAKE_LOG"; done
        starts=1
    fi
done
while [ $# -gt 0 ]; do case "$1" in -L|-f) shift 2 ;; *) break ;; esac; done
case "\${1:-}" in
    list-sessions) [ -f "\${FAKE_TMUX_SESSIONS:-}" ] && cat "$FAKE_TMUX_SESSIONS" || exit 1 ;;
    show-environment) [ -f "\${FAKE_TMUX_ENV:-}" ] && cat "$FAKE_TMUX_ENV" || exit 1 ;;
    has-session) [ -f "\${FAKE_TMUX_ALIVE:-}" ] ;;
    attach) exit "\${FAKE_TMUX_ATTACH_STATUS:-0}" ;;
    *) if [ -n "\${starts:-}" ]; then exit "\${FAKE_TMUX_NEW_STATUS:-0}"; fi ;;
esac
`;

function onPath(program: string): string {
    for (const dir of (process.env.PATH ?? "").split(path.delimiter)) {
        const file = path.join(dir, program);
        if (dir && existsSync(file)) return realpathSync(file);
    }
    throw new Error(`${program} is not installed`);
}

export interface Result {
    status: number | null;
    stdout: string;
    stderr: string;
}

export interface World {
    root: string;
    home: string;
    /** The folder the launcher runs in. */
    work: string;
    /** The fake programs' folder: the whole of the launcher's PATH. */
    bin: string;
    /** Runs the launcher in `work`; a variable given as `undefined` is left out. */
    run(args: string[], env?: Record<string, string | undefined>): Promise<Result>;
    /** The fake programs' calls so far, as argument lists with the program first; only `program`'s when given. */
    calls(program?: string): string[][];
    /** Forgets the calls so far. */
    forget(): void;
    /** A file under the world's root, executable when `mode` is given. */
    file(name: string, content: string, mode?: number): string;
    dispose(): void;
}

export function makeWorld(folder = "work"): World {
    const root = realpathSync(mkdtempSync(path.join(tmpdir(), "jig-launcher-")));
    const home = path.join(root, "home");
    const work = path.join(root, "projects", folder);
    const bin = path.join(root, "bin");
    const log = path.join(root, "calls.log");
    for (const dir of [home, work, bin]) mkdirSync(dir, { recursive: true });
    const program = (name: string, content: string) => {
        writeFileSync(path.join(bin, name), content, { mode: 0o755 });
    };
    for (const name of COREUTILS) symlinkSync(onPath(name), path.join(bin, name));
    const cli = path.join(root, "npm", "lib", "node_modules", "@earendil-works", "pi-coding-agent", "dist", "cli.js");
    mkdirSync(path.dirname(cli), { recursive: true });
    writeFileSync(cli, PI, { mode: 0o755 });
    symlinkSync(cli, path.join(bin, "pi"));
    program("tmux", TMUX);
    program("timeout", `#!/bin/bash\n${LOG}\nexec ${onPath("timeout")} "$@"\n`);

    const file = (name: string, content: string, mode?: number) => {
        const target = path.join(root, name);
        mkdirSync(path.dirname(target), { recursive: true });
        writeFileSync(target, content);
        if (mode !== undefined) chmodSync(target, mode);
        return target;
    };
    return {
        root,
        home,
        work,
        bin,
        file,
        forget: () => rmSync(log, { force: true }),
        calls: (name) =>
            (existsSync(log) ? readFileSync(log, "utf8") : "")
                .split("\n")
                .filter((line) => line !== "")
                .map((line) => line.split("\t"))
                .filter((call) => name === undefined || call[0] === name),
        run: (args, extra = {}) =>
            new Promise((resolve, reject) => {
                const env: Record<string, string | undefined> = {
                    HOME: home,
                    PATH: bin,
                    TERM: "dumb",
                    FAKE_LOG: log,
                    // Safe by default: no Windows program, whatever the machine has.
                    JIG_INTEROP_PROBE: path.join(root, "no-such-probe"),
                    JIG_INTEROP_FALLBACK: path.join(root, "no-such-socket"),
                    ...extra,
                };
                for (const key of Object.keys(env)) if (env[key] === undefined) delete env[key];
                const child = spawn(LAUNCHER, args, { cwd: work, env: env as NodeJS.ProcessEnv, stdio: "pipe" });
                let stdout = "";
                let stderr = "";
                child.stdout.on("data", (chunk) => (stdout += chunk));
                child.stderr.on("data", (chunk) => (stderr += chunk));
                child.on("error", reject);
                child.on("close", (status) => resolve({ status, stdout, stderr }));
                child.stdin.end();
            }),
        dispose: () => removeTree(root),
    };
}

/** What the fake Pi printed: its arguments, and the variables it reports (`undefined` when unset). */
export function sawPi(stdout: string): { args: string[]; env: Record<string, string | undefined> } {
    const args: string[] = [];
    const env: Record<string, string | undefined> = {};
    for (const line of stdout.split("\n")) {
        if (line.startsWith("arg:")) args.push(line.slice(4));
        else if (line.startsWith("env:")) {
            const [name = "", ...value] = line.slice(4).split("=");
            const text = value.join("=");
            env[name] = text === "<unset>" ? undefined : text;
        }
    }
    return { args, env };
}
