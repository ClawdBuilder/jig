// `npm run check:gateway`: the gateway as an agent that is not Pi gets it: packed, installed with no Pi anywhere, and asked real questions.
//
// The gateway's own tests run inside a full checkout, where Pi, the dev dependencies and the source tree are all at hand. A person who uses Jig
// in Claude Code or another agent has none of them: npm gives them the package, and their agent starts `jig-gateway`. This script is that person.
//   1. the tracked files of this working tree are copied to a temporary folder, packed with `npm pack`, and the tarball is installed (no
//      install scripts, no dev dependencies) into an empty project;
//   2. the install must hold no Pi package and no TypeBox, and npm must have linked the command `jig-gateway`: that is the proof of "no Pi";
//   3. a small git repository with one tag is made, and its remote is a name that nobody contacts;
//   4. the installed gateway starts, with no JIG_HOME, so on its built-in defaults, and speaks MCP on its standard input and output: it must
//      offer the tools jig, pr and release, answer a read, refuse a write with the line Jig says when nobody can be asked, and list both in its status;
//   5. when its input ends it must leave with code 0 in ten seconds;
//   6. `jig lens` of the installed package, with no Pi, must show the calls as records of the agent "check-gateway", enforced by the gateway.
// Only Node's own modules are imported, so it runs with no `npm ci`, on Linux, macOS and Windows. It needs network access for npm and git.
// The home is a temporary one, and the child programs get a small environment, so nothing of the developer's own settings is read or changed.
//   node scripts/check-gateway.mjs [--keep]      the temporary folder is removed at the end; --keep, or a failure, leaves it and prints where it is
import { spawn, spawnSync } from "node:child_process";
import {
    existsSync,
    mkdirSync,
    mkdtempSync,
    readdirSync,
    readFileSync,
    realpathSync,
    rmSync,
    writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { copyTree } from "./lib/tree-copy.mjs";

const REPO = path.resolve(import.meta.dirname, "..");
const keep = process.argv.includes("--keep");
const read = (file) => JSON.parse(readFileSync(file, "utf8"));

/** What the engine says of a call that needs a question when nobody can be asked (plugins/jig-core/src/gateway/runtime.ts). */
const NO_SCREEN = "Blocked by jig-core: this call needs approval and there is no screen to ask on.";
const CLIENT = "check-gateway";
const TOOLS = ["jig", "pr", "release"];
const ANSWER_MS = 60_000;
const LEAVE_MS = 10_000;

/** Quotes one argument for cmd.exe, which reads a command as one string. */
const quoted = (word) => (/[\s"&|<>^()%]/.test(word) ? `"${word.replaceAll('"', '\\"')}"` : word);

/** What a gateway said on standard error, ready to end a message with; nothing when it said nothing. */
const noted = (stderr) => (stderr.trim() === "" ? "" : `\nstderr:\n${stderr.trim()}`);

/** Runs a program to its end and returns its output; a failure stops the check with that output. */
function run(file, args, options) {
    const { shell, ...rest } = options ?? {};
    // A shell reads one string, and Node warns when it is given arguments beside a shell, so the string is made here.
    const result = shell
        ? spawnSync([file, ...args.map(quoted)].join(" "), { encoding: "utf8", timeout: 600_000, shell: true, ...rest })
        : spawnSync(file, args, { encoding: "utf8", timeout: 600_000, ...rest });
    if (result.status !== 0) {
        const output = `${result.stdout ?? ""}${result.stderr ?? ""}`.trim();
        throw new Error(
            `${[path.basename(file), ...args].join(" ")} failed (${result.status ?? result.error?.message}):\n${output}`,
        );
    }
    return result.stdout;
}

/** npm, the one that started this script when there is one. Windows starts npm.cmd, which only a shell can start. */
function npm(args, options) {
    const script = process.env.npm_execpath;
    if (script !== undefined && script !== "") return run(process.execPath, [script, ...args], options);
    return run("npm", args, { ...options, shell: process.platform === "win32" });
}

/**
 * What every program started here gets: a small list, and a home of its own. The real home would let a file there (an npm or git
 * setting) change what the check proves, and a record the gateway writes must not land in the developer's own state folder.
 */
function environment(home, cache, gitConfig) {
    const same = [
        "PATH",
        "TMPDIR",
        "TEMP",
        "TMP",
        "LANG",
        "SystemRoot",
        "ComSpec",
        "PATHEXT",
        "windir",
        "HTTP_PROXY",
        "HTTPS_PROXY",
        "NO_PROXY",
        "http_proxy",
        "https_proxy",
        "no_proxy",
        "NODE_EXTRA_CA_CERTS",
        "SSL_CERT_FILE",
        "SSL_CERT_DIR",
    ];
    return {
        ...Object.fromEntries(
            same.filter((name) => process.env[name] !== undefined).map((name) => [name, process.env[name]]),
        ),
        HOME: home,
        USERPROFILE: home,
        APPDATA: path.join(home, "AppData", "Roaming"),
        LOCALAPPDATA: path.join(home, "AppData", "Local"),
        GIT_CONFIG_GLOBAL: gitConfig,
        GIT_CONFIG_NOSYSTEM: "1",
        GIT_TERMINAL_PROMPT: "0",
        npm_config_cache: cache,
        npm_config_update_notifier: "false",
    };
}

/** The packages in a node_modules folder, nested ones too, as names such as "@scope/name" or "a/node_modules/b". */
function installedPackages(modules, prefix = "") {
    const found = [];
    for (const entry of readdirSync(modules, { withFileTypes: true })) {
        if (entry.name.startsWith(".") || !entry.isDirectory()) continue;
        const names = entry.name.startsWith("@")
            ? readdirSync(path.join(modules, entry.name)).map((child) => `${entry.name}/${child}`)
            : [entry.name];
        for (const name of names) {
            found.push(prefix + name);
            const nested = path.join(modules, name, "node_modules");
            if (existsSync(nested)) found.push(...installedPackages(nested, `${prefix}${name}/node_modules/`));
        }
    }
    return found;
}

/** Pi's own packages and TypeBox, which Pi supplies to an extension: none of them may be in an install that is to run without Pi. */
function isPi(name) {
    const last = name.split("/node_modules/").at(-1) ?? "";
    return last.startsWith("@earendil-works/") || last === "typebox";
}

/** Packs the copy of the tree, installs the tarball into an empty project, and returns the installed package's folder. */
function install(root, env) {
    const tree = path.join(root, "tree");
    const project = path.join(root, "project");
    mkdirSync(project);
    const copied = copyTree(REPO, tree);
    console.log(`packing ${copied.length} files`);
    const packed = JSON.parse(
        npm(["pack", "--json", "--ignore-scripts", "--pack-destination", root], { cwd: tree, env }),
    );
    const tarball = path.join(root, (Array.isArray(packed) ? packed[0] : Object.values(packed)[0]).filename);
    writeFileSync(path.join(project, "package.json"), '{"name":"check-gateway-project","private":true}\n');
    console.log("installing the tarball, with no install scripts and no dev dependencies");
    npm(["install", "--ignore-scripts", "--omit=dev", "--no-audit", "--no-fund", tarball], { cwd: project, env });

    const modules = path.join(project, "node_modules");
    const problems = installedPackages(modules).filter(isPi);
    if (problems.length > 0)
        throw new Error(
            `Pi is in the install, so this does not prove the gateway runs without it:\n  ${problems.join("\n  ")}`,
        );
    const linked = existsSync(path.join(modules, ".bin")) ? readdirSync(path.join(modules, ".bin")) : [];
    if (!linked.some((name) => name === "jig-gateway" || name === "jig-gateway.cmd"))
        throw new Error("npm did not link the command jig-gateway into node_modules/.bin");
    return { project, folder: path.join(modules, "@clawdbuilder", "jig") };
}

/** A repository with one commit, the annotated tag v1.0.0 and an origin that is a name only: nothing here reaches a network. */
function makeRepository(folder, env) {
    mkdirSync(folder);
    writeFileSync(
        env.GIT_CONFIG_GLOBAL,
        "[user]\n\tname = Jig Check\n\temail = check@example.com\n[init]\n\tdefaultBranch = main\n[commit]\n\tgpgsign = false\n[tag]\n\tgpgsign = false\n",
    );
    writeFileSync(path.join(folder, "README.md"), "A repository for the gateway check.\n");
    for (const args of [
        ["init", "-q"],
        ["add", "-A"],
        ["commit", "-q", "-m", "The first commit"],
        ["tag", "-a", "v1.0.0", "-m", "Version 1.0.0"],
        ["remote", "add", "origin", "https://github.com/example/example.git"],
    ]) {
        run("git", args, { cwd: folder, env });
    }
}

/** Starts the gateway and speaks MCP to it: one JSON object a line, in both directions. */
function startGateway(file, cwd, env) {
    const child = spawn(process.execPath, [file], { cwd, env, stdio: ["pipe", "pipe", "pipe"] });
    const pending = new Map();
    const badLines = [];
    let stderr = "";
    let buffer = "";
    let next = 1;
    child.stderr.on("data", (chunk) => {
        stderr += chunk;
    });
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
        buffer += chunk;
        for (let end = buffer.indexOf("\n"); end >= 0; end = buffer.indexOf("\n")) {
            const line = buffer.slice(0, end).replace(/\r$/, "");
            buffer = buffer.slice(end + 1);
            if (line === "") continue;
            try {
                const message = JSON.parse(line);
                pending.get(message.id)?.(message);
            } catch {
                badLines.push(line);
            }
        }
    });
    const exited = new Promise((resolve) => child.once("exit", (code, signal) => resolve({ code, signal })));
    // A gateway that has left makes a write fail; the check reports that through its answer, not through a crash here.
    child.stdin.on("error", () => {});
    const send = (message) => child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", ...message })}\n`);

    /** One request and its answer. A JSON-RPC error is a failure of the check: a refused call is a result, not an error. */
    async function request(method, params) {
        const id = next++;
        const answered = new Promise((resolve) => pending.set(id, resolve));
        send({ id, method, params });
        let timer;
        const late = new Promise((resolve) => {
            timer = setTimeout(() => resolve({ late: true }), ANSWER_MS);
        });
        const answer = await Promise.race([answered, late, exited.then((result) => ({ left: result }))]);
        clearTimeout(timer);
        pending.delete(id);
        if (answer.late) throw new Error(`${method}: no answer in ${ANSWER_MS / 1000} s.${noted(stderr)}`);
        if (answer.left)
            throw new Error(
                `${method}: the gateway left (code ${answer.left.code}) before it answered.${noted(stderr)}`,
            );
        if (answer.error) throw new Error(`${method} failed: ${JSON.stringify(answer.error)}`);
        return answer.result;
    }

    /** A tool call: the text of the answer, and whether the gateway marked it an error. */
    async function call(name, args) {
        const result = await request("tools/call", { name, arguments: args });
        const text = (result.content ?? []).map((part) => part.text ?? "").join("\n");
        return { text, isError: result.isError === true };
    }

    /** Ends the input, as an agent does when it closes, and waits for the gateway to leave. */
    async function close() {
        child.stdin.end();
        let timer;
        const late = new Promise((resolve) => {
            timer = setTimeout(() => resolve({ late: true }), LEAVE_MS);
        });
        const result = await Promise.race([exited, late]);
        clearTimeout(timer);
        if (result.late) {
            child.kill();
            throw new Error(`the gateway did not leave in ${LEAVE_MS / 1000} s after its input ended.${noted(stderr)}`);
        }
        if (buffer !== "") badLines.push(buffer);
        return { ...result, badLines, stderr };
    }
    return { request, notify: (method) => send({ method }), call, close, kill: () => child.kill() };
}

/** Asks the installed gateway what it offers and what it decides; returns what it said, and what it left on stderr. */
async function askGateway(file, repo, cwd, env) {
    const gateway = startGateway(file, cwd, env);
    const problems = [];
    try {
        const hello = await gateway.request("initialize", {
            protocolVersion: "2025-06-18",
            capabilities: {},
            clientInfo: { name: CLIENT, version: "1.0.0" },
        });
        if (hello.protocolVersion !== "2025-06-18")
            problems.push(`initialize answered revision ${hello.protocolVersion}, not 2025-06-18`);
        if (hello.serverInfo?.name !== "jig")
            problems.push(`initialize named the server ${hello.serverInfo?.name}, not jig`);
        gateway.notify("notifications/initialized");

        const listed = await gateway.request("tools/list", {});
        const names = listed.tools.map((tool) => tool.name).sort();
        if (names.join(",") !== TOOLS.join(","))
            problems.push(`tools/list gave ${names.join(", ")}, not ${TOOLS.join(", ")}`);

        const tags = await gateway.call("release", { action: "tags", dir: repo });
        if (tags.isError || !tags.text.includes("v1.0.0"))
            problems.push(`release tags did not name v1.0.0: ${tags.text}`);

        // A write. Nobody can be asked, so it is refused with this line, and no program (gh, glab) is started for it.
        const write = await gateway.call("pr", { action: "comment", number: 1, body: "x", dir: repo });
        if (!write.isError || !write.text.includes(NO_SCREEN))
            problems.push(`pr comment was not refused with the no-screen line: ${write.text}`);

        // The status lists each call as "<time> <tool> <action>: <decision>".
        const status = await gateway.call("jig", { action: "status" });
        for (const call of ["release tags", "pr comment"]) {
            if (status.isError || !status.text.includes(call))
                problems.push(`jig status does not list the call ${call}:\n${status.text}`);
        }
    } catch (error) {
        gateway.kill();
        throw error;
    }
    const finished = await gateway.close();
    if (finished.code !== 0) problems.push(`the gateway left with code ${finished.code ?? finished.signal}, not 0`);
    if (finished.badLines.length > 0)
        problems.push(`standard output held lines that are not JSON:\n  ${finished.badLines.join("\n  ")}`);
    if (problems.length > 0) throw new Error(`${problems.join("\n")}${noted(finished.stderr)}`);
}

/** The installed launcher's lens, with no Pi: the three calls must be there, as the agent "check-gateway", enforced by the gateway. */
function checkLens(folder, cwd, env) {
    const lines = run(process.execPath, [path.join(folder, "bin", "jig.mjs"), "lens"], { cwd, env }).split("\n");
    const mine = lines.filter((line) => line.includes(CLIENT) && line.replace(CLIENT, "").includes("gateway"));
    if (mine.length < TOOLS.length)
        throw new Error(
            `jig lens shows ${mine.length} calls of ${CLIENT} enforced by the gateway, not ${TOOLS.length}:\n${lines.join("\n")}`,
        );
}

async function main() {
    const manifest = read(path.join(REPO, "package.json"));
    const root = realpathSync(mkdtempSync(path.join(tmpdir(), "jig-gateway-check-")));
    const home = path.join(root, "home");
    mkdirSync(home);
    // npm's own cache, found before the home is replaced: a download costs time, and a cache holds nothing that changes the result.
    const cache = npm(["config", "get", "cache"]).trim();
    const env = environment(home, cache, path.join(root, "gitconfig"));
    let failed = false;
    try {
        console.log(`Jig ${manifest.version}, Node ${process.version}, npm ${npm(["--version"], { env }).trim()}`);
        const { project, folder } = install(root, env);
        const file = path.join(folder, read(path.join(folder, "package.json")).bin["jig-gateway"]);
        const repo = path.join(root, "repo");
        makeRepository(repo, env);
        console.log(`starting ${path.relative(root, file)}`);
        await askGateway(file, repo, project, env);
        checkLens(folder, project, env);
        console.log(
            `ok: the packed gateway ran with no Pi: three tools, a read answered, a write refused, a clean exit, three calls on the lens (Node ${process.version}, ${process.platform})`,
        );
    } catch (error) {
        failed = true;
        console.error(error instanceof Error ? error.message : error);
        process.exitCode = 1;
    } finally {
        if (keep || failed) console.log(`kept: ${root}`);
        else rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    }
}

await main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
});
