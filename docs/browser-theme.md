# Browser theme

Every Jig browser page shares one palette: the review page, a `jig-core` approval preview, the Jira preview and
`jig-lens`. The tokens are CSS custom properties in
[`plugins/jig-core/src/kit/theme.css`](../plugins/jig-core/src/kit/theme.css); no plugin copies a colour. The page picks
`light` or `dark` from, in order: the person's choice in that browser, `ui.theme` in `jig.json`, the system.

| Token | Light | Dark |
|---|---|---|
| page | `#ffffff` | `#111113` |
| surface | `#f6f7f9` | `#18181b` |
| raised | `#ffffff` | `#202024` |
| border | `#d9dde3` | `#2c2c31` |
| text | `#1a1b1e` | `#e7e7ea` |
| muted | `#5c626b` | `#9a9aa2` |
| accent | `#2563eb` | `#7aa2f7` |
| added line | `#e6ffec` | `#14251a` |
| removed line | `#ffebe9` | `#2a1618` |

Dark is graphite (`#111113` page), not the old navy (`#0d1117`). Body text is 15.28:1 on the dark page and 17.22:1 on
the light page; muted text is 6.75:1 and 6.15:1. Both pass WCAG AA (4.5:1); body also passes AAA (7:1), while muted does
not reach the 7:1 AAA normal-text threshold.
The diff backgrounds keep body text at 13.0:1 (added) and 13.87:1 (removed) in dark, and 16.3:1 and 15.02:1 in light.

On every page a small **System / Light / Dark** selector sits at the bottom right. On the review page the choice is saved
through its authenticated settings, in the agent folder, so the next review server — on a different random port — and the
other Jig pages read it; local storage still makes the current page immediate. It wins over `ui.theme`. `system` follows `prefers-color-scheme` and changes when the system does. A page
writes the theme before the first paint: the review page has a small `/theme-boot.js` in the head, the lens page has the
choice in its nonce'd script, and an approval preview pins `data-theme` on `<html>`. Scrollbars, selection, focus rings,
disabled buttons, code blocks, diffs and syntax highlighting use the same tokens.

A company can set `ui.theme` for its people by putting it in the shared `jig.json`; a person can override it on any page.
`jig-core` validates it as `system`, `light` or `dark`.
