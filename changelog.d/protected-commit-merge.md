### Changed

- `git commit` and `git merge` refuse a protected branch, as `git rebase`, `git cherry_pick` and `git push` already did; `git.protected` names those branches, and `[]` turns it off.
