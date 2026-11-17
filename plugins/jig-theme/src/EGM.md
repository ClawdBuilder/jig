# jig-theme src

## Overview

The Pi extension behind `jig-theme`. It registers the `theme` section (with a `setup` summary) with `jig-core`, and, when a session starts in a terminal, writes the user's palettes as Pi theme files, installs a one-line footer, and colours assistant answers. It has no tools, so the model never sees it.

Specification: [README](../README.md); detail: [Palettes](../docs/palettes.md), [Your palettes](../docs/your-palettes.md), [The footer](../docs/footer.md).

## Interface

- **Entry**: `index.ts` exports `theme(options?: ThemeOptions): ExtensionFactory` and `default theme()`. `ThemeOptions` holds test seams only: `env`, `agentDir`, `settings`, `noticeDelayMs`, `rereadDelayMs`.
- **Command** `/theme [name | reload | footer on|off]` (`command.ts`: `registerThemeCommand`, `USAGE`, `reloadWasAsked`). It needs a terminal.
- **Config section** `theme` (`config.ts`): `palettes`, `footer` (`enabled`, `segments`, `dropFirst`, `colors`, `context`, `costDecimals`, `separator`) and `answerColor`. Exports `validateTheme`, `settingsFrom`, `DEFAULT_SETTINGS`, `SEGMENT_IDS`, `PALETTE_NAME`, `RESERVED_NAMES`, `MAX_PALETTES`.
- **Event bus** `jig-theme:segment` (`SEGMENT_EVENT`): `{ id, label, tone, order? }`; an empty label removes the part. Other plugins emit it and import nothing from here.
- **Palettes and roles**: `roles.ts` (`ROLES`, `VAR_NAMES`, `ROLE_MAP`), `palettes.ts` (`PALETTES`, `PALETTE_NAMES`), `build.ts` (`build`, `themeText`, `resolveTheme`, `derive`).
- **Disk**: `write.ts` (`syncPalettes`, `rewriteOwned`) and `apply.ts` (`applyPalettes`, which never throws).
- **Footer**: `footer.ts` (`installFooter`, `renderFooter`, `partsOf`), `segments.ts` (`PluginSegments`), `session.ts` (`Session`), `cache.ts`, `usage.ts`, `width.ts`, `picker.ts` (`pickTheme`).
- **Other**: `answer-text.ts` (`installAnswerText`, `uninstallAnswerText`) and `child.ts` (`isSubagentChild`).
- **Scripts**: [scripts contract](../scripts/EGM.md) builds the `themes/` files from `palettes.ts` and `build.ts`.

## Invariants

- **Only `jig-core`'s `client.ts` and `kit/files.ts`** are imported from `jig-core` (`jig`, `withJig`, `replaceFileDurably`). Never import its other modules.
- **Only files it wrote.** A palette file is written or deleted only when absent, or when its SHA-256 equals the one in `<agentDir>/jig-theme/written.json`. A hand-edited, unrecorded, non-plain or over-1-MiB file is left alone and reported. One exception: an unrecorded file whose text already equals the generated theme is adopted without a problem (hash recorded, palette counted as owned), so it is deleted when the palette is removed (`write.ts:159-163`, `191-195`).
- **Atomic and private.** Theme files go through `replaceFileDurably` with mode `0o644`, the manifest with `0o600` in a `0o700` folder. If the manifest cannot be written, files stay and are never deleted later.
- **Palette names** match `/^[a-z0-9][a-z0-9-]{0,39}$/`, are not reserved, and do not collide with another known Pi theme. At most 20 palettes.
- **Validation names keys, never values**, so a pasted secret is not echoed. Unknown keys are errors; `settingsFrom` falls back to defaults for anything invalid.
- **Terminal only.** Palettes and the footer need `ctx.mode === "tui"`. Palettes are not written in a subagent child; the answer colour still applies to any terminal session.
- **Never in the way.** `applyPalettes` collects `problems` instead of throwing. The footer is never wider than the terminal. The answer-text patch is wrapped so a changed Pi shape leaves Pi's own colour.
- **Plugin parts are bounded**: id `/^[A-Za-z0-9][A-Za-z0-9._:-]{0,39}$/`, label cut to 40 cells, at most 12 parts, an unknown tone becomes `normal`.
- **Generated files**: `themes/*.json` must equal `build(PALETTES[name], name)` as `themeText` writes it. After a palette or role-map change run the build script. The README and docs are read by tests, so change them with the code.

## Side Effects

- **Disk writes**: `<agentDir>/themes/<name>.json` for user palettes (deleted when a palette is removed) and `<agentDir>/jig-theme/written.json`. `agentDir` is Pi's `getAgentDir()`, which `PI_CODING_AGENT_DIR` moves.
- **Rewrite after a delay**: a changed palette's file is written again with the same text (`rereadDelayMs`, default 800 ms at start, 100 ms after `/theme <name>`) so Pi's theme watcher reads it anew.
- **Env read**: `JIG_THEME_FOOTER` (`0` blocks the footer), `PI_SUBAGENT_ID` and `PI_SUBAGENT_CHILD=1` (a child), `PI_CACHE_RETENTION` (`long` selects the 1-hour cache tier, else 5 minutes).
- **Pi hooks**: `session_start`, `message_end`, `thinking_level_select`, `agent_settled`, `session_compact`, `session_tree`, `model_select`, `session_shutdown`; `pi.events.on` for `jig-theme:segment`; `pi.registerCommand("theme")`.
- **UI**: `ctx.ui.setFooter`, `setTheme` (Pi persists the choice), `notify` and `ctx.reload()` for `/theme reload`.
- **Process-wide state**: wraps `AssistantMessageComponent.prototype.updateContent` once, marked `Symbol.for("jig-theme.answer-text.patched")`; the answer painter slot on `globalThis` (`Symbol.for("jig-theme.answer-text.painter")`), set by every `installAnswerText` and deleted by `uninstallAnswerText`; a read-once reload flag on `globalThis` (`Symbol.for("jig-theme.reload-asked")`).
- **Timers**: one unref'd cache countdown, notice and reread delays; all cleared on `session_shutdown`.
- **No** network and no child processes.

## Verification

- Run from the repo root: `node --import ./test/support/host.mjs --test "plugins/jig-theme/test/*.test.ts"`
- Docs the tests read: `node scripts/check-docs.mjs`
- Types and lint: `npm run check`. Whole suite: `npm test`.
