# jig-review web scripts

## Overview

Two Node build helpers run by `npm run build` in `web/`: one generates the theme boot script, the other writes the manifest that proves `web/dist/` was built from the committed sources. Context: [web](../EGM.md), [The page](../../docs/page.md).

## Interface

- **`theme-boot.ts`**: no exports. Writes `../public/theme-boot.js` from `themeBootScript("system")` in `plugins/jig-core/src/kit/theme-client.ts`, with a "Generated from" header line.
- **`manifest.ts`**:
  - `PACKAGE_ROOT`, `MANIFEST_FILE` (`build.json`), type `WebBuildManifest { sources, files }`.
  - `sourceFiles(root?)`, `hashSources(root?)`, `hashOutputs(root?)`.
  - `readManifest(root?)`, `writeManifest(root?)`.
  - Run directly (`node scripts/manifest.ts`) it rewrites `build.json` and prints the file count.

## Invariants

- **The source list is fixed in `SOURCE_FILES`**: `index.html`, `vite.config.ts`, `package-lock.json`, `public/theme-boot.js`, `jig-core`'s `kit/theme.css` and `kit/theme-client.ts`, plus every file under `src/`, whatever its type. Add a new build input there, or a change to it will not fail the dist check. A stray file in `src/` (such as a contract) changes the hash, so keep `src/` source-only.
- **How the hashes are built.** `sources` is the SHA-256 of one line per source (`path`, a NUL byte, the hex SHA-256 of its content, a newline), sorted by path. `files` maps each `dist/` file's path to the plain SHA-256 of its bytes. Both are reproducible and need no Vite toolchain to recompute.
- **Build order matters**: `theme-boot.ts`, then `vite build`, then `manifest.ts`. The manifest must be written last, after `dist/` is final.
- **Two separate checks.** `plugins/jig-review/test/web-build.test.ts` imports `manifest.ts` and compares `build.json`. `test/support/check-web-dist.mjs` does not use `manifest.ts` or `build.json`: it runs `vite build` into a temporary folder and compares file names and bytes with `dist/`.

## Side Effects

- **Disk**: `theme-boot.ts` overwrites `web/public/theme-boot.js`. `manifest.ts` reads `src/`, `dist/` and the listed sources, and overwrites `web/build.json`. No network, no processes.

## Verification

- Build (runs both): `npm --prefix plugins/jig-review/web run build`
- Type check: `npm --prefix plugins/jig-review/web run check`
- Dist freshness: `npm run check:dist` (repo root)
- Plugin tests: `node --import ./test/support/host.mjs --test "plugins/jig-review/test/*.test.ts"` (from the repo root)
