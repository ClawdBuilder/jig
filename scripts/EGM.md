# scripts

## Overview

Repository check, build and release scripts: plain Node ES modules (`.mjs`), run from the repo root. Only `build-gateway.mjs` has a dependency: `esbuild`, a `devDependency`.

Most are wired into `npm run check` (table below), including the changelog fragment and released-changelog checks; the 500-line ratchet
runs in `npm test`; `release.mjs` runs by hand only; `release-notes.mjs` runs by hand and in the Release workflow; `pi-canary-issue.mjs` runs in the Pi canary workflow.

They enforce [AGENTS.md](../AGENTS.md) and follow [Releases](../docs/releases.md). `scripts/` is not in the package `files`, so users never receive it.

## Interface

Which npm script runs which:

| Script | Run by | What it checks or does |
|---|---|---|
| `check-pinned-deps.mjs` | `npm run check` | Every dependency in every `package.json` is an exact `x.y.z` |
| `check-runtime-deps.mjs` | `npm run check` | A bare import in a plugin or example is a root dependency, a Node module or a Pi package |
| `check-docs.mjs` | `npm run check` | Every `.md` file: tagged fences, links, anchors, and the docs-warning budget |
| `check-version-pins.mjs` | `npm run check` | Lockfile and plugin files equal `package.json`; no stale install example |
| `check-released-changelog.mjs` | `npm run check` | The newest tagged changelog section still equals the tag's |
| `check-changelog-fragments.mjs` | `npm run check` | Every file in `changelog.d/` is one a release can fold |
| `build-contracts.mjs --check` | `npm run check`, `npm run check:contracts` | `contracts/palettes.json` is current |
| `build-gateway.mjs` | `npm run build:gateway`; with `--check`, `npm run check` | Writes the built gateway into `plugins/jig-core/dist/`, or with `--check` finds it stale |
| `check-commit-emails.mjs` | `npm run check:emails` (CI; optional pre-push hook) | No private-word email in `origin/main..HEAD` |
| `file-sizes.mjs` | `npm test` (`test/file-sizes.test.ts`, `plugins/jig-core/test/file-sizes.test.ts`) | The 500-line ratchet: no new file over it, no listed file grows |
| `check-install.mjs` | `npm run check:install` | A copy of the tree installs and loads in the stock Pi |
| `release.mjs` | by hand | Cut a release: fold `changelog.d/`, date a section, raise the version |
| `release-notes.mjs` | by hand; Release workflow | Print a version's notes |
| `pi-canary-issue.mjs` | Pi canary workflow | One open issue, or a comment on it, when the canary fails |

- **`check-pinned-deps.mjs [--root dir]`**: exports `unpinned(manifest)`, `check(root)`. Reads `dependencies`, `devDependencies` and `optionalDependencies`; `peerDependencies` may be a range (Pi's are `*`). Skips `node_modules`, `.git`, `dist`.
- **`check-runtime-deps.mjs [--root dir]`**: exports `bareImports(text)`, `check(root)`. Scans each folder under `plugins/` and `examples/` (not their `test`, `web`, `docs`, `scripts`, `dist`, `skills`, `themes`), plus `herdr/scripts` if it exists. Every entry of `plugins/` and `examples/` is read as a folder, so a plain file directly in either crashes it with `ENOTDIR`. Also fails when a Pi host package sits in `dependencies`. Uses `imports.mjs`.
- **`imports.mjs`** (types `imports.d.mts`): `importsOf(text, options?): { specifier, line, typeOnly }[]`, a regex reader for `import`, `export ... from`, `import()` and `require()`. `typeOnly` is true for `import type`, `export type` and a type expression such as `import("pkg").T`; `import { type X }` is not type-only. `{ typeExpressions: false }` leaves the type expressions out; the default lists them, as before. Also used by `plugins/jig-core/test/boundaries.test.ts` and `plugins/jig-core/test/engine-boundary.test.ts`. Do not replace it with `import "typescript"`; TypeScript 7 has no programmatic API.
- **`check-docs.mjs [root]`** (types `check-docs.d.ts`): exports `checkDocs(root): { failures, warnings }`, `warningCounts`, `baselineFailures`; prints `fail` and `warn` lines; exit 1 on a failure, or when a warning category exceeds `check-docs-baseline.json` (a drop is fine). Failures: untagged or unclosed fence, unresolved link or anchor, an install example naming `0.4.0` or `0.4.1`, a `plugins/<x>/README.md` without `# jig-x: ...` and a `**Status:` line. Warnings counted: paragraph over 350 characters, table cell over 100, plugin README over 120 lines.
- **`check-version-pins.mjs`**: fails when `package-lock.json` (`version` or `packages[""].version`) differs from `package.json`, when `.claude-plugin/plugin.json` or a plugin of `.claude-plugin/marketplace.json` names another version (or the file is missing, is not JSON or names none), or when an install example in `README.md` or `docs/` pins an older version.
- **`check-released-changelog.mjs [CHANGELOG path]`**: compares the newest tag's section with `git show v<version>:CHANGELOG.md`; a quiet skip when there are no tags.
- **`build-contracts.mjs [--check]`**: writes or checks `contracts/palettes.json` from `plugins/jig-theme/themes/*.json`. See [contracts](../contracts/EGM.md).
- **`build-gateway.mjs [--check] [--out <folder>]`**: bundles `plugins/jig-core/src/gateway/main.ts` into `jig-gateway.mjs` and each entry of `jig.connectors` into `connectors/<name>.mjs`, asks the built gateway for its `tools/list` and writes `tools.json`
  (name, title, description, input schema and connector, sorted by name), and copies `src/kit/theme.css` to `theme.css`. Everything goes to `plugins/jig-core/dist/`, or to `--out`. `--check` builds into a temporary folder and compares every file
  byte for byte with the folder: exit 0 and one line when current, exit 1 with the names of the files that differ or are missing and the command to run. An unknown argument exits 2. [Gateway](../plugins/jig-core/docs/gateway.md#the-built-gateway) says what is in the files.
- **`changelog-fragments.mjs`**: `HEADINGS` (`Added`, `Changed`, `Fixed`, `Removed`), `fragmentProblems(text)`, `readFragments(folder)`. A fragment is one heading and its `- ` lines; the reader returns its text and every problem a release would have with it.
- **`check-changelog-fragments.mjs [root]`**: fails when `changelog.d/` is missing or holds a file a release cannot fold, and names each.
- **`check-commit-emails.mjs`**: reads `origin/main..HEAD` with `git log`; a private word from `JIG_SCAN_WORDS`, `JIG_SCAN_WORDS_TEXT` or `~/.config/jig/scan-words.txt` in an author or committer email fails, and without a list only the public addresses pass and every other one warns. `scripts/pre-push-commit-emails.sh` is the optional hook that runs it.
- **`file-sizes.mjs [root]`**: `LIMIT` (500), `linesOf`, `sourceFiles`, `ratchet(entries, baseline)`. Fails on a new file over the limit or a listed file that grew, and notes a file to lower or remove; the baseline is `file-sizes-baseline.json`.
- **`pi-canary-issue.mjs`**: no exports; opens or reuses one issue named `Pi canary red` through `gh` when the canary fails, and `DRY_RUN=1` prints what it would do.
- **`check-install.mjs [--keep]`**: see Side Effects. Needs network, git and a Pi 1.x (`PI_HOST_DIR`, else the global install next to this Node).
- **`release.mjs <version> [--date YYYY-MM-DD] [--root dir] [--dry-run]`**: exports `PLUGIN_FILES`, `versionOf`, `compare`, `unreleased`, `gather`, `cut`, `withVersion`, `release`, `today`. Folds every fragment in `changelog.d/` into `## [<version>] - <date>` (one heading per kind, in that order), deletes the fragments, leaves the sentence under `## [Unreleased]`, and raises `version` in `package.json` and in the two files of the Claude Code plugin (`.claude-plugin/plugin.json` and `marketplace.json`; `withVersion` changes the first `"version"` of each and nothing else in it).
- **`release-notes.mjs <version> [--root dir]`**: exports `notesFor(changelog, version)`; prints the section body, exit 1 when missing or empty.

## Invariants

- **Release shape.** `release.mjs` refuses a version not `x.y.z`, a date not `YYYY-MM-DD`, a version not newer than `package.json`'s, entries under `## [Unreleased]`, a fragment a release cannot fold, and a plugin file that is missing or has no `"version"`; an empty `changelog.d/` is nothing to release. It never commits or tags; commit `Release <version>`, tag `v<version>` and push by [Releases](../docs/releases.md).
- **Lockfile is separate.** `release.mjs` writes `CHANGELOG.md`, `package.json` and the two plugin files, not `package-lock.json`; `check-version-pins.mjs` fails if the lockfile, or either plugin file, disagrees with `package.json` (or if a plugin file is missing or names no version), so bring the lockfile to the same version in the release commit.
- **A released section never changes.** A user-visible change adds one file in `changelog.d/` with its heading and its line; a release folds the files into the new section and deletes them. Nothing is added under `## [Unreleased]` but its sentence pointing at the folder.
- **The 500-line ratchet only turns one way.** A source file new to the baseline fails when it crosses 500 lines, and a listed file fails when it grows; a file that shrinks passes and says to lower its number. Splitting the file is the fix, not deleting blank lines or comments.
- **Exact pins.** Every dependency is an exact version, with no `^` or `~` (`.npmrc` writes them that way). An update of `@anthropic-ai/sandbox-runtime` is its own change (see AGENTS.md).
- **Runtime imports.** `pi install git:` installs `dependencies` only, so `check-runtime-deps.mjs` rejects a `devDependency` import in shipped code.
- **No dependency of its own.** These scripts import only Node modules and each other (and `test/support/` for `check-install.mjs`). The one exception is `build-gateway.mjs`, which imports `esbuild` (exact-pinned in `devDependencies`).
- **The built gateway is reproducible.** The same sources and the same `esbuild` give the same bytes: the repository root is the working folder (path comments are relative), `tsconfigRaw` is empty (the root `tsconfig.json` maps TypeBox and Pi's packages to a private copy of Pi), no minifying, no source map, no legal comments, the target comes from `engines.node`,
  and `@earendil-works/*` is external so that a Pi import stays visible. The output holds no machine path. A change to the gateway's code, to a connector or to a bundled dependency needs `npm run build:gateway`; the files are committed.
- **No secret-shaped literals** in any script or fixture; build them from parts at run time.
- **Changing a rule means changing its test:** `test/check-docs.test.ts`, `test/release.test.ts`, `plugins/jig-core/test/repo-checks.test.ts` and `test/contracts.test.ts`.

## Side Effects

- **Reads:** `package.json`, `package-lock.json`, `CHANGELOG.md`, `changelog.d/`, every `.md` file, plugin and example sources, `git tag --list`, `git show` and `git log` for the changelog and email checks.
- **Writes (only when asked):** `release.mjs` rewrites `CHANGELOG.md`, `package.json` and `.claude-plugin/plugin.json` and `marketplace.json` and deletes the folded `changelog.d/` files; `build-contracts.mjs` without `--check` rewrites `contracts/palettes.json`; `build-gateway.mjs` without `--check` rewrites `plugins/jig-core/dist/` (the `connectors/` folder is emptied first, so a connector that is gone leaves no file).
- **`build-gateway.mjs` runs a program once:** the gateway it has just built, in a temporary folder with the layout of the package and nothing installed, to ask for its tools. The folder is removed at the end.
- **`check-install.mjs`:** makes a temporary `jig-install-*` folder with an isolated home, agent folder (`PI_CODING_AGENT_DIR`) and git config, copies the working tree's tracked and new files, runs `git init` and `git commit` there, runs `pi install git:example.com/jig/jig` (npm network access), then starts Pi in RPC mode with `--model faux/faux-1`, `PI_OFFLINE=1` and the probe `test/support/install-probe.ts`. Removes the folder unless `--keep` or a failure.
- No script signs in, and none touches a real `~/.pi/agent`.

## Verification

- Run: `npm run check` (types, Biome, and the dependency, docs, version, changelog and contracts checks).
- Run: `node scripts/check-docs.mjs`.
- Built gateway: `node --import ./test/support/host.mjs --test plugins/jig-core/test/gateway-build.test.ts`; `node scripts/build-gateway.mjs --check`.
- Release scripts: `node --import ./test/support/host.mjs --test test/release.test.ts`, then `node scripts/release.mjs <version> --dry-run` to preview.
- Install check (network): `npm run check:install`.
- Whole suite: `npm test`.
