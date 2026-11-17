# jig-review web

## Overview

The review page as its own npm package (`jig-review-web`, private): sources in `src/`, build tooling in `scripts/`, and the built static files in `dist/`, which the plugin's server serves and which is committed so installing Jig needs no build.

Its dependencies are `devDependencies` only; the plugin's runtime needs none of them. Context: [plugin](../EGM.md), [The page](../docs/page.md).

**One contract covers the whole page, and no `EGM.md` lives in `src/` or `public/`.** `scripts/manifest.ts` hashes every file under `src/`, and Vite copies every file in `public/` into `dist/`. A contract file in either folder would make `build.json` and `dist/` stale (and `public/` would also publish it to the browser). The `src/` and `public/` folders are described below under Source folders. Only [scripts](./scripts/EGM.md) has its own file, because nothing builds from it.

## Interface

- **`package.json`**: scripts `build` (`node scripts/theme-boot.ts && vite build && node scripts/manifest.ts`), `test` (`vitest run`), `check` (`tsc -p tsconfig.json`). React 19, `react-diff-view`, `refractor`, Tailwind 4, Vite, vitest, all pinned exactly.
- **`vite.config.ts`**: React and Tailwind plugins, alias `@web` to `src/`, output `dist/` (emptied each build), vitest `include: ["src/**/*.test.ts"]` in the Node environment.
- **`index.html`**: the shell. `<html data-theme-placeholder="true">` and the script `/theme-boot.js?theme=__JIG_THEME_DEFAULT__`; the server replaces both placeholders at request time.
- **`tsconfig.json`**: strict, `noEmit`, covers `src`, `scripts` and `vite.config.ts`.
- **`build.json`**: SHA-256 manifest of the sources and of every file in `dist/`.
- **Child contract**: [scripts](./scripts/EGM.md) (theme-boot generator, manifest). `dist/` and `node_modules/` are build output and installed packages, not documented.

## Source folders

Everything below sits under `web/`; paths are relative to it. Test files (`*.test.ts`) inside component folders are vitest tests and are ignored here.

### public/

- **`theme-boot.js`**: an IIFE loaded by `index.html` as `/theme-boot.js?theme=__JIG_THEME_DEFAULT__`. It reads `theme` from its own URL as the default, then `localStorage["jig-theme"]`, falls back to `system`, and sets `documentElement.dataset.theme` (`light` or `dark`), `style.colorScheme`, `window.__JIG_THEME_DEFAULT__` and `window.__jigThemeChoice`.
- **Generated, never hand-edited.** `scripts/theme-boot.ts` rewrites it from `plugins/jig-core/src/kit/theme-client.ts` (`themeBootScript("system")`) on every build.
- **Same-origin external script only.** The server's policy has no inline-script allowance. Everything is in `try/catch`, so a blocked `localStorage` or missing `matchMedia` never breaks the page.
- **Hashed into `build.json`** (it is a listed source), so a change needs a rebuild. Put no other file here: Vite would copy it into `dist/`.
- **Effects**: browser only: reads `localStorage` and `prefers-color-scheme`, writes the attribute, style and two window globals. No network.

### src/ (the app shell)

- **`main.tsx`** imports `react-diff-view` CSS, `styles.css` and `theme.js`, then mounts `App` on `#root` (throws if it is missing). **`App.tsx`** routes by `window.location.pathname`: `/review/<id>/files`, `/review/<id>/conversation`, `/reviews` (default) and `/settings`; it reloads on the SSE event `review-updated` from `/api/events` and sends the live review to `ReviewPage`, any other to the read-only pages.
- **`api.ts`**: `fetchReview`, `fetchReviews`, `fetchReviewById`, `submitComments`, `askAgent`, `fetchSettings`, `updateReviewSettings`, `fetchApprovalOptions`, `approveWithPasskey`, `approveInPi`, `registerPasskey`, `fetchPasskeys`, `removePasskey`, `getReviewApiUrl`. **`passkeys.ts`**: `supportsPasskeys`, `createPasskey`, `signWithPasskey`, `toCreationOptions`, `toRequestOptions`, `base64UrlToBytes`, `bytesToBase64Url`, `describePasskeyError`.
- **`types.ts`** re-exports the server's record types from `../../src/types.ts` plus page-only types (`DraftComment`, `ReviewPayload`, `ReviewDetailPayload`, `ReviewListPayload`, `PasskeyListPayload`, `ApprovalOptionsPayload`, `PublicKeyRequestJSON`, `PublicKeyCreationJSON`, `ApprovalOutcome`). **`review-file.ts`**: `getReviewFilePath`. **`syntaxHighlighter.ts`**: refractor with css, json, markdown, markup, tsx and yaml. **`theme.ts`** installs the shared theme and saves a choice with `updateReviewSettings({ theme })`. **`styles.css`**: Tailwind plus `jig-core`'s `kit/theme.css`. The alias `@web/*` points at `src/`.
- **One origin, relative URLs.** Never add an absolute URL or another host: the policy is `default-src 'self'`. **The page decides nothing**: it shows what the server returns as text (no `dangerouslySetInnerHTML`), approval is checked server-side, and record shapes come only from `../../src/types.ts`.
- **SSE names** `connected` and `review-updated` must match what `ReviewServer` sends; routes must match the server's `index.html` fallback. **Tailwind scans only `src/`** (`@import "tailwindcss" source(".")`), so a build does not depend on the previous `dist/`.
- **Effects**: same-origin `/api/*` requests and the `/api/events` EventSource; `localStorage["jig-theme"]` through the shared installer; `navigator.credentials`, `window.confirm` and `window.close` in child components.

### src/discussions/

- **`buildReviewThreads({ activeReview, drafts, file }): ReviewThreadMap`**: display-only thread data for one file (drafts, then submitted comments and resolutions, then collapse and "agent answering" state). **`getSelectedLine(change, side, filePath): SelectedLine | undefined`**: a clicked line as a comment location, or `undefined` when it cannot host one. Types in `types.ts`: `ThreadResolution`, `ReviewThread`, `ReviewThreadMap`.
- **Display only**: nothing here mutates a review or a draft or calls the server. The thread key is the `react-diff-view` change key; a deleted line is side `old`, an inserted one `new`, an unchanged one takes the clicked side. The file path comes from `getReviewFilePath`. Do not redefine record types here. No network, storage or DOM.

### src/components/

React components grouped by screen: `review-page/`, `reviews/`, `settings/` and `ui/`. This folder has no source of its own.

### src/components/ui/

- **`Button`** (`FC<ButtonHTMLAttributes & { variant?: "primary" | "secondary" | "success" | "link" }>`), re-exported by `index.ts`. Defaults `type="button"` (so it never submits a form by accident) and `variant="secondary"`; extra `className` is appended. Imported as `@web/components/ui/index.js`: keep that path and add new primitives to `index.ts`. Tailwind utility classes only. No effects.

### src/components/settings/

- **`SettingsPage`** (no props) loads `fetchSettings` and `fetchPasskeys`, shows checkboxes for `autoAskReview` and `autoOpenBrowser`, a `diffView` select and the passkey list with problems; **`formatFingerprint`** groups a fingerprint for comparison.
- **The page renders three of the six settings.** The server's `parseSettingsUpdate` also accepts `holdAgent`, `holdAbortAfter` and `theme` (`plugins/jig-review/src/server.ts`), and `theme.ts` sends `theme`. Adding a field to the page needs `parseSettingsUpdate`, `types.ts` and the README table.
- **The page only asks.** Registering and removing a passkey are confirmed in Pi by the server; the page never stores a key. Removing shows "Waiting for your answer in Pi."; registering shows "Create the passkey in the prompt, then confirm its fingerprint in Pi." Passkey problems (`problem` red, each `problems` line amber) are always shown. Server text is rendered as text.
- **Effects**: `GET` and `PATCH /api/settings`, `GET /api/passkeys`, `POST /api/passkeys/options`, `POST /api/passkeys`, `DELETE /api/passkeys/<fingerprint>`; `navigator.credentials.create` through `passkeys.ts`.

### src/components/reviews/ and reviews/components/

- **Pages that never comment**: `ReviewListPage` (`/reviews`, newest first as the server sends them), `ReviewConversationPage` (for any review, the live one included: summary cards, comments, agent resolutions with the small diff, lifecycle events including how approval was given; reuses `ConversationMessageBubble` and `ConversationDiffSnippet`), `ReadOnlyFilesPage` (the files page of a review that is not the live one: the last iteration's diff, no comment controls).
- **Pieces** in `components/`: `ReviewListItem`, `ReviewNavigation` (links to `/reviews`, `/settings` and a review's two pages), `ReviewStatusBadge` (status or "active", and how an approved review was approved). Props only: no fetching or mutation. A new `ReviewStatus` needs a badge case.
- **Read-only**: these pages never post. Only `App.tsx` routes the server's current review (`isActive`) to `ReviewPage`. Addresses are relative and must match `App.tsx`'s route regex and the server fallback. Conversation file links are `/review/<id>/files#file-<sanitized path>` and must match `getFileAnchorId`. No effects beyond reading `window.location.pathname` for one link.

### src/components/review-page/

- **`ReviewPage`** (`{ drafts, files, generalComment, onDraftsChange, onGeneralCommentChange, onReload, review, settings }`) composes the header, the three-column layout and the action dialog. **`useReviewPageState(options)`** returns `{ addDraft, askDraft, removeDraft, updateDraft, changeViewType, fileMetrics, globalStats, isActionModalOpen, setIsActionModalOpen, viewType }`.
- **State ownership**: drafts and the general comment belong to `App.tsx` and are passed down. `viewType` starts from `settings.diffView`; changing it sends `PATCH /api/settings`. `askDraft` posts one comment to `/api/ask`, removes the draft, then reloads. Only for the review the server holds as current (`isActive`).

### src/components/review-page/components/ and components/components/

- **Layout**: `ReviewHeader` (and `approvalIssue(review)`), `ReviewPageLayout`, `FileExplorer`, `ReviewSidebar`, `DiffList`, `DiffFile`. **Comments**: `InlineCommentForm`, `InlineThread`, `DraftCommentList`, `ConversationMessageBubble`, `ConversationDiffSnippet`; in `components/components/`, `DraftCommentItem` (a passive summary row) and `DraftConversationMessage` (edit, **Ask**, remove). **Approval dialog**: `ReviewActionModal`, `ReviewActionModalButtons` (`hasDraftComments`, `getSubmittedComments`), `ApprovalPanel` and `useApproval(diffHash, onApproved)` returning `{ approve, approveElsewhere, register, reset, state }` (`ApprovalState`: `idle`, `working`, `choose`, `failed`, `done`). **Helpers**: `reviewMetrics.ts` (`getFileReviewMetrics`, `getGlobalDiffStats`, `getFileAnchorId`), `diffFileHelpers.tsx` (`getTokens`, `isCollapsedByDefault`), `composerSwitch.ts` (`registerActiveComposer`, `resolveActiveComposerBeforeSwitch`).
- **The page cannot approve by itself.** `useApproval` sends the last iteration's `diffHash`, then signs a server challenge with the device (`approveWithPasskey`) or asks Pi (`approveInPi`). The server decides.
- **Two gates, not one.** `approvalIssue` disables the header's Approve for `approved`, `awaiting-agent`, `abandoned`, or `pageApprovedAt` set. The Approve button inside the Finish review dialog (`ReviewActionModalButtons`) and the header's Finish review button use a narrower gate: only `approved` and `awaiting-agent` disable them.
- **Keys in the comment forms.** In `InlineCommentForm`, Enter adds a draft, Shift+Enter sends the comment at once (`POST /api/ask`) and Escape cancels. In `DraftConversationMessage`, Enter saves an edit and Shift+Enter inserts a newline.
- **A draft is never dropped quietly.** Approving with drafts or a general comment asks first; a discard is recorded only after the approval succeeds. One transient composer at a time (`composerSwitch.ts`, with `window.confirm`). File anchor ids are `file-<path with non-word characters as ->`. Dot paths, lockfiles, `package.json`, `tsconfig` and tool configs start collapsed. Drafts live in `App.tsx` state.
- **Effects**: `POST /api/ask`, `/api/comments`, `/api/approve/options`, `/api/approve/passkey`, `/api/approve/page`, `/api/passkeys/options`, `/api/passkeys`; `navigator.credentials.create` and `.get`; `window.confirm`; `window.close()` after an approval or submit; an `IntersectionObserver` in `FileExplorer`.

## Invariants

- **`dist/` and `build.json` are committed and must match the sources.** After any change under `src/`, `index.html`, `vite.config.ts`, `package-lock.json`, `public/theme-boot.js`, or `jig-core`'s `kit/theme.css` or `kit/theme-client.ts`, run the build and commit both. `plugins/jig-review/test/web-build.test.ts` compares `build.json`'s hashes; `npm run check:dist` runs `vite build` into a temporary folder and compares file names and bytes with `dist/`. Never hand-edit `dist/`.
- **Nothing but source goes in `src/` or `public/`.** Every file in `src/` is hashed and every file in `public/` is copied into `dist/` and served. That is why no `EGM.md` lives there.
- **The build must be reproducible**: same sources, same lockfile, same Node give the same bytes. Do not add timestamps or random output.
- **Dependencies are exact pins** with no `^` or `~`, on the latest stable release (`scripts/check-pinned-deps.mjs`). Keep them out of the root `package.json`, whose `dependencies` hold the runtime packages (the plugin uses `hono`, `@hono/node-server` and `ignore`).
- **The page imports only types from the plugin's `src/types.ts`** and shared theme files from `jig-core`'s `kit/`; it must not import other server code.
- **CSP compatibility**: no inline scripts, no external hosts. The served policy allows inline styles (see the plugin's `src/server.ts` for the exact header).
- TypeScript here is the native 7.x compiler; no code may `import "typescript"`.

## Side Effects

- **Disk (build only)**: `npm run build` writes `public/theme-boot.js`, empties and rewrites `dist/`, and rewrites `build.json`.
- **Install**: `npm ci` in this folder fills `node_modules/` (gitignored); needs network.
- No runtime effects of its own: the built page runs in the person's browser and talks only to the local server.

## Verification

- Page tests (vitest, `src/**/*.test.ts`): `npm --prefix plugins/jig-review/web test`
- Type check: `npm --prefix plugins/jig-review/web run check`
- Rebuild the committed bundle after a change: `npm --prefix plugins/jig-review/web run build`
- Dist matches sources: `npm run check:dist` (repo root; needs `npm ci` here first)
