# Writes: previews, and lost replies

What you see before a write to GitHub or GitLab asks, and what the tools do when
a reply is lost. Back to the [jig-git overview](../README.md).

## What you see before a write asks

| Action | The preview |
|---|---|
| `git push` | The branch, the remote, the head commit and the commits to send |
| `git restore` | The paths, and a diff stat of what would be lost |
| `pr create`, `edit`, `comment`, `reply`, `review` | The text, rendered, on the review screen |
| `pr merge` | The title, the method and the head commit |
| `release` `tag_push`, `release_create` | The tag and what it points at, and the notes |

Each preview carries a digest of what it shows. When the call runs, the tool
works out what it would do now. If the digest differs, it refuses with
"changed since the preview; run it again to see the new preview". A new
commit, or a pull request head that moved while you read, is caught this way.
A call that did not ask has no preview to compare.

A call with the wrong parameters is refused with the usage line before it asks
anything.

## A fetch from a host your configuration does not name

A `fetch` is a read, and reads run without asking. It is still the one read that offers your SSH key outward: git connects
to the remote's host and authenticates with the agent's key. Which host that is comes from the repository's own
configuration, which the agent can write in `bash` (`git remote add`, `git remote set-url origin`), so "the same host as
origin" proves nothing.

The hosts that run without a question are the ones your own configuration names as forges:

- `github.com` and `gitlab.com`;
- `git.cloneHost`;
- every host in `git.forges`, both the name the remote uses and an object entry's real `host`.

Every URL the remote holds is read (`git config --get-all`), and a fetch asks if any of them is on a host the configuration
does not name: `git config --get` shows only the last URL, while fetch uses the first, so one URL cannot vouch for another.
An address that cannot be read as a host or as a path — including a remote with no URL — asks too, naming it, because an
unreadable address is not a reason to let a fetch run.

Any other host asks, with its name: `fetch from elsewhere.example? Your SSH key will be offered there.` Answering
**This session** remembers that host alone, so a fork whose upstream is fetched repeatedly asks once; another host asks
again. A local-path or `file://` remote reaches no host, offers no key, and does not ask.

`git config` is read, so `url.*.insteadOf` is not applied: a repository that sets it is refused before any fetch runs
(see [Permissions](../../../docs/permissions.md)).

## When a reply is lost

A write to GitHub or GitLab can time out, lose its connection, get a gateway error,
or be cancelled with Esc after the request left. Then the tool:
- reads the forge once, to see whether the change is there;
- reports what it found, and that the reply was lost;
- never sends the request again.

The one read is `pr list` for a new pull request, `pr view` for an edit, a
merge, a draft or a review, the thread itself for a reply or a resolve,
`ls-remote` for a push or a tag, and `release view` for a release. (A rerun of a CI
run is the `ci` tool's, with its own check.)

On GitLab the one read is the open merge requests of the branch for a create, the merge
request for an edit, a ready or a merge, the newest notes for a comment or a review, and
the discussion for a reply or a resolve.

A review is also read after it is sent, because GitLab answers it with no body: if the
review is not there, the tool says so and does not send it again.
