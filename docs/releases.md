# Releases

A release is a tag, a section of the changelog and a GitHub release, in that order. Pi shows a user the changelog entries
newer than the version they had, once, after an update, so every entry is written for that reader.

## Cut one

1. **Land it green.** The commit you tag is one whose `npm run check`, `npm test` and `npm run check:install` passed in CI.
2. **Move the entries.** `node scripts/release.mjs 0.3.0` raises `version` in `package.json` and moves everything under
   `## [Unreleased]` into `## [0.3.0] - <today>`, gathering repeated `### Added`, `### Changed` and `### Fixed` headings.
3. **Read the diff.** The script writes files and nothing else; the entries are what a user will read.
4. **Commit** it as `Release 0.3.0`.
5. **Publish the package.** The tag's workflow requires a successful `ci-ok` check on the tagged commit, packs the tag and
   compares its tarball integrity with npm (a version already there is skipped only on an exact match, and a mismatch fails),
   publishes `@clawdbuilder/jig` with provenance, confirms the registry has the version, and only then writes the GitHub
   release. So `npm install -g @clawdbuilder/jig@<version>` and `pi install npm:@clawdbuilder/jig@<version>` get the same
   release. The repository secret `NPM_TOKEN` supplies npm authentication; Trusted Publishing is a later step.
6. **Tag and push both.** The tag is the release:

```bash
git tag -a v0.3.0 -m "Jig 0.3.0"
git push origin main v0.3.0
```

The tag starts the [Release workflow](../.github/workflows/release.yml). It fails when the tag does not name the version in
`package.json`, or when the changelog has no section for it, and otherwise writes the GitHub release with that section as
its notes. A second run edits the release rather than failing.

A tag that was pushed before that workflow existed has a tag but no page. Run the workflow by hand (**Actions**, **Release**,
**Run workflow**) and name the tag: it writes the page from that tag's own changelog, and does not mark it the latest release.

`node scripts/release.mjs --dry-run` shows the change without writing it, and `npm test` covers both scripts.

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
pi install npm:@clawdbuilder/jig@0.4.3
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
