// bin/pi, the optional launcher, in a closed world (test/support/launcher-world.ts): fake Pi, tmux and timeout on a PATH of their own,
// a temporary home, and nothing inherited from the real environment. No real Pi, tmux server or Windows program runs. "Interactive"
// cases use the launcher's test-only JIG_FORCE_INTERACTIVE=1 (a pipe is not a terminal) and, for the reattach menu, JIG_TTY (a file
// standing in for /dev/tty).
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { accessSync, constants, existsSync, mkdirSync, readFileSync, rmSync, symlinkSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, test } from "node:test";
import { LAUNCHER, REPO, makeWorld, sawPi } from "./support/launcher-world.ts";
import type { World } from "./support/launcher-world.ts";

let world: World;
beforeEach(() => {
    world = makeWorld();
});
afterEach(() => world.dispose());

/** Stdin and stdout count as a terminal. */
const TERMINAL = { JIG_FORCE_INTERACTIVE: "1" };

/**
 * The one tmux command line that starts a session, taken apart. It is three tmux commands joined by `;`: name the variables, start the
 * session, put tmux's own list back.
 */
function launchOf(call: string[]): {
    server: string[];
    commands: string[][];
    names: string[];
    name: string;
    cwd: string;
    marker: string;
    command: string[];
} {
    const commands: string[][] = [[]];
    for (const word of call.slice(5)) {
        if (word === ";") commands.push([]);
        else commands[commands.length - 1]?.push(word);
    }
    const start = commands[1] ?? [];
    const dash = start.indexOf("--");
    const option = (flag: string) => start[start.indexOf(flag) + 1] ?? "";
    return {
        server: call.slice(0, 5),
        commands,
        names: (commands[0]?.[3] ?? "").split(" ").filter((name) => name !== ""),
        name: option("-s"),
        cwd: option("-c"),
        marker: option("-e"),
        command: start.slice(dash + 1),
    };
}

const newSession = (w: World) => w.calls("tmux").find((call) => call.includes("new-session"));
const launch = (w: World) => launchOf(newSession(w) ?? []);
const attached = (w: World) => w.calls("tmux").filter((call) => call.includes("attach"));
/** What the fake tmux client had in its environment when it was asked to start a session: the values tmux sends to its server. */
const clientEnv = (w: World) =>
    Object.fromEntries(w.calls("tmux-client-env").map(([, name = "", value = ""]) => [name, value]));

describe("the files", () => {
    test("bin/pi and bin/clipboard-copy are executable, and every script parses", () => {
        for (const name of ["pi", "clipboard-copy"]) {
            accessSync(path.join(REPO, "bin", name), constants.X_OK);
            const check = spawnSync("bash", ["-n", path.join(REPO, "bin", name)], { encoding: "utf8" });
            assert.equal(check.status, 0, `${name}: ${check.stderr}`);
        }
    });

    test("tmux.conf takes the clipboard helper from JIG_PACKAGE_DIR, and the helper is there", () => {
        const conf = readFileSync(path.join(REPO, "bin", "tmux.conf"), "utf8");
        assert.ok(conf.includes('"$JIG_PACKAGE_DIR/bin/clipboard-copy"'));
        assert.equal(
            /\$JIG_[A-Z_]+/.exec(conf.replaceAll("$JIG_PACKAGE_DIR/", ""))?.[0],
            undefined,
            "JIG_PACKAGE_DIR is the only variable",
        );
        accessSync(path.join(REPO, "bin", "clipboard-copy"), constants.X_OK);
    });

    test("the script signs in to nothing, unlocks nothing and opens no connection", () => {
        const source = readFileSync(LAUNCHER, "utf8").replace(/^\s*#.*$/gm, "");
        for (const word of [
            "gpg",
            "pass ",
            "/dev/tcp",
            "curl",
            "wget",
            "aws ",
            "gh auth",
            "PASSWORD_STORE_DIR",
            "GNUPGHOME",
        ])
            assert.equal(source.includes(word), false, word);
    });
});

describe("a run that is not interactive", () => {
    test("goes straight to Pi: the launcher's flags are removed, Pi's own defaults apply, and nothing else runs", async () => {
        const result = await world.run(["-p", "hello world", "--no-tmux", "--new", "--model", "x"]);
        assert.equal(result.status, 0);
        assert.equal(result.stderr, "");
        const pi = sawPi(result.stdout);
        assert.deepEqual(pi.args, ["-p", "hello world", "--model", "x"]);
        assert.deepEqual(pi.env, {
            PI_CODING_AGENT_DIR: undefined,
            PASSWORD_STORE_DIR: undefined,
            GNUPGHOME: undefined,
            AWS_PROFILE: undefined,
            WSL_INTEROP: undefined,
            PI_BIN: undefined,
            JIG_PACKAGE_DIR: REPO,
            JIG_COMMAND: undefined,
            JIG_TMUX_SESSION: undefined,
        });
        assert.deepEqual(world.calls(), [], "no tmux, timeout or probe");
    });

    test("the only variable the launcher sets for Pi is JIG_PACKAGE_DIR; what you export is left as it is", async () => {
        const result = await world.run(["-p", "hi"], {
            PI_CODING_AGENT_DIR: "/custom/agent",
            PASSWORD_STORE_DIR: "/custom/store",
            GNUPGHOME: "/custom/gnupg",
            AWS_PROFILE: "team-profile",
        });
        assert.deepEqual(sawPi(result.stdout).env, {
            PI_CODING_AGENT_DIR: "/custom/agent",
            PASSWORD_STORE_DIR: "/custom/store",
            GNUPGHOME: "/custom/gnupg",
            AWS_PROFILE: "team-profile",
            WSL_INTEROP: undefined,
            PI_BIN: undefined,
            JIG_PACKAGE_DIR: REPO,
            JIG_COMMAND: undefined,
            JIG_TMUX_SESSION: undefined,
        });
    });

    test("there is no warm start to turn off: --no-warm is Pi's argument now", async () => {
        const result = await world.run(["-p", "go", "--no-warm"], { JIG_NO_WARM: "1" });
        assert.deepEqual(sawPi(result.stdout).args, ["-p", "go", "--no-warm"]);
    });

    test("without a terminal even a plain `pi` is not interactive", async () => {
        const result = await world.run([]);
        assert.deepEqual(sawPi(result.stdout).args, []);
        assert.deepEqual(world.calls(), []);
    });

    for (const args of [
        ["list"],
        ["install", "git:example/pkg"],
        ["config"],
        ["--version"],
        ["-h"],
        ["--list-models"],
        ["--export", "session.jsonl"],
        ["--mode", "json", "go"],
        ["-p", "go"],
    ]) {
        test(`a terminal still means no tmux for \`pi ${args.join(" ")}\``, async () => {
            const result = await world.run(args, TERMINAL);
            assert.deepEqual(sawPi(result.stdout).args, args);
            assert.deepEqual(world.calls(), []);
        });
    }
});

describe("turning tmux off", () => {
    for (const [how, args, env] of [
        ["flag", ["--no-tmux"], {}],
        ["variable", [], { JIG_NO_TMUX: "1" }],
    ] as const) {
        test(`${how}: Pi runs in this terminal with no tmux, and nothing is called first`, async () => {
            const result = await world.run([...args, "--model", "x"], { ...TERMINAL, ...env });
            assert.deepEqual(sawPi(result.stdout).args, ["--model", "x"]);
            assert.deepEqual(world.calls(), []);
        });
    }

    test("in a herdr terminal Pi runs in front with no tmux, unless JIG_TMUX=1", async () => {
        const herdr = { ...TERMINAL, HC_TERMINAL_ID: "t-1" };
        const result = await world.run(["--model", "x"], herdr);
        assert.deepEqual(sawPi(result.stdout).args, ["--model", "x"]);
        assert.deepEqual(world.calls("tmux"), []);

        await world.run(["--new"], { ...herdr, JIG_TMUX: "1" });
        assert.ok(newSession(world), "JIG_TMUX=1 brings tmux back");
    });

    test("--new and JIG_NEW=1 start a new session without looking for one to reattach", async () => {
        for (const [args, env] of [
            [["--new"], {}],
            [[], { JIG_NEW: "1" }],
        ] as const) {
            world.forget();
            await world.run([...args], { ...TERMINAL, ...env });
            const tmux = world.calls("tmux");
            assert.ok(!tmux.some((call) => call.includes("list-sessions")), "no search");
            assert.ok(newSession(world), "a new session");
        }
    });
});

describe("finding Pi", () => {
    test("skips a shim called pi (which would run the launcher again) and takes the Pi that is installed", async () => {
        const shim = world.file("shim/pi", `#!/bin/sh\necho SHIM\nexec ${LAUNCHER} "$@"\n`, 0o755);
        const result = await world.run(["-p", "go"], { PATH: `${path.dirname(shim)}:${world.bin}` });
        assert.equal(result.status, 0);
        assert.equal(result.stdout.includes("SHIM"), false);
        assert.deepEqual(sawPi(result.stdout).args, ["-p", "go"]);
    });

    test("PI_BIN names the executable and wins over the search", async () => {
        const custom = world.file("custom/pi", "#!/bin/sh\necho CUSTOM $#\n", 0o755);
        const result = await world.run(["-p", "go"], { PI_BIN: custom });
        assert.equal(result.stdout, "CUSTOM 2\n");
    });

    test("no Pi on the PATH, or a PI_BIN that is not a program, is exit 127 with a clear line", async () => {
        const shim = world.file("shim/pi", "#!/bin/sh\necho SHIM\nexit 9\n", 0o755);
        rmSync(path.join(world.bin, "pi"));
        const none = await world.run(["-p", "go"], { PATH: `${path.dirname(shim)}:${world.bin}` });
        assert.equal(none.status, 127);
        assert.match(none.stderr, /^jig: Pi is not installed: npm install -g @earendil-works\/pi-coding-agent\n$/);
        assert.equal(none.stdout, "");
        const wrong = await world.run(["-p", "go"], { PI_BIN: path.join(world.root, "no-such-pi") });
        assert.equal(wrong.status, 127);
        assert.match(wrong.stderr, /^jig: PI_BIN \(.*no-such-pi\) is not an executable\n$/);
    });
});

describe("the WSL interop socket", () => {
    const probe = (exit: number) =>
        world.file("windows/cmd.exe", `#!/bin/sh\nprintf 'probe\\t%s\\n' "$*" >> "$FAKE_LOG"\nexit ${exit}\n`, 0o755);
    const socket = () => world.file("run/WSL/1_interop", "");

    test("a dead socket is replaced by the distro's own, and Pi gets that one", async () => {
        const fallback = socket();
        const result = await world.run([], {
            ...TERMINAL,
            JIG_NO_TMUX: "1",
            WSL_INTEROP: "/run/WSL/9_interop",
            JIG_INTEROP_PROBE: probe(1),
            JIG_INTEROP_FALLBACK: fallback,
        });
        assert.equal(sawPi(result.stdout).env.WSL_INTEROP, fallback);
        assert.equal(
            result.stderr,
            `jig: Windows interop socket /run/WSL/9_interop does not answer; using ${fallback}\n`,
        );
        assert.deepEqual(world.calls("probe"), [["probe", "/c exit"]]);
        assert.ok(
            world.calls("timeout").some((call) => call[1] === "2"),
            "the probe has 2 seconds",
        );
    });

    test("a shell started over SSH has no socket: it gets the distro's, quietly and without a probe", async () => {
        const fallback = socket();
        const result = await world.run([], {
            ...TERMINAL,
            JIG_NO_TMUX: "1",
            JIG_INTEROP_PROBE: probe(1),
            JIG_INTEROP_FALLBACK: fallback,
        });
        assert.equal(sawPi(result.stdout).env.WSL_INTEROP, fallback);
        assert.equal(result.stderr, "");
        assert.deepEqual(world.calls("probe"), []);
    });

    test("a socket that answers stays", async () => {
        const result = await world.run([], {
            ...TERMINAL,
            JIG_NO_TMUX: "1",
            WSL_INTEROP: "/run/WSL/9_interop",
            JIG_INTEROP_PROBE: probe(0),
            JIG_INTEROP_FALLBACK: socket(),
        });
        assert.equal(sawPi(result.stdout).env.WSL_INTEROP, "/run/WSL/9_interop");
        assert.equal(result.stderr, "");
    });

    test("nothing is probed when the socket is already the distro's, when there is no fallback, or when not interactive", async () => {
        const fallback = socket();
        const same = await world.run([], {
            ...TERMINAL,
            JIG_NO_TMUX: "1",
            WSL_INTEROP: fallback,
            JIG_INTEROP_PROBE: probe(1),
            JIG_INTEROP_FALLBACK: fallback,
        });
        assert.equal(sawPi(same.stdout).env.WSL_INTEROP, fallback);
        const missing = await world.run([], {
            ...TERMINAL,
            JIG_NO_TMUX: "1",
            WSL_INTEROP: "/run/WSL/9_interop",
            JIG_INTEROP_PROBE: probe(1),
        });
        assert.equal(sawPi(missing.stdout).env.WSL_INTEROP, "/run/WSL/9_interop");
        const print = await world.run(["-p", "go"], {
            WSL_INTEROP: "/run/WSL/9_interop",
            JIG_INTEROP_PROBE: probe(1),
            JIG_INTEROP_FALLBACK: fallback,
        });
        assert.equal(sawPi(print.stdout).env.WSL_INTEROP, "/run/WSL/9_interop");
        assert.deepEqual(world.calls("probe"), []);
    });

    test("the socket Pi gets inside tmux is the repaired one too", async () => {
        const fallback = socket();
        await world.run([], {
            ...TERMINAL,
            WSL_INTEROP: "/run/WSL/9_interop",
            JIG_INTEROP_PROBE: probe(1),
            JIG_INTEROP_FALLBACK: fallback,
        });
        assert.equal(clientEnv(world).WSL_INTEROP, fallback);
        assert.ok(launch(world).names.includes("WSL_INTEROP"));
    });
});

describe("copy on select (bin/clipboard-copy)", () => {
    const helper = path.join(REPO, "bin", "clipboard-copy");
    const bash = spawnSync("sh", ["-c", "command -v bash"], { encoding: "utf8" }).stdout.trim();
    /** A PATH with only the programs the helper needs, so a clipboard program installed here never answers instead. */
    function onlyBasics(): string {
        const dir = path.join(world.root, "basics");
        mkdirSync(dir, { recursive: true });
        for (const name of ["cat", "grep", "iconv"]) {
            const found = spawnSync("sh", ["-c", `command -v ${name}`], { encoding: "utf8" }).stdout.trim();
            if (!existsSync(path.join(dir, name))) symlinkSync(found, path.join(dir, name));
        }
        return dir;
    }
    function copy(text: string, env: Record<string, string>) {
        return spawnSync(bash, [helper], { input: text, encoding: "utf8", env: { PATH: onlyBasics(), ...env } });
    }
    /** A clip.exe that keeps what it got and the interop socket it was given. */
    const fakeClip = (exit = 0) => {
        const dir = path.join(world.root, "windows");
        return world.file(
            "windows/clip.exe",
            `#!/bin/sh\ncat > "${dir}/clipboard"\nprintf '%s' "\${WSL_INTEROP:-}" > "${dir}/interop"\nexit ${exit}\n`,
            0o755,
        );
    };
    const got = (clip: string, name: string) => readFileSync(path.join(path.dirname(clip), name));

    test("on WSL without clip.exe on the PATH or an interop socket (an SSH shell) it still copies, as UTF-16LE", () => {
        const clip = fakeClip();
        const socket = world.file("run/WSL/1_interop", "");
        const result = copy("héllo", { JIG_WSL: "1", JIG_CLIP_EXE: clip, JIG_INTEROP_FALLBACK: socket });
        assert.equal(result.status, 0, result.stderr);
        assert.equal(got(clip, "clipboard").toString("utf16le"), "héllo");
        assert.equal(got(clip, "interop").toString(), socket);
    });

    test("a socket the shell already has is kept", () => {
        const clip = fakeClip();
        const socket = world.file("run/WSL/1_interop", "");
        copy("x", {
            JIG_WSL: "1",
            JIG_CLIP_EXE: clip,
            JIG_INTEROP_FALLBACK: socket,
            WSL_INTEROP: "/run/WSL/7_interop",
        });
        assert.equal(got(clip, "interop").toString(), "/run/WSL/7_interop");
    });

    test("a copy that fails says so, instead of looking copied", () => {
        const failing = copy("x", { JIG_WSL: "1", JIG_CLIP_EXE: fakeClip(1), JIG_INTEROP_FALLBACK: "/no/socket" });
        assert.equal(failing.status, 1);
        assert.match(failing.stderr, /not copied: clip\.exe failed/);
        const nothing = copy("x", { JIG_WSL: "0" });
        assert.equal(nothing.status, 1);
        assert.match(nothing.stderr, /not copied: no clipboard program/);
    });
});

describe("tmux", () => {
    test("a new session: its name from the folder, the launcher's own server, and the launcher again inside", async () => {
        world.dispose();
        world = makeWorld("My Project.v2 with a very long name");
        const result = await world.run(["--model", "x", "--new"], TERMINAL);
        assert.equal(result.status, 0);
        assert.equal(result.stdout, "", "Pi is not run by this process: the session runs it");
        const session = launch(world);
        assert.deepEqual(session.server, ["tmux", "-L", "jig", "-f", path.join(REPO, "bin", "tmux.conf")]);
        assert.match(session.name, /^pi-My-Project-v2-with-a-ver-\d+$/);
        assert.equal(session.cwd, world.work);
        assert.equal(session.marker, `JIG_TMUX_SESSION=${session.name}`);
        assert.deepEqual(session.command, [LAUNCHER, "--model", "x"], "--new stays here");
        assert.deepEqual(
            session.commands.map((words) => words.slice(0, 3)),
            [
                ["set-option", "-g", "update-environment"],
                ["new-session", "-s", session.name],
                ["set-option", "-gu", "update-environment"],
            ],
            "name the variables, start the session, put tmux's own list back",
        );
    });

    test("Pi inside sees this terminal's environment: every exported variable is named, and the values stay out of argv", async () => {
        const secret = "do-not-print-0451";
        const result = await world.run(["--model", "x"], {
            ...TERMINAL,
            MY_SETTING: "a value with spaces",
            PI_CACHE_RETENTION: "long",
            BROWSER: "/home/me/browser",
            WSL_INTEROP: "/run/WSL/9_interop",
            COLORTERM: "truecolor",
            AWS_SECRET_ACCESS_KEY: secret,
            GH_TOKEN: secret,
            lower_case_name: secret,
        });
        assert.equal(result.status, 0);
        const names = launch(world).names;
        for (const name of [
            "MY_SETTING",
            "PI_CACHE_RETENTION",
            "BROWSER",
            "WSL_INTEROP",
            "COLORTERM",
            "AWS_SECRET_ACCESS_KEY",
            "GH_TOKEN",
            "lower_case_name",
            "HOME",
            "PATH",
            "JIG_PACKAGE_DIR",
        ])
            assert.ok(names.includes(name), `${name} is named`);
        assert.equal(new Set(names).size, names.length, "each name once");

        const tmux = world.calls("tmux");
        assert.equal(
            tmux.flat().some((word) => word.includes(secret) || word.includes("a value with spaces")),
            false,
            "no value in the arguments of any tmux call, which any process on the machine can read",
        );
        const env = clientEnv(world);
        assert.equal(env.MY_SETTING, "a value with spaces", "the values travel in the tmux client's environment");
        assert.equal(env.AWS_SECRET_ACCESS_KEY, secret);
        assert.equal(env.JIG_PACKAGE_DIR, REPO);
        for (const text of [result.stdout, result.stderr]) assert.equal(text.includes(secret), false);
    });

    test("what describes the terminal or the shell is not copied, and neither is the marker", async () => {
        await world.run([], {
            ...TERMINAL,
            TERM_PROGRAM: "some-terminal",
            TERM_PROGRAM_VERSION: "1.2.3",
            TMUX_PANE: "%3",
            LINES: "50",
            COLUMNS: "200",
            OLDPWD: "/elsewhere",
            JIG_TMUX_SESSION: "pi-stale-1",
        });
        const { names, marker } = launch(world);
        for (const name of [
            "TERM",
            "TERM_PROGRAM",
            "TERM_PROGRAM_VERSION",
            "TMUX",
            "TMUX_PANE",
            "SHLVL",
            "PWD",
            "OLDPWD",
            "_",
            "LINES",
            "COLUMNS",
            "JIG_TMUX_SESSION",
        ])
            assert.equal(names.includes(name), false, `${name} is not named`);
        assert.match(
            marker,
            /^JIG_TMUX_SESSION=pi-work-\d+$/,
            "the new session gets its own marker, not the stale one",
        );
    });

    test("a variable the server holds from an earlier terminal is named too, so tmux removes it unless this terminal sets it", async () => {
        const environment = world.file(
            "server-environment",
            [
                "SERVER_ONLY=from-an-earlier-terminal",
                "-HIDDEN_ALREADY",
                "SHARED=old-value",
                "TERM=xterm-256color",
                "SHLVL=3",
                "_=/usr/bin/tmux",
                "PWD=/elsewhere",
                "JIG_TMUX_SESSION=old-session",
                "A MULTI LINE=value",
                "9STARTS_WITH_A_DIGIT=x",
                "",
            ].join("\n"),
        );
        await world.run([], { ...TERMINAL, FAKE_TMUX_ENV: environment, SHARED: "new-value" });
        assert.ok(world.calls("tmux").some((call) => call.join(" ") === "tmux -L jig show-environment -g"));
        const { names } = launch(world);
        assert.ok(names.includes("SERVER_ONLY"), "removed from the session unless this terminal sets it");
        assert.equal(names.filter((name) => name === "SHARED").length, 1, "set here and held there: named once");
        for (const name of [
            "HIDDEN_ALREADY",
            "TERM",
            "SHLVL",
            "_",
            "PWD",
            "JIG_TMUX_SESSION",
            "A",
            "9STARTS_WITH_A_DIGIT",
        ])
            assert.equal(names.includes(name), false, `${name} is not named`);
        assert.equal(clientEnv(world).SERVER_ONLY, undefined, "this terminal does not set it");
        assert.equal(clientEnv(world).SHARED, "new-value");
    });

    test("with no server running (nothing to remove) only this terminal's variables are named", async () => {
        await world.run([], { ...TERMINAL, MY_SETTING: "x" });
        const { names } = launch(world);
        assert.ok(names.includes("MY_SETTING"));
        assert.ok(!names.includes("SERVER_ONLY"));
    });

    test("an argument that ends in `;` reaches Pi whole: tmux would read it as the end of a command", async () => {
        await world.run(["fix this;", ";", "keep\\;", "a;b"], TERMINAL);
        assert.deepEqual(launch(world).command, [LAUNCHER, "fix this\\;", "\\;", "keep\\\\;", "a;b"]);
        assert.equal(launch(world).commands.length, 3, "the three tmux commands are all that tmux sees");
    });

    test("when the session is still there afterwards the launcher says how to come back, and the exit status is tmux's", async () => {
        const alive = world.file("alive", "");
        const gone = await world.run([], { ...TERMINAL, FAKE_TMUX_NEW_STATUS: "3" });
        assert.equal(gone.status, 3);
        assert.equal(gone.stderr, "");
        const still = await world.run([], { ...TERMINAL, FAKE_TMUX_ALIVE: alive });
        assert.equal(still.status, 0);
        assert.match(still.stderr, /^jig: Pi is still running \(pi-work-\d+\); run `pi` in this folder to reattach\n$/);
        // `jig` sets JIG_COMMAND, so the hint names the command the person typed, not `pi`, which would start another agent.
        world.forget();
        const asJig = await world.run([], { ...TERMINAL, FAKE_TMUX_ALIVE: alive, JIG_COMMAND: "jig" });
        assert.match(asJig.stderr, /run `jig` in this folder to reattach/);
    });

    test("is not used inside another tmux, without tmux installed, or outside a terminal", async () => {
        const inside = await world.run([], { ...TERMINAL, TMUX: "/tmp/tmux-1000/default,100,0" });
        assert.deepEqual(sawPi(inside.stdout).args, []);
        assert.equal(newSession(world), undefined);
        assert.deepEqual(world.calls("tmux"), [], "not even the server's environment is read");
        rmSync(path.join(world.bin, "tmux"));
        const without = await world.run([], TERMINAL);
        assert.deepEqual(sawPi(without.stdout).args, []);
    });

    test("inside its own session it records the folder and starts Pi, with no other step", async () => {
        const result = await world.run(["--model", "x"], {
            ...TERMINAL,
            TMUX: "/tmp/tmux-1000/jig,100,0",
            JIG_TMUX_SESSION: "pi-work-100",
        });
        assert.equal(result.status, 0);
        assert.equal(result.stderr, "");
        const pi = sawPi(result.stdout);
        assert.deepEqual(pi.args, ["--model", "x"]);
        assert.equal(pi.env.JIG_TMUX_SESSION, "pi-work-100", "Pi sees the marker");
        assert.deepEqual(world.calls("tmux"), [["tmux", "set-option", "@jig_cwd", world.work]]);
        assert.deepEqual(world.calls("timeout"), []);
    });

    test("a session of someone else's tmux does not record a folder", async () => {
        await world.run([], {
            ...TERMINAL,
            TMUX: "/tmp/tmux-1000/default,100,0",
            JIG_TMUX_SESSION: "pi-work-100",
        });
        assert.deepEqual(world.calls("tmux"), []);
    });
});

describe("reattaching", () => {
    const LIST = "#{session_attached} #{session_activity} #{session_name} #{@jig_cwd}";
    const sessions = (...lines: string[]) => world.file("sessions", `${lines.join("\n")}\n`);

    test("one detached session started in this folder: the launcher attaches to it with a one-line notice", async () => {
        const file = sessions(
            `0 1700000000 pi-work-111 ${world.work}`,
            `1 1700000100 pi-work-222 ${world.work}`,
            "0 1700000200 pi-other-333 /elsewhere",
            `0 1700000300 pi-work-444 ${world.work}/sub`,
        );
        const result = await world.run([], { ...TERMINAL, FAKE_TMUX_SESSIONS: file, FAKE_TMUX_ATTACH_STATUS: "4" });
        assert.equal(result.status, 4);
        assert.equal(newSession(world), undefined, "no new session");
        assert.deepEqual(attached(world), [["tmux", "-L", "jig", "attach", "-t", "=pi-work-111"]]);
        assert.ok(world.calls("tmux").some((call) => call.includes("list-sessions") && call.includes(LIST)));
        assert.match(
            result.stderr,
            /^jig: reattaching to the Pi still running here \(pi-work-111, last active \w{3} \d{2} \d{2}:\d{2}\); `pi --new` starts another\n$/,
        );
    });

    test("after the attach returns the launcher says so when that Pi is still running", async () => {
        const result = await world.run([], {
            ...TERMINAL,
            FAKE_TMUX_SESSIONS: sessions(`0 1700000000 pi-work-111 ${world.work}`),
            FAKE_TMUX_ALIVE: world.file("alive", ""),
        });
        assert.match(result.stderr, /jig: Pi is still running \(pi-work-111\); run `pi` in this folder to reattach\n$/);
    });

    test("only a bare `pi`, `-c` and `--continue` offer it; no match is a new session", async () => {
        const file = sessions(`0 1700000000 pi-work-111 ${world.work}`);
        for (const args of [["-c"], ["--continue"]]) {
            world.forget();
            await world.run(args, { ...TERMINAL, FAKE_TMUX_SESSIONS: file });
            assert.equal(attached(world).length, 1, args.join(" "));
        }
        for (const args of [["--model", "x"], ["-r"], ["-c", "--model", "x"], ["--new"]]) {
            world.forget();
            await world.run(args, { ...TERMINAL, FAKE_TMUX_SESSIONS: file });
            assert.equal(attached(world).length, 0, args.join(" "));
            assert.ok(newSession(world), args.join(" "));
        }
        world.forget();
        await world.run([], { ...TERMINAL, FAKE_TMUX_SESSIONS: sessions(`1 1700000000 pi-work-111 ${world.work}`) });
        assert.ok(newSession(world), "an attached session is not offered");
    });

    describe("several detached sessions", () => {
        const several = () =>
            sessions(`0 1700000000 pi-work-111 ${world.work}`, `0 1700000500 pi-work-222 ${world.work}`);
        const withAnswer = (answer: string) => ({
            ...TERMINAL,
            FAKE_TMUX_SESSIONS: several(),
            JIG_TTY: world.file("answer", answer),
        });

        test("a numbered menu, newest first; the number picked is attached", async () => {
            const result = await world.run([], withAnswer("2\n"));
            assert.deepEqual(attached(world), [["tmux", "-L", "jig", "attach", "-t", "=pi-work-111"]]);
            assert.equal(newSession(world), undefined);
            const lines = result.stderr.split("\n");
            assert.equal(lines[0], "jig: Pis still running in this folder (`pi --new` skips this):");
            assert.match(lines[1] ?? "", /^ {2}1\) pi-work-222 {2}last active /);
            assert.match(lines[2] ?? "", /^ {2}2\) pi-work-111 {2}last active /);
            assert.match(lines[3] ?? "", /^Reattach to which\? \[1-2, n or Enter = new session\] /);
        });

        test("Enter, n, a closed answer and a missing terminal each start a new session", async () => {
            for (const answer of ["\n", "n\n", "N\n", ""]) {
                world.forget();
                await world.run([], withAnswer(answer));
                assert.equal(attached(world).length, 0, JSON.stringify(answer));
                assert.ok(newSession(world), JSON.stringify(answer));
            }
            world.forget();
            await world.run([], { ...withAnswer("1\n"), JIG_TTY: path.join(world.root, "no-terminal") });
            assert.equal(attached(world).length, 0);
            assert.ok(newSession(world));
        });

        test("something that is not a choice is asked again, and the last line may lack its newline", async () => {
            const result = await world.run([], withAnswer("9\nx\n1"));
            assert.deepEqual(attached(world), [["tmux", "-L", "jig", "attach", "-t", "=pi-work-222"]]);
            assert.equal(result.stderr.split("jig: not a choice\n").length - 1, 2);
        });
    });
});

describe("the launcher page", () => {
    test("names every flag and variable the launcher reads", () => {
        const section = readFileSync(path.join(REPO, "docs", "launcher.md"), "utf8");
        const source = readFileSync(LAUNCHER, "utf8");
        const names = new Set(source.match(/--no-tmux|--new\b|HC_TERMINAL_ID|\b(?:JIG|PI)_[A-Z_]+/g));
        // The ones only the tests use, and the marker that ties a session to its launcher, are described in bin/pi.
        const internal = [
            "JIG_FORCE_INTERACTIVE",
            "JIG_TTY",
            "JIG_INTEROP_PROBE",
            "JIG_INTEROP_FALLBACK",
            "JIG_TMUX_SESSION",
        ];
        for (const name of internal) names.delete(name);
        assert.ok(names.size >= 7, "the launcher reads flags and variables");
        for (const name of names) assert.ok(section.includes(name), `${name} is in the launcher page`);
        for (const word of [
            "~/.local/bin/pi",
            "tmux",
            "-L jig",
            "startChecks",
            "secrets.pass.unlockAtStart",
            "WSL_INTEROP",
        ])
            assert.ok(section.includes(word), word);
    });
});
