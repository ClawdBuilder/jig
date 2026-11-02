// A fake `ssh` first on PATH that answers `ssh -G <host>` as the real program does from `~/.ssh/config`, and logs every call.
// By default a host is its own `hostname`, as for a name the configuration does not mention; `alias` gives an alias its real host.
// Nothing here reads a real `~/.ssh`, starts the real ssh or connects anywhere: the jig-git code under test only ever asks for
// `-G`, which never connects, and this script is what answers.
import fs from "node:fs";
import path from "node:path";
import { setEnv } from "./repos.ts";
import type { Sandbox } from "./repos.ts";

export type SshAnswer = "answer" | "fail" | "hang" | "no-hostname";

export interface FakeSshConfig {
    /** The arguments of every run so far, in order. */
    calls(): string[][];
    /** The hosts asked about so far, in order. */
    hosts(): string[];
    /** `Host <alias>` with `HostName <hostname>`. */
    alias(alias: string, hostname: string): void;
    /** How ssh answers from now on: with the hostname, with an error, never, or without a `hostname` line. */
    behave(answer: SshAnswer): void;
    /** Forgets the aliases and the calls, and answers again. */
    reset(): void;
}

const SCRIPT = `const fs = require("node:fs");
const path = require("node:path");
const dir = __dirname;
const args = process.argv.slice(2);
fs.appendFileSync(path.join(dir, "calls.jsonl"), JSON.stringify(args) + "\\n");
const how = fs.existsSync(path.join(dir, "how")) ? fs.readFileSync(path.join(dir, "how"), "utf8") : "answer";
if (how === "fail") {
    process.stderr.write("ssh: Could not resolve hostname: Name or service not known\\n");
    process.exit(255);
}
if (how === "hang") setTimeout(() => process.exit(0), 600000);
else {
    if (args[0] !== "-G" || !args[1]) {
        process.stderr.write("fake ssh: only -G <host> is answered, got " + args.join(" ") + "\\n");
        process.exit(2);
    }
    const aliases = JSON.parse(fs.readFileSync(path.join(dir, "aliases.json"), "utf8"));
    const host = args[1];
    const lines = ["user git", "port 22"];
    if (how !== "no-hostname") lines.unshift("hostname " + (aliases[host] ?? host));
    process.stdout.write(lines.join("\\n") + "\\n");
}
`;

/** Puts a fake `ssh` first on PATH until the sandbox is cleaned up. */
export function installFakeSshConfig(sb: Sandbox): FakeSshConfig {
    const dir = path.join(sb.root, "fake-ssh-config");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "ssh"), `#!${process.execPath}\n${SCRIPT}`, { mode: 0o755 });
    setEnv("PATH", `${dir}${path.delimiter}${process.env.PATH ?? ""}`);
    const aliases = path.join(dir, "aliases.json");
    const how = path.join(dir, "how");
    const log = path.join(dir, "calls.jsonl");
    const reset = () => {
        fs.writeFileSync(aliases, "{}");
        fs.writeFileSync(how, "answer");
        fs.rmSync(log, { force: true });
    };
    reset();
    const calls = (): string[][] =>
        fs.existsSync(log)
            ? fs
                  .readFileSync(log, "utf8")
                  .split("\n")
                  .filter(Boolean)
                  .map((line) => JSON.parse(line) as string[])
            : [];
    return {
        calls,
        hosts: () => calls().map((args) => args[1] ?? ""),
        alias(alias, hostname) {
            const known = JSON.parse(fs.readFileSync(aliases, "utf8")) as Record<string, string>;
            fs.writeFileSync(aliases, JSON.stringify({ ...known, [alias]: hostname }));
        },
        behave: (answer) => fs.writeFileSync(how, answer),
        reset,
    };
}
