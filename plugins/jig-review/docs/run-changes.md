# What counts as the agent's

How `jig-review` decides what an agent run changed, and why the commits that a merge, a pull or a rebase brought in are not
offered for review: they are other people's work, not code the agent wrote. Back to the [jig-review overview](../README.md).

## What is taken

For each repository, when the run starts: its changed files with a fingerprint each, its `HEAD`, and how long `HEAD`'s reflog is.
When the run ends, the same again. The offer covers:
- **files that differ** between the two status snapshots, whichever tool changed them, and the files the agent's edit and write tools named;
- **files in commits made in the run**, which git status never shows, compared with where the run's review starts (below).

Only the repositories the run's tool calls used are looked at, so a repository another Pi session works in is left alone.

## Commits that came in

A commit made in the run is **the agent's** when `HEAD`'s reflog says git created it for the run: `commit` (also `commit (merge)` and
`commit (amend)`), `cherry-pick`, `revert`, `am` and a rebase's replayed picks. Every other commit in `start..HEAD` is
**incoming** when both of these hold:
- it sits under the other parent of a merge, or under where a fast-forward, pull, reset to a ref or the new base of a rebase moved `HEAD`;
- none of the agent's commits is under it. A branch the agent made commits on and then merged is the agent's, not incoming.

The review of the run then starts from a **base**: the commit `HEAD` was at when the run began, merged by git's own automatic
merge (`git merge-tree --write-tree`) with the incoming commits. The review is that base against the working tree, so it holds only:

| What the run did | What the review shows |
|---|---|
| A clean merge, a pull, a fast-forward, a reset to upstream | nothing, and Pi says why in one line |
| A merge with conflicts that the agent resolved | the resolution: how the result differs from git's merge, markers included |
| A rebase onto upstream | nothing, unless the agent resolved a conflict or made commits |
| Its own commits, before or after a merge | those commits |
| Edits after a merge, in a file the merge changed | the edit only; the merged lines are context |

The line is `Nothing to review: the run only merged origin/develop.` (or `pulled`, `reset to`, `rebased onto`). It appears only when
the run left nothing else to review.

## When git cannot tell

The review then starts from the commit `HEAD` was at, as before: it shows more than the agent did, never less. That is the case when:
- git is older than 2.38, which has no `merge-tree --write-tree`;
- the reflog is off, was expired during the run, or HEAD moved more than 1000 times;
- the run holds more than 20,000 commits, or git fails or times out.

A commit that leaves no reflog line of the kinds above (made with plumbing commands, say) is never taken as incoming unless it sits under a merge
or a move onto other commits, so it stays in the review.

## What is not changed

- **An explicit scope.** `/code-review --branch`, `--staged`, `--unstaged`, a folder or a ticket shows everything in it: you asked for that.
- **`--touched`** uses the same start as the offer, because it is the agent's last run.

`merge-tree` writes the merged tree into the repository's object store, and a run that merged two unrelated lines also writes one commit
for them. Nothing refers to these objects, and `git gc` removes them.

Back to the [jig-review overview](../README.md).
