// A pseudo-terminal around a command, for the tests that need a terminal. util-linux `script` takes the command as one
// shell string with `-c`; BSD's, which macOS ships, runs the command and its arguments itself. Either writes the
// transcript to a file (/dev/null here) and puts the command's own output on this process's stdout.
import { spawnSync } from "node:child_process";

/** Whether this machine's `script` can make a pty: a test that needs one skips when it cannot. */
export function ptyAvailable(): boolean {
    // BSD `script`, which macOS ships, keeps the terminal it is given: a pipe or a socket on stdin makes it fail with
    // "tcgetattr/ioctl: Operation not supported on socket" before the command runs.
    if (process.platform === "darwin" && process.stdin.isTTY !== true) return false;
    const found = spawnSync("sh", ["-c", "command -v script"], { encoding: "utf8" });
    return found.status === 0 && found.stdout.trim() !== "";
}

/** The arguments that run `command` under a pty, chosen by platform. */
export function ptyArgv(command: readonly string[]): string[] {
    if (process.platform === "darwin") return ["-q", "/dev/null", ...command];
    return ["-qec", command.map(shellWord).join(" "), "/dev/null"];
}

/** One word for a POSIX shell, quoted only when it needs it. */
function shellWord(word: string): string {
    return /^[A-Za-z0-9_@%+=:,./-]+$/.test(word) ? word : `'${word.replaceAll("'", "'\\''")}'`;
}
