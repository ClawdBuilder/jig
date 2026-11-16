# jig-review: code map

Every file of `src/`, what it does and who calls it, then the approval followed through the files. Read it with the code
open. Back to the [jig-review overview](../README.md).

The page under `web/src/` is a package of its own; this map covers the server and the plugin.

## The files

| File | What it does | Called by |
|---|---|---|
| `approval-heads.ts` | The repository heads an approval was given at, so a later check can say what was approved | `coordinator.ts` |
| `approval.ts` | The two ways a review is approved, and every refusal: the passkey check and the page-plus-`y` check | `coordinator.ts`, `server.ts` |
| `code-path.ts` | Which agent writes count as code worth an offer (not its own notes or scratch files) | `run-tracker.ts` |
| `command.ts` | What `/code-review` was given: settings, or a scope, a folder, or a ticket | `coordinator.ts` |
| `coordinator.ts` | Ties Pi's events, the records, the local server and what reaches the agent together | `index.ts` |
| `diff.ts` | What the extension needs from a unified diff without parsing it whole: paths, a hash | `approval.ts`, `coordinator.ts` |
| `events.ts` | What the plugin announces on Pi's event bus, such as `review-approved` | `coordinator.ts` |
| `file-filter.ts` | Which changed files a review shows: not installed packages, not what `.gitignore` ignores | `git.ts` |
| `git.ts` | One repository's git state and diffs, run through jig-core's `exec.git` | `command.ts`, `coordinator.ts`, `run-base.ts` and 3 |
| `hold.ts` | What the gate does with one call while an agent-started review waits for the person; pure | `index.ts`, `tools.ts` |
| `index.ts` | The Pi entry point: registers the settings, the tools, the coordinator and the gate, starts nothing | Pi |
| `open.ts` | Opens the review link with `$BROWSER` or `xdg-open`; best effort, the link is printed too | `coordinator.ts` |
| `passkey/cbor.ts` | A small CBOR decoder for what an attestation and a COSE key use, and nothing else | `passkey/webauthn.ts` |
| `passkey/challenges.ts` | The challenges issued and not yet answered: 32 bytes, one use, two minutes, one purpose | `approval.ts` |
| `passkey/store.ts` | The registered passkeys, in `<agent folder>/jig-review/passkeys.json`, mode 0600 | `approval.ts`, `coordinator.ts` |
| `passkey/webauthn.ts` | WebAuthn for one purpose: does this registered key sign this challenge for this page | `approval.ts`, `passkey/store.ts` |
| `prompts.ts` | The messages sent to the agent as the user: the page's comments, and an approval | `coordinator.ts` |
| `run-base.ts` | Where a run's review starts in each repository, past a merge, pull or rebase in the run | `run-tracker.ts` |
| `run-changes.ts` | Which files changed while the agent ran, however they changed, with a fingerprint per path | `run-tracker.ts` |
| `run-tracker.ts` | What the agent changed during the run, for the offer to review it | `coordinator.ts` |
| `server.ts` | The local page, its JSON API and event stream, on 127.0.0.1 and a random port | `coordinator.ts` |
| `settings-options.ts` | The `/code-review settings` menu: one line per setting, and changing one | `coordinator.ts` |
| `settings.ts` | Review settings, and where one workspace's records live, under the agent folder | `coordinator.ts`, `index.ts`, `server.ts`, `store.ts` |
| `store.ts` | The review records: one JSON file each, written whole, with stale ones cleaned | `approval-heads.ts`, `coordinator.ts` |
| `ticket.ts` | Which repositories belong to a ticket, read from jig-memory's binding file | `command.ts`, `coordinator.ts`, `workspace.ts` |
| `tools.ts` | The agent's two tools: start a review, record how it answered; neither approves | `coordinator.ts`, `hold.ts`, `index.ts` |
| `types.ts` | The records the store keeps and the page shows; the page imports these types | every file that keeps a record |
| `used-repos.ts` | Which repositories one run used, judged from its own tool calls, conservatively | `run-tracker.ts` |
| `workspace.ts` | One review across every repository with changes under Pi's folder, each prefixed | `approval-heads.ts`, `coordinator.ts`, `run-changes.ts` and 3 |

## One call: approve, from the page

The page and this plugin are one loop; the approval is the step that cannot be faked.

1. **The page asks.** `web/src` posts to `/api/approve/passkey` (or `/api/approve/page`). `server.ts:207` and `:210`
   route them to `approval.approveWithPasskey` and `approval.approveInPage`; no route approves on its own.
2. **The passkey path.** `approval.ts:259` reads the response and takes the challenge from
   `passkey/challenges.ts:52` by the one in the client data: one use, two minutes, issued for "approve". A challenge that
   was used, expired or never issued is a 403.
3. **The key.** The credential id names a passkey in `passkey/store.ts`; `passkey/webauthn.ts:311` checks the assertion
   against the stored public key, this server's origins, the challenge, and the last sign count (a counter that goes
   backwards is refused). `passkey/cbor.ts` decodes the attestation.
4. **What was approved.** The challenge was issued with the review id and the diff hash, and `approval.ts` compares both
   with the open review (`diff.ts` hashes it). A review that moved on while the person was approving is a 409, not an
   approval.
5. **The record and the bus.** The sign count is recorded in the store, then `coordinator.ts` finishes the approval: it
   writes the review record, announces `review-approved` (`events.ts`), sends the approval to the agent as a message
   (`prompts.ts`), and releases the gate (`hold.ts`).

The fallback is the same rule with Pi as the place the person acts: `approval.ts:312` marks the review "approved in page",
asks in Pi, and approves only on `y`, and only if the review is still the same one. Two approvals cannot run at once
(`approval.ts:366`), and neither tool can approve.

## Where the approval is checked

| Check | Where |
|---|---|
| The challenge is current, unused, and for approving this review | `passkey/challenges.ts:52`, `approval.ts:266` |
| The key is registered here, and the signature verifies | `passkey/webauthn.ts:311` |
| The signature is for this server's origin, not a page that copied one | `approval.ts:284` (`allowedOrigins`) |
| The review is the one the challenge was issued for | `approval.ts:295` |
| The person, not the agent: the page cannot approve without a passkey or a `y` | `server.ts:202`, `approval.ts:312` |
| One approval at a time, and only a review that is waiting | `approval.ts:353`, `approval.ts:366` |

The reason it lives in the agent folder is in `settings.ts`: the agent's shell does not write Pi's agent folder, so a
record that says "approved" was written by this extension, not by a command the agent ran.
