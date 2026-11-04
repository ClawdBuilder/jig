# Releases

A release is a tag, a section of the changelog and a GitHub release, in that order. Pi shows a user the changelog entries
newer than the version they had, once, after an update, so every entry is written for that reader.

## Cut one

1. **Land it green.** The commit you tag is one whose `npm run check`, `npm test` and `npm run check:install` passed in CI.
2. **Move the entries.** `node scripts/release.mjs 0.3.0` raises `version` in `package.json` and moves everything under
   `## [Unreleased]` into `## [0.3.0] - <today>`, gathering repeated `### Added`, `### Changed` and `### Fixed` headings.
3. **Read the diff.** The script writes files and nothing else; the entries are what a user will read.
4. **Commit** it as `Release 0.3.0`.
5. **Tag and push both.** The tag is the release:

```bash
git tag -a v0.3.0 -m "Jig 0.3.0"
git push origin main v0.3.0
```

The tag starts the [Release workflow](../.github/workflows/release.yml). It fails when the tag does not name the version in
`package.json`, or when the changelog has no section for it, and otherwise writes the GitHub release with that section as
its notes. A second run edits the release rather than failing.

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
pi install git:github.com/Dev-Mriganka/jig@v0.3.0
```

- **A tag or a commit is pinned.** Pi reconciles the checkout to it and does not move it, so an update happens when you
  change the ref.
- **A branch is fetched again** on each start, which is how a reader follows `main`.
- **A company plugin records the release and the commit** it was built against in its `jig.version`, and warns when its
  checkout is older.

## The first tags

Tags began with `v0.2.0`, at the commit that declared that version, and `v0.3.0` is the first release cut with the script.
Older changelog entries have no tag of their own. A release's notes are always the section of [CHANGELOG.md](../CHANGELOG.md)
named after its version, so they can be read without the tag.

Back to [Contributing](../CONTRIBUTING.md).
