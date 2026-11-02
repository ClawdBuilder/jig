// Protected paths: what Pi's own file tools may not read or write, whatever the configuration says.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, afterEach, before, beforeEach, describe, test } from "node:test";
import { buildPolicy, emptyAdditions, parseConfig } from "../src/config.ts";
import type { LoadedConfig } from "../src/config.ts";
import { checkFileTool, defaultProtectedPaths, relocatedStores } from "../src/protected-paths.ts";
import type { CheckContext, Env, ProtectedPath } from "../src/protected-paths.ts";
import { start } from "./support/harness.ts";
import type { Harness, StartOptions } from "./support/harness.ts";
import { rawRecords, tempState } from "./support/state.ts";

// A small world on disk: a home folder, a project inside it, and Pi's agent folder.
let root: string;
let home: string;
let project: string;
let agent: string;
let elsewhere: string;

function touch(file: string): void {
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, "x");
}

before(() => {
    root = realpathSync(mkdtempSync(path.join(tmpdir(), "jig-protected-")));
    home = path.join(root, "home");
    project = path.join(home, "project");
    agent = path.join(home, ".pi", "agent");
    elsewhere = path.join(root, "elsewhere");
    for (const file of [
        "home/.ssh/id_ed25519",
        "home/.config/gh/hosts.yml",
        "home/project/src/main.ts",
        "home/.pi/agent/auth.json",
        "home/.pi/agent/jig.json",
        "home/.pi/agent/sessions/one.jsonl",
        "home/.pi/agent/jig-review/passkeys.json",
        "elsewhere/notes.txt",
    ]) {
        touch(path.join(root, file));
    }
    mkdirSync(path.join(agent, "extensions"), { recursive: true });
});
after(() => rmSync(root, { recursive: true, force: true }));

function context(overrides: Partial<CheckContext> = {}, env: Env = {}): CheckContext {
    const platform = overrides.platform;
    return {
        entries: defaultProtectedPaths({
            agentDir: agent,
            home,
            env,
            ...(platform === undefined ? {} : { platform }),
        }),
        cwd: project,
        home,
        ...overrides,
    };
}

const check = (tool: string, target: string | undefined, ctx: CheckContext = context()) =>
    checkFileTool(tool, target === undefined ? {} : { path: target }, ctx);

describe("the defaults", () => {
    const homeSecrets = [
        ".ssh",
        ".gnupg",
        ".password-store",
        ".aws",
        ".kube",
        ".azure",
        ".config/gcloud",
        ".config/gh",
        ".config/glab-cli",
        ".postman",
        ".docker/config.json",
        ".netrc",
        ".git-credentials",
        ".npmrc",
        ".pypirc",
    ];

    test("every credential folder and file in the home folder is secret: no reading, no writing", () => {
        for (const name of homeSecrets) {
            const target = path.join(home, name);
            for (const tool of ["read", "write", "edit"]) {
                const refusal = check(tool, target);
                assert.ok(refusal, `${tool} ${name}`);
                assert.match(
                    refusal.reason,
                    new RegExp(`^${tool} is refused: ~/${name.replace(".", "\\.")} holds credentials`),
                );
            }
            // And a file inside a folder.
            if (!name.includes(".docker") && !name.startsWith(".net") && !name.endsWith("rc")) {
                assert.ok(check("read", path.join(target, "inside", "file")), `read inside ${name}`);
            }
        }
    });

    test("Pi's login and MCP sign-in files in the agent folder are secret", () => {
        for (const name of ["auth.json", "mcp-auth.json"]) {
            for (const tool of ["read", "write", "edit"]) {
                const refusal = check(tool, path.join(agent, name));
                assert.ok(refusal, `${tool} ${name}`);
                assert.match(refusal.reason, /holds credentials/);
                assert.equal(refusal.entry?.kind, "secret");
            }
        }
    });

    test("the whole agent folder is guarded: reading is allowed, writing is not", () => {
        const guarded = [
            "jig.json",
            "settings.json",
            "extensions/new.ts",
            "themes/mine.json",
            "jig-review/passkeys.json",
            "jig-anything/state.json",
            "sessions/one.jsonl",
        ];
        for (const name of guarded) {
            const target = path.join(agent, name);
            for (const tool of ["write", "edit"]) {
                const refusal = check(tool, target);
                assert.ok(refusal, `${tool} ${name}`);
                assert.match(refusal.reason, /is guarded: the file tools can read it but not write it/);
                assert.equal(refusal.entry?.kind, "guarded");
            }
            assert.equal(check("read", target), undefined, `read ${name}`);
            assert.equal(check("grep", target), undefined, `grep ${name}`);
        }
        assert.ok(check("write", agent), "the folder itself is not writable either");
        assert.equal(check("read", path.join(agent, "jig.json")), undefined);
    });

    test("a secret file inside the guarded folder is reported as a secret, not as guarded", () => {
        const refusal = check("write", path.join(agent, "auth.json"));
        assert.equal(refusal?.entry?.kind, "secret");
    });

    test("ordinary files are not protected", () => {
        for (const tool of ["read", "write", "edit", "grep", "find", "ls"]) {
            assert.equal(check(tool, path.join(project, "src", "main.ts")), undefined, tool);
            assert.equal(check(tool, path.join(home, ".sshd-notes")), undefined, `${tool} .sshd-notes`);
            assert.equal(check(tool, path.join(home, ".config", "ghost")), undefined, `${tool} .config/ghost`);
            assert.equal(check(tool, elsewhere), undefined, tool);
        }
    });

    test("$XDG_CONFIG_HOME holds gh, glab and gcloud for those who set it; a relative one is ignored", () => {
        const xdg = path.join(root, "xdg");
        const ctx = context({}, { XDG_CONFIG_HOME: xdg });
        for (const name of ["gh", "glab-cli", "gcloud"]) {
            assert.ok(check("read", path.join(xdg, name, "token"), ctx), name);
            assert.ok(check("write", path.join(xdg, name), ctx), name);
        }
        assert.equal(check("read", path.join(xdg, "other", "file"), ctx), undefined);
        const relative = context({}, { XDG_CONFIG_HOME: "xdg" });
        assert.equal(check("read", path.join(project, "xdg", "gh", "hosts.yml"), relative), undefined);
    });

    test("an unknown agent folder leaves out the paths inside it, and the home ones stay", () => {
        const entries = defaultProtectedPaths({ agentDir: "", home, env: {} });
        assert.ok(entries.some((entry) => entry.shown === "~/.ssh"));
        assert.ok(!entries.some((entry) => entry.kind === "guarded"));
    });
});

describe("stores that the environment moves", () => {
    const moved = (env: Env, platform?: NodeJS.Platform, homeFolder = home) =>
        relocatedStores(env, homeFolder, platform);
    const pathsOf = (entries: readonly ProtectedPath[]) => entries.map((item) => item.path);

    test("each variable names a secret default, and says in `shown` which variable did", () => {
        const cases: Array<[variable: string, value: string, protectedPath: string]> = [
            ["PASSWORD_STORE_DIR", "/srv/pass", "/srv/pass"],
            ["GNUPGHOME", "/srv/gpg", "/srv/gpg"],
            ["AWS_CONFIG_FILE", "/srv/aws/config", "/srv/aws/config"],
            ["AWS_SHARED_CREDENTIALS_FILE", "/srv/aws/credentials", "/srv/aws/credentials"],
            ["KUBECONFIG", "/srv/kube/config", "/srv/kube/config"],
            ["GH_CONFIG_DIR", "/srv/gh", "/srv/gh"],
            ["GLAB_CONFIG_DIR", "/srv/glab", "/srv/glab"],
            ["CLOUDSDK_CONFIG", "/srv/gcloud", "/srv/gcloud"],
            ["DOCKER_CONFIG", "/srv/docker", "/srv/docker/config.json"],
        ];
        for (const [variable, value, protectedPath] of cases) {
            assert.deepEqual(
                moved({ [variable]: value }),
                [
                    {
                        path: protectedPath,
                        shown: `${protectedPath} (from ${variable})`,
                        kind: "secret",
                        source: "default",
                    },
                ],
                variable,
            );
        }
    });

    test("a path under the home folder is shown with ~, and `~/` is read as the home folder", () => {
        const expected = [`${home}/vault/pass`];
        assert.deepEqual(pathsOf(moved({ PASSWORD_STORE_DIR: `${home}/vault/pass` })), expected);
        assert.deepEqual(pathsOf(moved({ PASSWORD_STORE_DIR: "~/vault/pass" })), expected);
        assert.deepEqual(
            moved({ PASSWORD_STORE_DIR: "~/vault/pass" }).map((item) => item.shown),
            ["~/vault/pass (from PASSWORD_STORE_DIR)"],
        );
    });

    test("a variable that is unset or empty, and one that is not on the list, protects nothing", () => {
        assert.deepEqual(moved({}), []);
        assert.deepEqual(moved({ PASSWORD_STORE_DIR: undefined, GNUPGHOME: "", KUBECONFIG: "" }), []);
        assert.deepEqual(moved({ PATH: "/usr/bin", HOME: home, PASSWORD_STORE_DIR_OLD: "/srv/pass" }), []);
    });

    test("a relative value is ignored, because it depends on where the tool runs", () => {
        for (const value of ["pass", "./pass", "../pass", "~other/pass", " /srv/pass"]) {
            assert.deepEqual(moved({ PASSWORD_STORE_DIR: value, GH_CONFIG_DIR: value }), [], value);
        }
    });

    test("KUBECONFIG is a list of files: each absolute one counts, and the empty and relative ones do not", () => {
        const value = ["/srv/kube/one", "", "relative/two", "~/kube/three", "/srv/kube/four"].join(path.delimiter);
        assert.deepEqual(pathsOf(moved({ KUBECONFIG: value })), [
            "/srv/kube/one",
            `${home}/kube/three`,
            "/srv/kube/four",
        ]);
        for (const entry of moved({ KUBECONFIG: value })) assert.match(entry.shown, / \(from KUBECONFIG\)$/);
    });

    test("only KUBECONFIG is a list: another variable is one path, whatever it contains", () => {
        assert.deepEqual(pathsOf(moved({ GNUPGHOME: "/srv/a:/srv/b" })), ["/srv/a:/srv/b"]);
    });

    test("on Windows the list is split on `;` and paths are compared without regard to case", () => {
        const winHome = "C:\\Users\\hp";
        const entries = moved({ KUBECONFIG: "D:\\k\\one;D:\\k\\two;relative" }, "win32", winHome);
        assert.deepEqual(pathsOf(entries), ["D:\\k\\one", "D:\\k\\two"]);
        assert.deepEqual(moved({ GNUPGHOME: "c:\\users\\HP" }, "win32", winHome), []);
        assert.deepEqual(pathsOf(moved({ GNUPGHOME: "C:\\Users\\hp\\gnupg" }, "win32", winHome)), [
            "C:\\Users\\hp\\gnupg",
        ]);
    });

    test("the root, the home folder and a folder above it are never protected", () => {
        const above = path.dirname(home);
        for (const value of ["/", home, `${home}/`, `${home}/sub/..`, "~", "~/", above, path.dirname(above)]) {
            for (const variable of ["PASSWORD_STORE_DIR", "GNUPGHOME", "GH_CONFIG_DIR", "KUBECONFIG"]) {
                assert.deepEqual(moved({ [variable]: value }), [], `${variable}=${value}`);
            }
        }
        assert.deepEqual(moved({ GNUPGHOME: "/" }, undefined, ""), [], "also when the home folder is not known");
    });

    test("DOCKER_CONFIG protects the file that holds the login, so the home folder as its value is fine", () => {
        assert.deepEqual(pathsOf(moved({ DOCKER_CONFIG: home })), [`${home}/config.json`]);
        assert.deepEqual(pathsOf(moved({ DOCKER_CONFIG: "/" })), ["/config.json"]);
    });

    test("they are part of the defaults, after the built-in ones, and the agent folder stays last", () => {
        const entries = defaultProtectedPaths({ agentDir: agent, home, env: { PASSWORD_STORE_DIR: "/srv/pass" } });
        const places = pathsOf(entries);
        assert.ok(places.indexOf("/srv/pass") > places.indexOf(`${home}/.pypirc`));
        assert.equal(entries.at(-1)?.path, agent);
        assert.equal(entries.at(-1)?.kind, "guarded");
        assert.ok(!pathsOf(defaultProtectedPaths({ agentDir: agent, home, env: {} })).includes("/srv/pass"));
        assert.ok(!pathsOf(defaultProtectedPaths({ agentDir: agent, home })).includes("/srv/pass"));
    });

    test("a store in its usual place is listed once, under its built-in name", () => {
        const entries = defaultProtectedPaths({
            agentDir: agent,
            home,
            env: { PASSWORD_STORE_DIR: `${home}/.password-store`, GNUPGHOME: "~/.gnupg" },
        });
        assert.deepEqual(
            entries.filter((item) => /\.(password-store|gnupg)$/.test(item.path)).map((item) => item.shown),
            ["~/.gnupg", "~/.password-store"],
        );
    });

    test("the file tools refuse a path under a store that is not in the home folder, and the message names the variable", () => {
        const store = path.join(elsewhere, "vault", "pass");
        const ctx = context({}, { PASSWORD_STORE_DIR: store });
        const inside = path.join(store, "work", "db.gpg");
        for (const tool of ["read", "write", "edit", "grep", "find", "ls"]) {
            assert.equal(
                check(tool, inside, ctx)?.reason,
                `${tool} is refused: ${store} (from PASSWORD_STORE_DIR) holds credentials, so the file tools neither read nor write it`,
                tool,
            );
        }
        assert.ok(check("write", store, ctx), "the store itself");
        assert.match(check("grep", elsewhere, ctx)?.reason ?? "", /^grep is refused: the folder to search contains /);
        assert.equal(check("find", elsewhere, ctx), undefined, "names only, so a folder that contains it is fine");
        assert.equal(check("read", path.join(elsewhere, "vault", "other", "file"), ctx), undefined);
        assert.equal(check("read", path.join(elsewhere, "notes.txt"), ctx), undefined);
    });

    test("without the variable the same path is readable, so the refusal comes from the environment", () => {
        const store = path.join(elsewhere, "vault", "pass");
        assert.equal(check("read", path.join(store, "work", "db.gpg"), context()), undefined);
        assert.equal(
            check("read", path.join(store, "work", "db.gpg"), context({}, { PASSWORD_STORE_DIR: "pass" })),
            undefined,
        );
    });

    test("a link in the project that points into a moved store is refused", () => {
        const store = path.join(elsewhere, "gnupg-moved");
        mkdirSync(store, { recursive: true });
        const link = path.join(project, "gpg-link");
        symlinkSync(store, link);
        try {
            assert.match(
                check("read", "gpg-link/pubring.kbx", context({}, { GNUPGHOME: store }))?.reason ?? "",
                /\(from GNUPGHOME\) holds credentials/,
            );
        } finally {
            rmSync(link, { force: true });
        }
    });
});

describe("how a path is read", () => {
    test("~ is the home folder", () => {
        assert.ok(check("read", "~/.ssh/id_ed25519"));
        assert.ok(check("write", "~/.pi/agent/jig.json"));
        assert.equal(check("read", "~/project/src/main.ts"), undefined);
    });

    test("a relative path starts from Pi's working folder", () => {
        assert.ok(check("read", ".ssh/id_ed25519", context({ cwd: home })));
        assert.ok(check("read", "../.ssh/id_ed25519", context({ cwd: project })));
        assert.equal(check("read", "src/main.ts", context({ cwd: project })), undefined);
        assert.ok(check("write", "jig.json", context({ cwd: agent })));
        assert.ok(check("write", "./extensions/x.ts", context({ cwd: agent })));
    });

    test("`..` is folded away, also in the middle of a path", () => {
        assert.ok(check("read", path.join(project, "src", "..", "..", ".ssh", "id_ed25519")));
        assert.ok(check("read", `${project}/src/../../.config/gh/hosts.yml`));
        assert.ok(check("write", `${project}/../.pi/agent/settings.json`));
        assert.equal(check("read", `${project}/../project/src/main.ts`), undefined);
    });

    test("an @ in front, unusual spaces and a file: address are read as Pi reads them", () => {
        assert.ok(check("read", "@~/.ssh/id_ed25519"));
        assert.ok(check("read", `file://${path.join(home, ".ssh", "id_ed25519")}`));
        assert.ok(check("read", `${home}/.ssh/id_ed25519`));
    });

    test("a path that does not exist yet is checked as it would be created", () => {
        assert.ok(check("write", path.join(home, ".ssh", "authorized_keys")));
        assert.ok(check("write", path.join(agent, "jig-new", "deep", "file.json")));
        assert.equal(check("write", path.join(project, "new", "file.ts")), undefined);
    });

    test("a missing path means the working folder for the tools that search, and nothing to check for the others", () => {
        assert.equal(check("read", undefined), undefined);
        assert.equal(check("write", undefined), undefined);
        assert.equal(check("ls", undefined), undefined);
        assert.ok(check("ls", undefined, context({ cwd: path.join(home, ".ssh") })));
    });

    test("a path that is not text is refused", () => {
        for (const tool of ["read", "write", "grep", "ls"]) {
            const refusal = checkFileTool(tool, { path: 7 }, context());
            assert.match(refusal?.reason ?? "", /its path is not text/);
        }
    });

    test("tools that are not file tools are not checked here", () => {
        assert.equal(checkFileTool("bash", { path: path.join(home, ".ssh") }, context()), undefined);
        assert.equal(checkFileTool("git", { path: path.join(home, ".ssh") }, context()), undefined);
    });
});

describe("symlinks", () => {
    let links: string;
    before(() => {
        links = path.join(project, "links");
        mkdirSync(links, { recursive: true });
        symlinkSync(path.join(home, ".ssh"), path.join(links, "keys"));
        symlinkSync(path.join(home, ".ssh", "id_ed25519"), path.join(links, "key-file"));
        symlinkSync("../../.ssh", path.join(links, "relative-keys"));
        symlinkSync(path.join(links, "keys"), path.join(links, "chain"));
        symlinkSync(path.join(agent, "extensions", "not-yet.ts"), path.join(links, "dangling"));
        symlinkSync(path.join(agent), path.join(links, "agent"));
        symlinkSync(elsewhere, path.join(links, "harmless"));
        symlinkSync(path.join(links, "loop-b"), path.join(links, "loop-a"));
        symlinkSync(path.join(links, "loop-a"), path.join(links, "loop-b"));
    });

    test("a link in the project that points into a secret folder is caught, for every tool that reads", () => {
        for (const link of ["keys", "keys/id_ed25519", "key-file", "relative-keys/id_ed25519", "chain/id_ed25519"]) {
            const target = path.join(links, link);
            assert.ok(check("read", target), `read ${link}`);
            assert.ok(check("write", target), `write ${link}`);
            assert.ok(check("grep", target), `grep ${link}`);
            assert.ok(check("ls", target), `ls ${link}`);
        }
    });

    test("a link to the guarded folder cannot be written through, but can be read", () => {
        assert.ok(check("write", path.join(links, "agent", "jig.json")));
        assert.equal(check("read", path.join(links, "agent", "jig.json")), undefined);
    });

    test("a dangling link is followed too: a write through it would create the file it points to", () => {
        assert.ok(check("write", path.join(links, "dangling")));
        assert.ok(check("edit", path.join(links, "dangling")));
    });

    test("a link that points somewhere harmless is not protected", () => {
        assert.equal(check("read", path.join(links, "harmless", "notes.txt")), undefined);
        assert.ok(check("write", path.join(links, "harmless", "notes.txt")) === undefined);
    });

    test("a loop of links does not hang, and is not claimed to be a secret", () => {
        assert.equal(check("read", path.join(links, "loop-a")), undefined);
    });

    test("`..` after a link is read both ways: folded as Pi does, and from the link's target as the system does", () => {
        // links/keys is home/.ssh, so links/keys/.. is home, and home/.ssh is reached again.
        assert.ok(check("read", `${links}/keys/../.ssh/id_ed25519`));
        // links/harmless is `elsewhere`, so links/harmless/.. is root, which holds no secret.
        assert.equal(check("read", `${links}/harmless/../home/project/src/main.ts`), undefined);
        // Folded first, `links/harmless/../../../.ssh` is `home/.ssh`; read from the link, it is somewhere else.
        assert.ok(check("read", `${links}/harmless/../../../.ssh/id_ed25519`));
    });

    test("a protected folder that is itself a link is protected by its real place too", () => {
        // A secret folder that is a link to a real folder somewhere else.
        mkdirSync(path.join(elsewhere, "real-aws"), { recursive: true });
        touch(path.join(elsewhere, "real-aws", "credentials"));
        symlinkSync(path.join(elsewhere, "real-aws"), path.join(home, ".aws"));
        try {
            assert.ok(check("read", path.join(home, ".aws", "credentials")), "through the link");
            assert.ok(check("read", path.join(elsewhere, "real-aws", "credentials")), "at the real place");
            assert.ok(check("grep", elsewhere), "a folder that holds the real place");
        } finally {
            rmSync(path.join(home, ".aws"), { force: true });
            rmSync(path.join(elsewhere, "real-aws"), { recursive: true, force: true });
        }
    });

    test("grep on a folder that holds a link into a secret folder searches what grep searches: not the link target", () => {
        // ripgrep does not follow links it meets while walking, so the folder is fine to search.
        assert.equal(check("grep", links), undefined);
    });
});

describe("grep, find and ls", () => {
    test("grep is refused when the folder it searches contains a secret path", () => {
        for (const target of [home, path.join(home, ".config"), path.dirname(home), "/", "~", "~/.config", agent]) {
            const refusal = check("grep", target);
            assert.ok(refusal, `grep ${target}`);
            assert.match(
                refusal.reason,
                /the folder to search contains .* which holds credentials; search a narrower folder/,
            );
        }
        // Searching a narrower folder is fine.
        for (const target of [project, path.join(agent, "sessions"), path.join(agent, "extensions"), elsewhere]) {
            assert.equal(check("grep", target), undefined, `grep ${target}`);
        }
    });

    test("grep without a path searches the working folder, and is judged by it", () => {
        assert.equal(check("grep", undefined, context({ cwd: project })), undefined);
        assert.ok(check("grep", undefined, context({ cwd: home })));
        assert.match(check("grep", undefined, context({ cwd: home }))?.reason ?? "", /narrower folder/);
    });

    test("grep inside a secret path is refused as a read", () => {
        const refusal = check("grep", path.join(home, ".ssh"));
        assert.match(refusal?.reason ?? "", /^grep is refused: ~\/\.ssh holds credentials/);
    });

    test("find and ls list names only: an ancestor is fine, a secret folder is not", () => {
        for (const tool of ["find", "ls"]) {
            for (const target of [home, path.join(home, ".config"), agent, "/", project]) {
                assert.equal(check(tool, target), undefined, `${tool} ${target}`);
            }
            for (const target of [
                path.join(home, ".ssh"),
                path.join(home, ".config", "gh"),
                path.join(agent, "auth.json"),
            ]) {
                assert.match(check(tool, target)?.reason ?? "", /holds credentials/, `${tool} ${target}`);
            }
        }
    });
});

describe("case", () => {
    const winHome = "C:\\Users\\hp";
    const winAgent = "C:\\Users\\hp\\.pi\\agent";
    const win = (overrides: Partial<CheckContext> = {}): CheckContext => ({
        entries: defaultProtectedPaths({
            agentDir: winAgent,
            home: winHome,
            env: { APPDATA: "C:\\Users\\hp\\AppData\\Roaming" },
            platform: "win32",
        }),
        cwd: "C:\\Users\\hp\\project",
        home: winHome,
        platform: "win32",
        ...overrides,
    });

    test("on Windows paths are compared without regard to case, and with either kind of slash", () => {
        for (const target of [
            "C:\\Users\\hp\\.ssh\\id_rsa",
            "c:\\users\\HP\\.SSH\\id_rsa",
            "C:/Users/hp/.ssh/id_rsa",
            "~\\.ssh\\id_rsa",
            "~/.SSH/id_rsa",
            "..\\.ssh\\id_rsa",
            "C:\\Users\\hp\\project\\..\\.Ssh",
            "C:\\Users\\hp\\AppData\\Roaming\\github cli\\hosts.yml",
        ]) {
            assert.ok(check("read", target, win()), target);
        }
        assert.ok(check("write", "C:\\USERS\\HP\\.PI\\AGENT\\jig.json", win()));
        assert.equal(check("read", "C:\\USERS\\HP\\.PI\\AGENT\\jig.json", win()), undefined);
        assert.equal(check("read", "C:\\Users\\hp\\project\\src\\main.ts", win()), undefined);
        assert.ok(check("grep", "c:\\users\\hp", win()));
        assert.equal(check("grep", "C:\\Users\\hp\\project", win()), undefined);
    });

    test("a Git Bash style drive path is read as Pi reads it on Windows", () => {
        assert.ok(check("read", "/c/Users/hp/.ssh/id_rsa", win()));
        assert.ok(check("read", "/mnt/c/users/hp/.ssh/id_rsa", win()));
    });

    test("on macOS too, and on Linux case counts", () => {
        const mac = context({ platform: "darwin" });
        assert.ok(check("read", path.join(home, ".SSH", "id_ed25519"), mac));
        assert.ok(check("write", path.join(agent, "JIG.JSON"), mac));
        assert.equal(check("read", path.join(home, ".SSH", "id_ed25519"), context({ platform: "linux" })), undefined);
        assert.equal(check("read", path.join(home, ".SSH", "id_ed25519")), undefined, "this process, which is Linux");
    });
});

// ---- configuration -------------------------------------------------------------------------------------------------------

const FILE = "/somewhere/jig.json";
const personalWith = (raw: unknown): LoadedConfig => {
    const parsed = parseConfig(raw, FILE);
    return { file: FILE, found: true, ...parsed };
};
const policyOf = (raw: unknown, company = emptyAdditions()) =>
    buildPolicy(personalWith(raw), company, {
        entries: defaultProtectedPaths({ agentDir: agent, home, env: {} }),
        home,
    });
const listed = (entries: readonly ProtectedPath[]) =>
    entries.map((entry) => `${entry.kind} ${entry.shown} ${entry.source}`);

describe("configuration can add protected paths and never remove one", () => {
    test("jig.json adds secret and guarded paths, written with ~ or in full", () => {
        const policy = policyOf({
            protectedPaths: { secret: ["~/.config/other-cli", "/srv/keys"], guarded: ["~/dotfiles"] },
        });
        assert.deepEqual(policy.problems, []);
        const mine = listed(policy.protectedPaths).filter((line) => line.endsWith("personal"));
        assert.deepEqual(mine, [
            "secret ~/.config/other-cli personal",
            "secret /srv/keys personal",
            "guarded ~/dotfiles personal",
        ]);
        const ctx = context({ entries: policy.protectedPaths });
        assert.ok(check("read", path.join(home, ".config", "other-cli", "token"), ctx));
        assert.ok(check("read", "/srv/keys/one", ctx));
        assert.ok(check("write", path.join(home, "dotfiles", "zshrc"), ctx));
        assert.equal(check("read", path.join(home, "dotfiles", "zshrc"), ctx), undefined);
        // The defaults are all still there.
        assert.ok(check("read", path.join(home, ".ssh", "id_ed25519"), ctx));
    });

    test("a company plugin adds paths too, and /jig can tell them apart", async () => {
        const company = emptyAdditions();
        const { addCompanyProtectedPaths } = await import("../src/config.ts");
        addCompanyProtectedPaths(company, { secret: ["~/.config/company-cli"], guarded: ["/opt/company/etc"] });
        const policy = policyOf({ protectedPaths: { secret: ["~/.mine"] } }, company);
        assert.deepEqual(policy.problems, []);
        assert.deepEqual(
            listed(policy.protectedPaths).filter((line) => !line.endsWith("default")),
            ["secret ~/.mine personal", "secret ~/.config/company-cli company", "guarded /opt/company/etc company"],
        );
    });

    test("a company's wrong path is a problem named `company`, and the rest still applies", async () => {
        const company = emptyAdditions();
        const { addCompanyProtectedPaths } = await import("../src/config.ts");
        addCompanyProtectedPaths(company, { secret: ["relative/dir", "~/.ok"], extra: [] });
        const policy = policyOf({}, company);
        assert.deepEqual(
            policy.problems.map((problem) => [problem.source, problem.key]),
            [
                ["company", "protectedPaths.extra"],
                ["company", "protectedPaths.secret[0]"],
            ],
        );
        assert.ok(listed(policy.protectedPaths).includes("secret ~/.ok company"));
    });

    test("listing a default again as guarded does not weaken it, and as secret strengthens a guarded one", () => {
        const policy = policyOf({ protectedPaths: { guarded: ["~/.ssh"], secret: ["~/.pi/agent"] } });
        const entry = (shown: string) => policy.protectedPaths.find((item) => item.shown === shown);
        assert.equal(entry("~/.ssh")?.kind, "secret");
        assert.equal(entry("~/.ssh")?.source, "default");
        assert.equal(entry("~/.pi/agent")?.kind, "secret", "an addition can make a path stricter");
        assert.ok(check("read", path.join(agent, "jig.json"), context({ entries: policy.protectedPaths })));
    });

    test("there is no way to remove one: the file has no such key", () => {
        for (const raw of [
            { protectedPaths: { allow: ["~/.ssh"] } },
            { protectedPaths: { remove: ["~/.ssh"] } },
            { protectedPaths: { secret: [] }, unprotected: ["~/.ssh"] },
        ]) {
            const policy = policyOf(raw);
            assert.ok(policy.problems.length > 0, JSON.stringify(raw));
            assert.ok(
                check("read", path.join(home, ".ssh", "id_ed25519"), context({ entries: policy.protectedPaths })),
            );
        }
    });

    test("the file is checked, with the key named", () => {
        const problems = (raw: unknown) =>
            parseConfig(raw, FILE).problems.map((problem) => `${problem.key}: ${problem.message}`);
        assert.deepEqual(problems({ protectedPaths: { secret: ["relative"] } }), [
            "protectedPaths.secret[0]: must be an absolute path, or start with ~/",
        ]);
        assert.deepEqual(problems({ protectedPaths: { secret: "~/.x" } }), [
            "protectedPaths.secret: must be a list of paths",
        ]);
        assert.deepEqual(problems({ protectedPaths: [] }), [
            "protectedPaths: must be an object with lists of paths: secret and guarded",
        ]);
        assert.deepEqual(problems({ protectedPaths: { guarded: [""] } }), [
            "protectedPaths.guarded[0]: must be a path of up to 1024 characters",
        ]);
        assert.deepEqual(problems({ protectedPaths: { guarded: [3] } }), [
            "protectedPaths.guarded[0]: must be a path of up to 1024 characters",
        ]);
        assert.deepEqual(problems({ protectedPaths: { guarded: ["~/a\nb"] } }), [
            "protectedPaths.guarded[0]: must not hold control characters",
        ]);
        assert.deepEqual(problems({ protectedPaths: { secret: ["~/.a"], guarded: ["/b"] } }), []);
    });
});

// ---- the hook ------------------------------------------------------------------------------------------------------------

describe("the tool_call hook", () => {
    const state = tempState();
    const savedHome = process.env.HOME;
    const savedGh = process.env.GH_CONFIG_DIR;
    let h: Harness | undefined;

    beforeEach(() => {
        state.start();
        process.env.HOME = home;
    });
    afterEach(async () => {
        await h?.shutdown();
        h = undefined;
        state.stop();
        if (savedHome === undefined) delete process.env.HOME;
        else process.env.HOME = savedHome;
        if (savedGh === undefined) delete process.env.GH_CONFIG_DIR;
        else process.env.GH_CONFIG_DIR = savedGh;
    });
    async function begin(options: StartOptions = {}): Promise<Harness> {
        h = await start({ cwd: project, ...options });
        return h;
    }

    test("denies a read of a credential file, names the path, and records a floor decision", async () => {
        const harness = await begin();
        const outcome = await harness.call({ tool: "read", input: { path: "~/.ssh/id_ed25519" } });
        assert.equal(outcome.blocked, true);
        assert.equal(outcome.ran, false);
        assert.equal(
            outcome.reason,
            "Blocked by jig-core: read is refused: ~/.ssh holds credentials, so the file tools neither read nor write it.",
        );
        assert.deepEqual(
            harness.decisions().map((d) => [d.tool, d.environment, d.effect, d.decision, d.source]),
            [["read", "local", "read", "deny", "floor"]],
        );
        const [record] = harness.records().filter((line) => line.kind === "call");
        assert.equal(record?.decision, "deny");
        assert.equal(record?.decisionSource, "floor");
        assert.equal(record?.errorKind, "denied");
        assert.ok(!rawRecords(harness.stateDir).includes("id_ed25519"), "the record holds no path the user typed");
    });

    test("denies a write to the agent folder, and allows a read of it", async () => {
        const harness = await begin();
        const write = await harness.call({
            tool: "write",
            input: { path: path.join(harness.agentDir, "jig.json"), content: "{}" },
        });
        assert.equal(write.blocked, true);
        assert.match(write.reason ?? "", /write is refused: .*is guarded: the file tools can read it but not write it/);
        const edit = await harness.call({
            tool: "edit",
            input: { path: path.join(harness.agentDir, "settings.json"), edits: [] },
        });
        assert.equal(edit.blocked, true);
        const read = await harness.call({ tool: "read", input: { path: path.join(harness.agentDir, "jig.json") } });
        assert.equal(read.blocked, false);
        assert.deepEqual(
            harness.decisions().map((d) => [d.tool, d.decision, d.source]),
            [
                ["write", "deny", "floor"],
                ["edit", "deny", "floor"],
                ["read", "allow", "table"],
            ],
        );
    });

    test("the agent folder is the one Pi uses, so a profile's own folder is protected", async () => {
        const harness = await begin();
        const outcome = await harness.call({
            tool: "write",
            input: { path: path.join(harness.agentDir, "jig-review", "keys.json") },
        });
        assert.equal(outcome.blocked, true);
        const auth = await harness.call({ tool: "read", input: { path: path.join(harness.agentDir, "auth.json") } });
        assert.match(auth.reason ?? "", /holds credentials/);
    });

    test("grep on a folder that holds a secret path says to search a narrower folder", async () => {
        const harness = await begin();
        const outcome = await harness.call({ tool: "grep", input: { pattern: "token", path: "~" } });
        assert.equal(outcome.blocked, true);
        assert.match(
            outcome.reason ?? "",
            /grep is refused: the folder to search contains .* search a narrower folder\.$/,
        );
        const narrow = await harness.call({ tool: "grep", input: { pattern: "token", path: "src" } });
        assert.equal(narrow.blocked, false);
    });

    test("a rule in jig.json cannot allow it", async () => {
        const harness = await begin({
            config: {
                rules: [
                    { tool: "read", decision: "allow" },
                    { tool: "*", environment: "local", decision: "allow" },
                    { tool: "write", effect: "write", decision: "allow" },
                ],
            },
        });
        const read = await harness.call({ tool: "read", input: { path: "~/.config/gh/hosts.yml" } });
        const write = await harness.call({ tool: "write", input: { path: path.join(harness.agentDir, "jig.json") } });
        assert.equal(read.blocked, true);
        assert.equal(write.blocked, true);
        assert.deepEqual(
            harness.decisions().map((d) => [d.decision, d.source]),
            [
                ["deny", "floor"],
                ["deny", "floor"],
            ],
        );
    });

    test("jig.json and a company plugin add paths, which the same hook refuses", async () => {
        const harness = await begin({
            config: { protectedPaths: { secret: ["~/.config/mine"] } },
            plugins: (api) =>
                api.config.addProtectedPaths({ secret: ["~/.config/company"], guarded: ["~/company-etc"] }),
        });
        for (const [tool, target] of [
            ["read", "~/.config/mine/token"],
            ["read", "~/.config/company/token"],
            ["write", "~/company-etc/rules"],
        ] as const) {
            assert.equal((await harness.call({ tool, input: { path: target } })).blocked, true, `${tool} ${target}`);
        }
        assert.equal((await harness.call({ tool: "read", input: { path: "~/company-etc/rules" } })).blocked, false);
    });

    test("a plugin cannot take a protected path away: only addProtectedPaths exists, and it adds", async () => {
        const harness = await begin({ plugins: (api) => api.config.addProtectedPaths({ guarded: ["~/.ssh"] }) });
        assert.equal((await harness.call({ tool: "read", input: { path: "~/.ssh/id_ed25519" } })).blocked, true);
    });

    test("a symlink in the project into a secret folder is refused through the hook", async () => {
        const link = path.join(project, "key-link");
        symlinkSync(path.join(home, ".ssh"), link);
        try {
            const harness = await begin();
            const outcome = await harness.call({ tool: "read", input: { path: "key-link/id_ed25519" } });
            assert.equal(outcome.blocked, true);
            assert.match(outcome.reason ?? "", /~\/\.ssh holds credentials/);
        } finally {
            rmSync(link, { force: true });
        }
    });

    test("a store that Pi's environment moves is refused through the hook and listed for the sandbox", async () => {
        const store = path.join(elsewhere, "hook-store");
        const saved = process.env.PASSWORD_STORE_DIR;
        process.env.PASSWORD_STORE_DIR = store;
        try {
            const harness = await begin();
            const read = await harness.call({ tool: "read", input: { path: path.join(store, "work", "db.gpg") } });
            const write = await harness.call({ tool: "write", input: { path: path.join(store, "new.gpg") } });
            assert.equal(read.blocked, true);
            assert.equal(write.blocked, true);
            assert.match(read.reason ?? "", /\(from PASSWORD_STORE_DIR\) holds credentials/);
            assert.deepEqual(
                harness.decisions().map((d) => [d.tool, d.decision, d.source]),
                [
                    ["read", "deny", "floor"],
                    ["write", "deny", "floor"],
                ],
            );
            assert.deepEqual(
                harness.api.protectedPaths.list().filter((item) => item.path === store),
                [{ path: store, shown: `${store} (from PASSWORD_STORE_DIR)`, kind: "secret", source: "default" }],
            );
        } finally {
            if (saved === undefined) delete process.env.PASSWORD_STORE_DIR;
            else process.env.PASSWORD_STORE_DIR = saved;
        }
    });

    test("other tools, and the file tools on other paths, run as before", async () => {
        const harness = await begin();
        for (const [tool, input] of [
            ["read", { path: "src/main.ts" }],
            ["write", { path: "src/new.ts", content: "x" }],
            ["find", { pattern: "*.ts" }],
            ["ls", {}],
            ["bash", { command: "cat ~/.ssh/id_ed25519" }],
        ] as const) {
            assert.equal((await harness.call({ tool, input })).blocked, false, tool);
        }
    });

    test("/jig rules lists the protected paths and where each came from", async () => {
        process.env.GH_CONFIG_DIR = path.join(elsewhere, "gh-moved");
        const harness = await begin({
            config: { protectedPaths: { secret: ["~/.config/mine"] } },
            plugins: (api) => api.config.addProtectedPaths({ guarded: ["~/company-etc"] }),
        });
        const command = harness.host.commands.get("jig");
        assert.ok(command);
        await command.handler("rules", harness.ctx as never);
        const shown = [
            ...harness.ui.notifications.map((entry) => entry.message),
            ...harness.ui.selects.map((entry) => entry.options.join("\n")),
        ].join("\n");
        assert.match(
            shown,
            /Protected paths for read, write, edit, grep, find and ls \(a floor rule: configuration can only add\):/,
        );
        assert.match(shown, /secret \(the file tools neither read nor write these\):/);
        assert.match(shown, /~\/\.ssh {2}\(default\)/);
        assert.ok(
            shown.includes(`${elsewhere}/gh-moved (from GH_CONFIG_DIR)  (default)`),
            "a moved store names its variable",
        );
        assert.match(shown, /~\/\.config\/mine {2}\(your jig\.json\)/);
        assert.match(shown, /guarded \(the file tools can read these, not write them\):/);
        assert.match(shown, /~\/company-etc {2}\(a company plugin\)/);
        assert.ok(shown.includes(`${harness.agentDir}  (default)`), "the agent folder, as Pi has it");
    });
});
