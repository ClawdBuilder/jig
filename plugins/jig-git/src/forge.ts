// Which forge a repository is on. The decision is made from the host of origin and from the `git.forges` setting, never from
// anything the model says: a call cannot send a pull request to one forge and the credentials of another.
//
// - the host is the real one: for an ssh origin, what `ssh -G` says an alias in `~/.ssh/config` stands for, else the convention
//   (`github.com-<alias>`, `ssh.github.com`, `altssh.gitlab.com`); see origin-host.ts;
// - github.com (and the configured clone host, an ssh alias for it) is GitHub, run through `gh`;
// - gitlab.com is GitLab, run through `glab`;
// - a host named in `git.forges` is what the setting says, which is how a self-hosted GitLab is told apart. An entry may also be an
//   object, `{ "forge": "github", "host": "github.com" }`, to name the real host when ssh cannot: git goes on using the alias in
//   origin, and `gh` and `glab` are told that host;
// - an origin with no host at all (a local path, or no origin) stays on GitHub as it always did: gh then reads the
//   repository's own remotes and says for itself when it finds none;
// - any other host is refused with the line that fixes it, because guessing would send a request to the wrong service.
import type { GitSettings } from "./config.ts";
import { GITLAB_COM, isGithubOrigin, originHost } from "./origin-host.ts";
import { originUrl, parseRemotePath } from "./repo.ts";
import type { Repo } from "./repo.ts";

export type { Forge } from "./config.ts";

/** A repository on GitLab: the host that glab talks to (the real one, when origin's host is an alias), and the project's path with all its groups. */
export interface GitlabHome {
    forge: "gitlab";
    host: string;
    /** `acme/orders-api`, or `platform/payments/orders-api` for a project in a subgroup. */
    path: string;
}

/** Where a repository lives. GitHub needs nothing more: `gh` and `repo.ts` find the rest. */
export type Home = { forge: "github"; host?: string } | GitlabHome;

/** Origin is on a host that is neither GitHub nor GitLab, and `git.forges` does not name it. */
export class UnknownForgeHost extends Error {
    constructor(name: string, host: string, real: string = host) {
        super(
            real === host
                ? `origin of ${name} is on ${host}, which jig-git does not know as GitHub or GitLab; name it in jig.json, such as "git": { "forges": { "${host}": "gitlab" } }, ` +
                      `or, when it is an ssh alias for a real host, "git": { "forges": { "${host}": { "forge": "github", "host": "github.com" } } }`
                : `origin of ${name} is on ${host}, which ssh resolves to ${real}, which jig-git does not know as GitHub or GitLab; name it in jig.json, such as "git": { "forges": { "${real}": "gitlab" } }`,
        );
        this.name = "UnknownForgeHost";
    }
}

/** The forge of the repository, from origin. Throws a one-line refusal for a host it does not know. */
export async function forgeOf(repo: Repo, settings: GitSettings, signal?: AbortSignal): Promise<Home> {
    const url = await originUrl(repo, signal);
    const remote = parseRemotePath(url);
    if (remote === undefined || url === undefined) return { forge: "github" };
    const origin = await originHost(url, remote.host, settings);
    if (origin.configured === "github") {
        // The host is named when something said it: an entry's own host, or a real host that is not the alias.
        return origin.explicit || origin.told !== origin.alias
            ? { forge: "github", host: origin.told }
            : { forge: "github" };
    }
    if (origin.configured === "gitlab") return { forge: "gitlab", host: origin.told, path: remote.path };
    if (isGithubOrigin(origin, settings)) return { forge: "github" };
    if (origin.real === GITLAB_COM) return { forge: "gitlab", host: GITLAB_COM, path: remote.path };
    throw new UnknownForgeHost(repo.name, origin.alias, origin.real);
}

/**
 * The GitLab project behind origin, or undefined when the repository is not on GitLab, or its host is not known. Anything else
 * is thrown: a refusal from jig-core about the repository's configuration is not an answer of "no".
 */
export async function gitlabHome(
    repo: Repo,
    settings: GitSettings,
    signal?: AbortSignal,
): Promise<GitlabHome | undefined> {
    try {
        const home = await forgeOf(repo, settings, signal);
        return home.forge === "gitlab" ? home : undefined;
    } catch (error) {
        if (error instanceof UnknownForgeHost) return undefined;
        throw error;
    }
}
