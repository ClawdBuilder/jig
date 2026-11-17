# jig-theme

## Overview

`jig-theme` changes how Pi looks and nothing else: six palettes shipped as ordinary Pi themes, user palettes written from `jig.json`, a one-line footer, and answers drawn in the theme's text colour. It has no tools, so the model never sees it.

Specification: [README](./README.md); detail: [Palettes](./docs/palettes.md), [Your palettes](./docs/your-palettes.md), [The footer](./docs/footer.md).

## Interface

- **Entry**: `index.ts` re-exports the default of `./src/index.ts`. The entry sits at the plugin root so Pi labels the extension `jig-theme`; the code stays in `src/`.
- **Command** `/theme [name | reload | footer on|off]`.
- **Config section** `theme` in `jig.json`: `palettes`, `footer`, `answerColor`. The section is registered with a `setup` summary for `/jig setup`.
- **Event bus** `jig-theme:segment`: other plugins add footer parts without importing this plugin.
- **Environment**: `JIG_THEME_FOOTER=0` turns the footer off.
- **Code**: [src contract](./src/EGM.md); [scripts contract](./scripts/EGM.md) for the build of `themes/`.
- **Not code**:
  - `themes/`: the six Pi theme files (`jig-lime`, `jig-signal`, `jig-ember`, `jig-orchid`, `jig-mono`, `jig-paper`), generated, JSON only.
  - `docs/`: [Palettes](./docs/palettes.md), [Your palettes](./docs/your-palettes.md), [The footer](./docs/footer.md).
  - `test/`: golden roles, contrast, Pi's validator and loader, the writer, the footer at every width, the command.

## Invariants

- **Plugin boundary.** Import only `jig-core`'s `client.ts` and `kit/` (this plugin uses `client.ts` and `kit/files.ts`); tests enforce it. No credentials, no sign-in.
- **Looks only.** It reads the session and extension statuses, and writes only theme files it wrote itself and nobody has changed since.
- **`themes/*.json` are generated.** After any change to a palette or the role map, run `node plugins/jig-theme/scripts/build-themes.ts` and commit the result; a test fails otherwise.
- **README and docs are read by tests** (`test/docs.test.ts`, `palettes.test.ts`, `footer.test.ts`, `segments.test.ts`). The palette table, the footer parts and their defaults, and the contrast rules are checked against the code. Change a doc and its test together.
- **Contrast.** Body text keeps 7:1 on its backgrounds and muted text 4.5:1, with one named exception in [Palettes](./docs/palettes.md).
- **Pinned surface.** The `/theme` command, the `theme` section and the `JIG_*` variables are literals in `plugins/jig-core/test/surface.test.ts` and `plugin-surface.test.ts`. Add to them when adding; a removal needs a Decisions entry first.
- **Never in the way.** No footer in a subagent child, without a terminal, or with `JIG_THEME_FOOTER=0`.

## Side Effects

- **At load**: registers the `theme` section (with its `setup` summary) with `jig-core` and listens on the event bus; nothing is written until a session starts in a terminal.
- **At run**: theme files under the Pi agent folder's `themes/`, a manifest at `jig-theme/written.json`, a footer through Pi's UI, and a patch of Pi's answer component. Full list in [src contract](./src/EGM.md#side-effects).

## Verification

- Run from the repo root: `node --import ./test/support/host.mjs --test "plugins/jig-theme/test/*.test.ts"`
- Docs: `node scripts/check-docs.mjs`. Types and lint: `npm run check`. Whole suite: `npm test`.
