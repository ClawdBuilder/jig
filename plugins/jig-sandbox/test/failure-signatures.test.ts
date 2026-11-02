// A failure that looks like the sandbox: the tool's own words for a Unix socket it cannot make, as the real tools printed them
// inside the sandbox (recorded on Linux), earn one line after a command that failed, and never one after a command that did not.
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { afterEnd } from "../src/background/after-end.ts";
import type { Aftermath, AfterInput } from "../src/aftermath.ts";
import { explainBlocks } from "../src/explain.ts";
import { FAILURE_SIGNATURES } from "../src/lists.ts";
import type { Task } from "../src/background/types.ts";
import { CWD, HOME, linux, rules } from "./support/fixture.ts";
import { skipUnlessRealSandbox } from "./support/programs.ts";
import { realSession, until } from "./support/session.ts";
import type { Session } from "./support/session.ts";

const LOOKS = "[sandbox] this failure looks like the sandbox: ";
const FOREGROUND = "Run the command again with outside: true and a reason, which asks the user.";

/** What the tools printed in the real sandbox. */
const RECORDED = {
    jcmd: [
        "1:",
        "com.sun.tools.attach.AttachNotSupportedException: Unable to open socket file /tmp/.java_pid1: target process 1 doesn't respond within 10500ms or HotSpot VM not loaded",
        "\tat jdk.attach/sun.tools.attach.VirtualMachineImpl.<init>(VirtualMachineImpl.java:113)",
        "\tat jdk.jcmd/sun.tools.jcmd.JCmd.main(JCmd.java:97)",
    ].join("\n"),
    // The message of the JDK 8 attach API, as JMockit's self-attach reports it.
    jvm8: "Caused by: com.sun.tools.attach.AttachNotSupportedException: Unable to open socket file: target process not responding or HotSpot VM not loaded",
    python: [
        "Traceback (most recent call last):",
        '  File "<string>", line 1, in <module>',
        '  File "/usr/lib/python3.12/socket.py", line 233, in __init__',
        "    _socket.socket.__init__(self, family, type, proto, fileno)",
        "PermissionError: [Errno 1] Operation not permitted",
    ].join("\n"),
    // Python 3.11 and later mark the failing call in a script.
    pythonScript: [
        "Traceback (most recent call last):",
        '  File "/tmp/t.py", line 2, in <module>',
        "    s = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)",
        "        ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^",
        '  File "/usr/lib/python3.12/socket.py", line 233, in __init__',
        "    _socket.socket.__init__(self, family, type, proto, fileno)",
        "PermissionError: [Errno 1] Operation not permitted",
    ].join("\n"),
    nodeConnect: "connect EPERM /tmp/x.sock",
    nodeListen: "listen EPERM: operation not permitted /tmp/y.sock",
    socat: "2026/11/02 17:40:44 socat[3] E socket(1, 1, 0): Operation not permitted",
    nc: "nc: /tmp/x.sock: Operation not permitted",
    // The text of the tools, not recorded here: neither is installed on the machine the others were recorded on.
    docker: "Cannot connect to the Docker daemon at unix:///var/run/docker.sock. Is the docker daemon running?",
    go: 'Get "http://%2Fvar%2Frun%2Fdocker.sock/v1.43/version": dial unix /var/run/docker.sock: socket: operation not permitted',
};

const set = rules(linux({ files: { [`${HOME}/.bashrc`]: "" } }));
const failed = { failure: { background: false } };
const say = (output: string, options: Partial<Parameters<typeof explainBlocks>[2]> = failed) =>
    explainBlocks(output, set, { cwd: CWD, mode: "open", ...options }).lines;

describe("the words of a tool that cannot make a Unix socket", () => {
    test("JVM attach: the old message and the new one", () => {
        for (const output of [RECORDED.jcmd, RECORDED.jvm8]) {
            assert.deepEqual(say(output), [
                `${LOOKS}it makes no Unix socket (JVM attach, as JMockit and some profilers and agents use, needs one). ${FOREGROUND}`,
            ]);
        }
    });

    test("Docker's daemon is reached through a Unix socket", () => {
        assert.deepEqual(say(RECORDED.docker), [
            `${LOOKS}it makes no Unix socket (Docker's daemon is reached through one). ${FOREGROUND}`,
        ]);
    });

    test("Python, Node, socat, nc and Go, each as it prints it", () => {
        const generic = `${LOOKS}it makes no Unix socket (the program tried to make or reach one). ${FOREGROUND}`;
        for (const name of ["python", "pythonScript", "nodeConnect", "nodeListen", "socat", "nc", "go"] as const) {
            assert.deepEqual(say(RECORDED[name]), [generic], name);
        }
    });

    test("the sign is found among a long output, and only one line is added", () => {
        const noise = Array.from({ length: 300 }, (_, index) => `> Task :test line ${index}`).join("\n");
        const lines = say(`${noise}\n${RECORDED.jvm8}\n${RECORDED.python}\n${noise}`);
        assert.equal(lines.length, 1);
        assert.match(lines[0] ?? "", /JVM attach/, "the first signature in the list wins");
    });
});

describe("when the line is not said", () => {
    test("a command that did not fail gets none, whatever it printed", () => {
        for (const text of Object.values(RECORDED)) {
            assert.deepEqual(say(text, {}), []);
        }
    });

    test("a failure that has nothing of the sort gets none", () => {
        for (const text of [
            "Tests failed: 3",
            "PermissionError: [Errno 1] Operation not permitted: '/proc/1/mem'",
            "chown: changing ownership of 'x': Operation not permitted",
            "connect EPERM 10.0.0.1:443",
            "nc: connect to 10.0.0.1 port 80 (tcp) failed: Operation not permitted",
            "Unable to open the file",
            "Cannot connect to the Docker daemon at tcp://10.0.0.1:2375",
            "AttachNotSupportedException: the VM disabled attach",
        ]) {
            assert.deepEqual(say(text), [], text);
        }
    });

    test("a raw socket that Python shows is not taken for a Unix socket", () => {
        const raw = RECORDED.pythonScript.replace("AF_UNIX, socket.SOCK_STREAM", "AF_INET, socket.SOCK_RAW, 1");
        assert.deepEqual(say(raw), []);
    });

    test("the line follows the other explanations and counts with them", () => {
        const output = `bash: ${set.home}/.bashrc: Read-only file system\n${RECORDED.nodeConnect}`;
        const lines = say(output);
        assert.equal(lines.length, 2);
        assert.match(lines[0] ?? "", /cannot write ~\/\.bashrc/);
        assert.match(lines[1] ?? "", /this failure looks like the sandbox/);
    });
});

describe("the way through", () => {
    test("a background task cannot run outside, so it is told to run the command in the foreground", () => {
        const [line] = say(RECORDED.jvm8, { failure: { background: true } });
        assert.match(
            line ?? "",
            /A background task cannot run outside the sandbox: run the command again in the foreground with outside: true and a reason, which asks the user\.$/,
        );
    });

    test("a read-only role may not run outside, so it is told to report", () => {
        const readOnly = rules(linux(), { settings: { share: [], hide: [], lock: [], readOnly: true } });
        const [line] = explainBlocks(RECORDED.jvm8, readOnly, { cwd: CWD, mode: "open", ...failed }).lines;
        assert.match(
            line ?? "",
            /This agent's role may not run a command outside the sandbox, so tell the user what needs it\.$/,
        );
        assert.doesNotMatch(line ?? "", /outside: true/);
    });
});

describe("the list", () => {
    test("is small, and every pattern is anchored on a tool's own words", () => {
        assert.ok(FAILURE_SIGNATURES.length <= 5);
        for (const signature of FAILURE_SIGNATURES) {
            assert.match(signature.reason, /^it .+\(.+\)$/);
            assert.ok(signature.patterns.length > 0);
            // A pattern that matches an empty string, or a bare errno, would say it of every failure.
            for (const pattern of signature.patterns) {
                assert.equal(pattern.test(""), false, String(pattern));
                assert.equal(pattern.test("Operation not permitted"), false, String(pattern));
                assert.equal(pattern.test("EPERM"), false, String(pattern));
            }
        }
    });
});

describe("a background task's end", () => {
    const task = (over: Partial<Task>): Task =>
        ({
            id: "bg-1",
            name: "tests",
            command: "./gradlew test",
            cwd: CWD,
            sandboxLines: [],
            state: "exited",
            ...over,
        }) as Task;
    const prepared = { finish: async () => ({ violations: [] }) } as never;

    async function ended(over: Partial<Task>): Promise<AfterInput> {
        let seen: AfterInput | undefined;
        const aftermath: Aftermath = {
            before: () => undefined,
            after: async (input) => {
                seen = input;
                return [];
            },
        };
        const subject = task({ pid: 1, ...over });
        // The tail of the log is read from the task's own log; with none, there is nothing to read and the call still happens.
        await afterEnd(
            aftermath,
            () => ({ hasUI: false }) as never,
            subject,
            prepared,
            undefined,
            () => 0,
        );
        assert.ok(seen, "the aftermath was asked");
        return seen;
    }

    test("is handed its exit code, and told it is a background task", async () => {
        const input = await ended({ exitCode: 1 });
        assert.equal(input.exitCode, 1);
        assert.equal(input.background, true);
    });

    test("a task that was stopped did not fail on its own, whatever code the signal left", async () => {
        const input = await ended({ exitCode: 143, killReason: "by agent", state: "killed" });
        assert.equal(input.exitCode, undefined);
    });
});

describe("the whole call, in the real sandbox", { skip: skipUnlessRealSandbox() }, () => {
    let s: Session;
    before(async () => {
        s = realSession({
            options: { background: { timing: { flushMs: 60, inFlightMs: 500, errorGapMs: 30_000, errorWakeups: 3 } } },
        });
        await s.start();
    });
    after(() => s.cleanup());

    const sandboxLines = (text: string): string[] => text.split("\n").filter((line) => line.startsWith("[sandbox]"));

    test("Python, Node and socat cannot make a Unix socket, and each says so once", async () => {
        const commands = [
            `python3 -c "import socket; socket.socket(socket.AF_UNIX)"`,
            `node -e "require('net').connect('/tmp/x.sock').on('error',e=>{console.log(e.message);process.exit(1)})"`,
            "socat - UNIX-CONNECT:/tmp/x.sock",
        ];
        for (const command of commands) {
            const result = await s.bash(`${command} 2>&1`);
            assert.match(result.text, /Command exited with code 1/, command);
            const lines = sandboxLines(result.text);
            assert.equal(lines.length, 1, `${command}\n${result.text}`);
            assert.ok((lines[0] ?? "").startsWith(`${LOOKS}it makes no Unix socket`), result.text);
            assert.ok((lines[0] ?? "").endsWith(FOREGROUND), result.text);
        }
    });

    test("a JVM's attach message from a failed command gets the line; the same words from a command that worked do not", async () => {
        const failing = await s.bash(`echo '${RECORDED.jvm8}'; exit 1`);
        assert.match(sandboxLines(failing.text).join("\n"), /JVM attach/);
        const working = await s.bash(`echo '${RECORDED.jvm8}'; echo done`);
        assert.doesNotMatch(working.text, /Command exited/);
        assert.deepEqual(sandboxLines(working.text), []);
    });

    test("an ordinary failure, and a TCP connection that is refused, get no line", async () => {
        for (const command of [
            "ls /no/such/folder-here",
            `python3 -c "import socket; socket.create_connection(('127.0.0.1', 1))"`,
            `python3 -c "import os; os.chown('/proc/1/mem', 0, 0)"`,
        ]) {
            const result = await s.bash(`${command} 2>&1`);
            assert.match(result.text, /Command exited with code [1-9]/, command);
            assert.doesNotMatch(result.text, /looks like the sandbox/, `${command}\n${result.text}`);
        }
    });

    test("a background task that fails the same way is told to run in the foreground", async () => {
        const started = await s.bash(`python3 -c "import socket; socket.socket(socket.AF_UNIX)"; exit 1`, {
            background: true,
            name: "socket",
        });
        assert.equal(started.isError, false, started.text);
        const wake = await until(
            () =>
                s.pi.messages.find(
                    (item) =>
                        item.message.customType === "jig-sandbox-background" &&
                        String(item.message.content).includes('"socket": exited'),
                ),
            15_000,
            "the exit message",
        );
        const content = String(wake.message.content);
        assert.equal(content.split("\n").filter((line) => line.startsWith(LOOKS)).length, 1, content);
        assert.match(
            content,
            /A background task cannot run outside the sandbox: run the command again in the foreground/,
        );
    });
});
