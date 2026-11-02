// The real host behind the host in origin's address: asked of `ssh -G` for an ssh origin, with the `github.com-<alias>` convention
// when ssh cannot say, and `git.forges` over both. A fake `ssh` answers `-G` (never the real one, never a real `~/.ssh`), and
// `githubRepo` and `forgeOf` are checked against each other, since they must not disagree.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, before, beforeEach, test } from "node:test";
import { settingsFrom } from "../src/config.ts";
import { forgeOf, gitlabHome, UnknownForgeHost } from "../src/forge.ts";
import { gh, repoArgument, requireRemote } from "../src/github.ts";
import { forgetSshAnswers, isSshOrigin } from "../src/origin-host.ts";
import { githubRepo, resolveRepo } from "../src/repo.ts";
import { setupHarness } from "./support/harness.ts";
import type { Harness } from "./support/harness.ts";
import { git, makeRepo } from "./support/repos.ts";

let h: Harness;
let counter = 0;
before(() => {
    h = setupHarness();
});
beforeEach(() => h.reset());
after(() => h.cleanup());

/** A clone whose origin is `url`. Nothing here contacts a host: the URL is only read. */
async function repoAt(url: string) {
    const fixture = makeRepo(h.sb, `alias${++counter}`);
    git(fixture.dir, "remote", "set-url", "origin", url);
    return resolveRepo(fixture.name);
}

const ssh = (alias: string) => `git@${alias}:acme/orders-api.git`;

/** What `githubRepo` tells gh, and the GH_HOST that gh helper starts it with (undefined: gh's own default, github.com). */
async function toldToGh(repo: Awaited<ReturnType<typeof repoAt>>, section: unknown) {
    const settings = settingsFrom(section);
    const remote = await githubRepo(repo, settings);
    if (remote === undefined) return undefined;
    h.gh.reset();
    h.gh.on("api", { json: {} });
    await gh(["api", "user"], { host: remote.host });
    return { host: remote.host, GH_HOST: h.gh.calls().at(-1)?.host, argument: repoArgument(remote) };
}

test("an ssh alias that ssh maps to github.com is GitHub with no git.forges entry, whatever its name", async () => {
    for (const alias of ["gh-work", "team-code", "github.com-myteam", "work.example.org"]) {
        h.ssh.alias(alias, "github.com");
        const repo = await repoAt(ssh(alias));
        assert.deepEqual(await forgeOf(repo, settingsFrom({})), { forge: "github" }, alias);
        assert.deepEqual(
            await toldToGh(repo, {}),
            { host: "github.com", GH_HOST: undefined, argument: "acme/orders-api" },
            alias,
        );
    }
});

test("ssh is asked as `ssh -G <host>`, for the host alone: no user, no port, no path", async () => {
    h.ssh.alias("gh-work", "github.com");
    await githubRepo(await repoAt("ssh://git@gh-work:2222/acme/orders-api.git"), settingsFrom({}));
    await githubRepo(await repoAt("git@GH-Work:acme/orders-api.git"), settingsFrom({}));
    assert.deepEqual(
        h.ssh.calls(),
        [["-G", "gh-work"]],
        "the second host is the first in lower case, so it is not asked again",
    );
    const asked = h.jig.started_processes.filter((process) => process.file === "ssh");
    assert.equal(asked.length, 1);
    assert.deepEqual(asked[0]?.args, ["-G", "gh-work"]);
});

test("an alias that ssh maps to another GitHub host needs that host named in git.forges, and is then told to gh", async () => {
    h.ssh.alias("ghe-work", "ghe.example.com");
    const repo = await repoAt(ssh("ghe-work"));
    await assert.rejects(
        forgeOf(repo, settingsFrom({})),
        (error: Error) =>
            error instanceof UnknownForgeHost &&
            error.message ===
                `origin of ${repo.name} is on ghe-work, which ssh resolves to ghe.example.com, which jig-git does not know as GitHub or GitLab; name it in jig.json, such as "git": { "forges": { "ghe.example.com": "gitlab" } }`,
    );
    assert.equal(await githubRepo(repo, settingsFrom({})), undefined);

    const section = { forges: { "ghe.example.com": "github" } };
    assert.deepEqual(await forgeOf(repo, settingsFrom(section)), { forge: "github", host: "ghe.example.com" });
    assert.deepEqual(await toldToGh(repo, section), {
        host: "ghe.example.com",
        GH_HOST: "ghe.example.com",
        argument: "ghe.example.com/acme/orders-api",
    });
});

test("an alias that ssh maps to a self-hosted GitLab named in git.forges is GitLab on that host", async () => {
    h.ssh.alias("gl-work", "gitlab.example.com");
    const repo = await repoAt("git@gl-work:platform/payments/orders-api.git");
    const section = { forges: { "gitlab.example.com": "gitlab" } };
    assert.deepEqual(await forgeOf(repo, settingsFrom(section)), {
        forge: "gitlab",
        host: "gitlab.example.com",
        path: "platform/payments/orders-api",
    });
    assert.equal(await githubRepo(repo, settingsFrom(section)), undefined);
    assert.equal((await gitlabHome(repo, settingsFrom(section)))?.host, "gitlab.example.com");
    h.ssh.alias("gl-com", "altssh.gitlab.com");
    assert.deepEqual(await forgeOf(await repoAt("git@gl-com:acme/orders-api.git"), settingsFrom({})), {
        forge: "gitlab",
        host: "gitlab.com",
        path: "acme/orders-api",
    });
});

test("a string-form entry decides the forge, and the host comes from ssh's answer", async () => {
    h.ssh.alias("gh-work", "github.com");
    h.ssh.alias("ghe-work", "ghe.example.com");
    const github = await repoAt(ssh("gh-work"));
    const ghe = await repoAt(ssh("ghe-work"));
    const section = { forges: { "gh-work": "github", "ghe-work": "github" } };
    assert.deepEqual(await forgeOf(github, settingsFrom(section)), { forge: "github", host: "github.com" });
    assert.deepEqual(await toldToGh(github, section), {
        host: "github.com",
        GH_HOST: undefined,
        argument: "acme/orders-api",
    });
    assert.deepEqual(await forgeOf(ghe, settingsFrom(section)), { forge: "github", host: "ghe.example.com" });
    assert.equal((await toldToGh(ghe, section))?.GH_HOST, "ghe.example.com");
});

test("an object-form entry with a host wins over ssh's answer and the convention", async () => {
    h.ssh.alias("gh-work", "github.com");
    h.ssh.alias("github.com-team", "github.com");
    const section = {
        forges: {
            "gh-work": { forge: "github", host: "ghe.example.com" },
            "github.com-team": { forge: "github", host: "ghe.example.com" },
        },
    };
    for (const alias of ["gh-work", "github.com-team"]) {
        const repo = await repoAt(ssh(alias));
        assert.deepEqual(
            await forgeOf(repo, settingsFrom(section)),
            { forge: "github", host: "ghe.example.com" },
            alias,
        );
        assert.deepEqual(
            await toldToGh(repo, section),
            { host: "ghe.example.com", GH_HOST: "ghe.example.com", argument: "ghe.example.com/acme/orders-api" },
            alias,
        );
    }
    const withoutHost = settingsFrom({ forges: { "gh-work": { forge: "github" } } });
    assert.equal(
        (await githubRepo(await repoAt(ssh("gh-work")), withoutHost))?.host,
        "github.com",
        "no host in the entry: ssh's",
    );
});

test("a GitHub Enterprise host named in string form, with nothing to resolve, is told to gh as itself", async () => {
    const section = { forges: { "ghe.example.com": "github" } };
    const repo = await repoAt(ssh("ghe.example.com"));
    assert.deepEqual(await forgeOf(repo, settingsFrom(section)), { forge: "github" });
    assert.deepEqual(await toldToGh(repo, section), {
        host: "ghe.example.com",
        GH_HOST: "ghe.example.com",
        argument: "ghe.example.com/acme/orders-api",
    });
});

test("the clone host is github.com unless ssh says otherwise", async () => {
    const section = { cloneHost: "gh-work" };
    const plain = await repoAt(ssh("gh-work"));
    assert.deepEqual(await forgeOf(plain, settingsFrom(section)), { forge: "github" });
    assert.equal((await toldToGh(plain, section))?.GH_HOST, undefined);
    h.ssh.alias("gh-work", "ghe.example.com");
    forgetSshAnswers();
    assert.equal((await githubRepo(plain, settingsFrom(section)))?.host, "ghe.example.com");
});

test("ssh that is missing, fails, times out or has no hostname falls back to the convention, quietly", async () => {
    // The incident: a string-form entry on a `github.com-<alias>` host, where gh was once told the alias as its GH_HOST.
    const section = { forges: { "github.com-myteam": "github" } };
    const check = async (how: string) => {
        forgetSshAnswers();
        const repo = await repoAt(ssh("github.com-myteam"));
        assert.deepEqual(await forgeOf(repo, settingsFrom(section)), { forge: "github", host: "github.com" }, how);
        assert.deepEqual(
            await toldToGh(repo, section),
            { host: "github.com", GH_HOST: undefined, argument: "acme/orders-api" },
            how,
        );
        assert.deepEqual(await forgeOf(repo, settingsFrom({})), { forge: "github" }, `${how}: and with no entry`);
        // Another alias has no convention, so it is what it was before ssh was asked: refused unless named.
        const other = await repoAt(ssh("gh-work"));
        await assert.rejects(forgeOf(other, settingsFrom({})), UnknownForgeHost, how);
        assert.equal(
            (await githubRepo(other, settingsFrom({ forges: { "gh-work": "github" } })))?.host,
            "gh-work",
            how,
        );
    };

    h.ssh.behave("fail");
    await check("ssh fails");
    h.ssh.behave("no-hostname");
    await check("ssh prints no hostname");
    h.ssh.behave("hang");
    h.jig.forceTimeout(150, (file) => file === "ssh");
    await check("ssh times out");
    h.jig.forceTimeout(undefined);

    h.ssh.behave("answer");
    const noSsh = path.join(h.sb.root, "no-ssh");
    fs.mkdirSync(noSsh);
    fs.symlinkSync(which("git"), path.join(noSsh, "git"));
    const saved = process.env.PATH;
    process.env.PATH = [noSsh, path.join(h.sb.root, "fake-gh")].join(path.delimiter);
    try {
        await check("ssh is not installed");
    } finally {
        process.env.PATH = saved;
    }
});

test("an https or git:// origin never runs ssh, and its host is the real one", async () => {
    h.ssh.alias("github.com", "elsewhere.example.com");
    for (const url of [
        "https://github.com/acme/orders-api.git",
        "https://oauth2:x@github.com/acme/orders-api",
        "git://github.com/acme/orders-api.git",
    ]) {
        const repo = await repoAt(url);
        assert.deepEqual(await forgeOf(repo, settingsFrom({})), { forge: "github" }, url);
        assert.equal((await githubRepo(repo, settingsFrom({})))?.host, "github.com", url);
    }
    h.ssh.alias("ghe.example.com", "github.com");
    const ghe = await repoAt("https://ghe.example.com/acme/orders-api.git");
    assert.equal(
        (await githubRepo(ghe, settingsFrom({ forges: { "ghe.example.com": "github" } })))?.host,
        "ghe.example.com",
    );
    assert.deepEqual(h.ssh.calls(), [], "ssh was never asked");
    assert.equal(
        h.jig.started_processes.some((process) => process.file === "ssh"),
        false,
    );
});

test("ssh is asked once per host for the session, also by calls at the same moment, and again after a forgotten answer", async () => {
    h.ssh.alias("gh-work", "github.com");
    h.ssh.alias("gl-work", "gitlab.example.com");
    const a = await repoAt(ssh("gh-work"));
    const b = await repoAt(ssh("gh-work"));
    const c = await repoAt(ssh("gl-work"));
    const settings = settingsFrom({ forges: { "gitlab.example.com": "gitlab" } });
    await Promise.all([githubRepo(a, settings), githubRepo(a, settings), forgeOf(b, settings), forgeOf(a, settings)]);
    await githubRepo(b, settings);
    await forgeOf(c, settings);
    await forgeOf(c, settings);
    assert.deepEqual(h.ssh.hosts(), ["gh-work", "gl-work"]);
    forgetSshAnswers();
    await githubRepo(a, settings);
    assert.deepEqual(h.ssh.hosts(), ["gh-work", "gl-work", "gh-work"]);
});

test("a failed answer is not kept for the session: a later call asks again once the minute has passed", async () => {
    h.ssh.behave("fail");
    const repo = await repoAt(ssh("gh-work"));
    assert.equal(await githubRepo(repo, settingsFrom({})), undefined);
    await githubRepo(repo, settingsFrom({}));
    assert.equal(h.ssh.calls().length, 1, "a failure is believed for a short while, so a burst of calls asks once");
});

test("which origins are ssh origins", () => {
    for (const url of [
        "git@github.com:acme/orders-api.git",
        "ssh://git@github.com/acme/orders-api.git",
        "SSH://github.com:443/a/b",
        "deploy@host:a/b",
    ])
        assert.equal(isSshOrigin(url), true, url);
    for (const url of [
        "https://github.com/acme/orders-api.git",
        "http://x/a/b",
        "git://github.com/a/b.git",
        "/srv/git/a.git",
        "file:///srv/a.git",
        "github.com:acme/a.git",
        "",
    ])
        assert.equal(isSshOrigin(url), false, url);
});

test("the gh helper's GH_HOST is the real host, and github.com is gh's own default", async () => {
    h.gh.on("api", { json: {} });
    await gh(["api", "user"], { host: "github.com" });
    await gh(["api", "user"], { host: "ghe.example.com" });
    await gh(["api", "user"]);
    assert.deepEqual(
        h.gh.calls().map((call) => call.host),
        [undefined, "ghe.example.com", undefined],
    );
    h.ssh.alias("gh-work", "github.com");
    const remote = await requireRemote(await repoAt(ssh("gh-work")), settingsFrom({}));
    assert.equal(remote.host, "github.com");
});

/** The path of a program on PATH, for a test that builds a PATH of its own. */
function which(program: string): string {
    for (const dir of (process.env.PATH ?? "").split(path.delimiter)) {
        const candidate = path.join(dir, program);
        if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
    }
    throw new Error(`${program} is not on PATH`);
}
