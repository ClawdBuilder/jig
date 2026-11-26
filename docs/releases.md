# Releases

A release is a tag, a section of the changelog and a GitHub release, in that order. Pi shows a user the changelog entries
newer than the version they had, once, after an update, so every entry is written for that reader.

## Add a change

A user-visible change is one file in [changelog.d/](../changelog.d/), named for the change and folded in name order: a
`### Added`, `### Changed`, `### Fixed` or `### Removed` heading and its line(s). `npm run check` refuses a file with an
unknown heading or no `- ` line. A release folds the files into the next section and deletes them; `## [Unreleased]` is
never edited.

## Cut one

1. **Land it green.** The commit you tag is one whose `npm run check`, `npm test` and `npm run check:install` passed in CI.
2. **Fold the fragments.** `node scripts/release.mjs 0.3.0` raises `version` in `package.json` and in the two files of the Claude Code plugin
   (`.claude-plugin/plugin.json` and `marketplace.json`, which `npm run check` keeps equal to it), folds every file in
   `changelog.d/` into `## [0.3.0] - <today>` under the headings Added, Changed, Fixed and Removed in that order, and
   deletes the fragments. The sentence under `## [Unreleased]` that points at the folder stays.
3. **Re-capture the doctor samples after the version bump.** Pack the tree, install it into a temporary home with
   `jig setup --source <tarball> --yes`, run `jig doctor`, and paste its real output into [README](../README.md) and
   [Your first hour](first-hour.md); `npm run check` fails if a captured `Jig — x.y.z` line is stale.
4. **Read the diff.** The script writes the changelog and those three files and deletes the folded fragments; the entries
   are what a user will read.
5. **Commit** it as `Release 0.3.0`.
6. **Tag and push both, after `ci-ok` on main's merge commit.** The [Release workflow](../.github/workflows/release.yml)
   checks the `ci-ok` check-run on the tagged commit and refuses a tag pushed before it exists; wait for the merge
   commit's check to finish. The tag is the release:

```bash
git tag -a v0.3.0 -m "Jig 0.3.0"
git push origin main v0.3.0
```

7. **Watch the workflow publish it.** The tag starts the Release workflow, which packs the tag and compares its tarball
   integrity with npm (a version already there is skipped only on an exact match, and a mismatch fails), publishes
   `@clawdbuilder/jig` with provenance, confirms the registry has the version, and only then writes the GitHub release.
   So `npm install -g @clawdbuilder/jig@<version>` and `pi install npm:@clawdbuilder/jig@<version>` get the same release.
   The job waits for approval in the repository's **Release** environment; the user is the required reviewer, and only `v*`
   tags may deploy there. It then publishes with npm Trusted Publishing (OIDC) and provenance, so no npm token is stored.
   The `NPM_TOKEN` secret is deleted after the first release that publishes this way. The workflow needs npm 11.5.1 or
   later, fails when the tag does not name the version in `package.json`, or when the changelog has no section for it;
   otherwise it writes the GitHub release with that section as its notes. A second run edits the release rather than
   failing.

A tag that was pushed before that workflow existed has a tag but no page. Run the workflow by hand (**Actions**, **Release**,
**Run workflow**) and name the tag: it writes the page from that tag's own changelog, and does not mark it the latest release.

`node scripts/release.mjs --dry-run` shows the change without writing it or deleting the fragments, and `npm test` covers
both scripts.

## What a version means

| The change | The version |
|---|---|
| a fix a user would not have to configure anything for | the third number: `0.3.0` → `0.3.1` |
| a new plugin, tool, action, `jig.json` section, `JIG_*` variable or setting | the second number: `0.3.0` → `0.4.0` |
| removing or renaming a public name | the second number, after a dated entry in [Decisions](decisions.md) |
| a break of the plugin contract | the second number, and `JigApi.version` rises |
| a new Pi or Node line Jig needs | the second number |

Until 1.0 the first number stays 0: the shape of the plugins is settled, and a major version would promise a stability a
0.x release does not. What is public, and what counts as breaking, is in [Compatibility](compatibility.md) and does not
depend on the number.

## Pin a release

A branch moves; a tag and a commit do not. Pi takes a ref in the install source:

```bash
pi install npm:@clawdbuilder/jig@0.5.11
```

- **A tag or a commit is pinned.** Pi reconciles the checkout to it and does not move it, so an update happens when you
  change the ref.
- **A branch is fetched again** on each start, which is how a reader follows `main`.
- **A company plugin records the release and the commit** it was built against in its `jig.version`, and warns when its
  checkout is older.

## The first tags

`v0.2.0` was tagged after the fact, at the commit that declared that version, and has no page of its own yet. `v0.3.0` is the
first release cut with the script, and the first with a page. [CHANGELOG.md](../CHANGELOG.md) holds both sections, so a release's
notes can be read without its tag.

Back to [Contributing](../CONTRIBUTING.md).
