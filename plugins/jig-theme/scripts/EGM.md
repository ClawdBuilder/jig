# jig-theme scripts

## Overview

One build script. It regenerates the six committed Pi theme files in `../themes/` from the palettes in `../src/`. It is a development tool, never loaded by Pi. Background: [README](../README.md), [Palettes](../docs/palettes.md).

## Interface

- **`build-themes.ts`**: a command, no exports. Run from the repo root with `node plugins/jig-theme/scripts/build-themes.ts`.
- **Reads from `../src`**: `build` and `themeText` from `build.ts`, and `PALETTES` from `palettes.ts`.
- **Writes**: one `<palette name>.json` per key of `PALETTES`, each `themeText(build(palette, name))`.
- **Output line**: `<n> themes written to <folder>`.

## Invariants

- **Committed output must equal this output.** The themes test compares `themes/*.json` with what the script makes. After any change to a palette or to the role map, run the script and commit the files.
- **Output goes only to the plugin's `themes/` folder**, found from `import.meta.dirname`, not from the working directory.
- **File names are the palette names.** A new built-in palette means a new file here and a new row in the README table.
- **It overwrites without checking.** The ownership checks of `src/write.ts` apply to a user's palettes under the Pi agent folder, never to these files.

## Side Effects

- **Disk**: creates `themes/` if missing and rewrites the six JSON files in it.
- **Console**: one `console.log`.
- **No** network, environment variables or child processes.

## Verification

- Run from the repo root: `node --import ./test/support/host.mjs --test "plugins/jig-theme/test/*.test.ts"`
- Check that committed themes are current: `node plugins/jig-theme/scripts/build-themes.ts`, then `git status plugins/jig-theme/themes` shows no change.
- Whole suite: `npm test`.
