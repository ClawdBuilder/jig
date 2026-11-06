# Configuration: the `git` section

The fields of the `git` section of `jig.json`, in detail. The table is in the
[jig-git overview](../README.md#configure). Back to the overview.

- **`base`:** the branch new work starts from and pull requests target. The
  default is the repository's default branch.
- **`protected`:** a list where `*` matches any characters. A protected branch
  refuses a direct push, a force push, a rebase, a cherry-pick, and being
  created or deleted by these tools. Setting it replaces the default.
- **`commitMessage`, `branchName` and `prTitle`:** regular expressions. A commit
  message is tested whole, so anchor it with `^`.
  - **`prTitle`** is the same rule for a pull request's title. `pr create` and
    `pr edit` (when it sets a title) check it while the preview is built, so a title
    that does not match is refused before anyone is asked and before anything is
    sent. The message shows the pattern, as in `git.prTitle (^PROJ-\d+: )`. An
    `edit` that leaves the title alone is not checked. On GitLab it is checked
    against the title as written, before the `Draft: ` prefix of a draft is added.
- **`prTemplate`:** the path of a Markdown file, absolute or relative to the
  repository.
- **`cloneHost`:** the only host other than `github.com` that a clone request
  may name. The URL git receives is built from it; the model never names a host.
- **`watchComments`:** `"after-create"` (the default) or `"off"`. With
  `"after-create"`, `pr create` starts a watch on the comments of the new pull
  request. `pr watch` works either way ([Comment watch](comments-watch.md)).
- **`watchBots`:** `true` or `false` (the default). Whether the comment watch also
  tells the agent about comments made by bots. It is read at each poll, so a
  change applies to a watch that is already running.
- **`accounts`:** an ordered map from a remote pattern to a `gh` account, such as
  `{ "github.com:acme/*": "acme-work" }`. The pattern is `host:owner/name`, where `*` matches any characters, and it is matched
  against the real remote after an ssh alias is resolved. The first match wins. For a matching repository, `jig-git` and
  `jig-ops` read the account's token with `gh auth token --hostname <host> --user <account>` and pass it as `GH_TOKEN` to that
  one call; they never run `gh auth switch`, never store the token, and register it for redaction. No match means today's
  behaviour: the active `gh` account. An account whose token cannot be read, or a gh too old for `--user`, is a one-line error
  that says which account and what to do. Your entries merge with a company's by pattern; your account name wins for the same
  pattern.
- **`forges`:** an object of host names. It names the hosts that `ssh -G` cannot explain and that are not `github.com` or `gitlab.com`,
  such as a self-hosted GitLab. Each entry is a forge, `"github"` or `"gitlab"`, as in `{ "gitlab.example.com": "gitlab" }`, or an
  object `{ "forge": "github", "host": "ghe.example.com" }`. Host names are compared without regard to case, and carry no port. An
  `origin` on any other host is refused. The setting is configuration only: no call can set or change it
  ([GitLab](gitlab.md#which-forge-a-repository-is-on)).
  - **A word** is the forge. `gh` or `glab` is told the real host: what `ssh -G` says for an ssh origin, else the convention
    (`github.com-<alias>` is `github.com`), else the host in `origin`.
  - **An object** names the forge and, with `host`, the host `gh` and `glab` are told, over what ssh says. git goes on using the
    address in `origin`, so cloning, fetching and pushing are unchanged ([an ssh alias](gitlab.md#an-ssh-alias-for-a-real-host)).

## Moved fields

`git.watch` and `git.artifacts` moved to `ops.watch` and `ops.artifacts` with
the CI watch. `jig-core` reports them with where they are now.
