# jig-core/src/mask

## Overview

The masking engine. It turns customer personal data in production tool results (emails, phones, public IPs, cards,
names, addresses, credentials) into keyed daily tokens or `[removed:*]` markers, in JSON values, JSON embedded in text,
URL queries, `key=value` log fields and free text. It fails closed: a result that cannot be masked is dropped by the
caller, never returned in part. Policy and tokens: [masking](../../docs/masking.md); file roles:
[code map](../../docs/code-map.md). Parent: [src](../EGM.md).

## Interface

- **`index.ts` is the only entry** other `src/` files import (`state.ts` is the one caller):
  - `createMasker(key: Uint8Array, options?: MaskOptions): Masker`. Throws `MaskError` when the key is under 16 bytes or
    `extraFields` is not a list or holds a name with no letters or digits.
  - `Masker`: `text(input: string): string` and `value<T>(input: T): T`. `MaskOptions`: `{ extraFields?: readonly string[] }`.
  - `MaskError` (field `failure: MaskFailure`: `limit` | `malformed` | `unsupported` | `internal`) and `dailyMaskKey(stateDir, now?)`.
- **Not importable by other plugins.** They reach masking through `jig().mask.text()`, `jig().mask.value()` and
  `jig().config.addMaskFields()`; the boundary test allows only `contract.ts`, `client.ts` and `kit/`.
- **Internals.** `engine.ts` (`MaskEngine`, a fresh `Pass` per attempt, so one `text()` can run several), `pass.ts` (`Pass`, `UNPARSEABLE`), `kinds.ts`
  (field-name policy: `Kind`, `createClassifier`, `fieldKind`, `label`, `isRemoved`, `isTokenised`), `token.ts` (`Tokens`),
  `key.ts`, `limits.ts` (`Limits`, `MAX_BYTES`, `MAX_NODES`), `error.ts`, `host.ts` (`Host`), `shelf.ts` (`Shelf`, `SENTINEL`).
- **Text stages.** `embedded.ts` + `jsonscan.ts` (JSON inside text), `query.ts` + `percent.ts` (URL query values),
  `logfields.ts`, `credentials.ts`, `freetext.ts`, and the helpers `ip.ts`, `phone.ts`, `luhn.ts`.
- **Output forms.** `email#xxxxxx`, `phone#xxxxxx-<last4>`, `name#`, `user#`, `personal#`, `ip#xxxxxx` (public addresses only),
  `card ****<last4>`, and `[removed:<label>]` for address, geo, government, bank, credential, birth, sensitive and `card` (cvv, cvc and card expiry fields,
  or a card value under 4 digits) and `phone` (a phone-field value that is not a plausible 8-15 digit number or is over 64 characters);
  `[removed:unparseable]` replaces text that cannot be parsed.

## Invariants

- **Fail closed with fixed messages.** Any error becomes a `MaskError` whose message never contains caller input; a
  non-`MaskError` becomes `masking failed: internal error`. The caller (`results.ts`) drops the whole result on any failure
  but `malformed`, which the masker absorbs itself: on a malformed result `text()` tries each line with its own fresh `Pass`, replaces
  only the failing lines with `[removed:unparseable]`, re-masks the rest as a whole, and withholds the whole string only if that fails too.
- **Budget per call.** A fresh `Pass` and `Limits` per call: `MAX_BYTES` 16 MiB, `MAX_NODES` 2,000,000, depth 64; expanded
  text may not exceed twice `MAX_BYTES`. Oversize input is refused, never truncated or half masked.
- **Only plain data.** Class instances, functions, symbols and a non-string to `text()` throw `unsupported`. Keys are copied
  with `Object.fromEntries`, so `__proto__` stays data.
- **U+E000 is reserved.** Text containing it is refused: `Shelf` uses it for placeholders that keep finished text from later stages.
- **Text pass order is fixed:** embedded JSON, query, log fields, credential shapes, free text, then shelf restore.
  Free-text stage order: street address, coordinates, date of birth, email, cards (13-19 digits, Luhn), international phone,
  national phone, social security, IPv6, IPv4. Narrow digit patterns run before broad ones.
- **Judged by field name, in words** (camelCase, snake_case), never by substrings. A field with no rule inherits its
  parent's kind unless that is `safe`. A removed kind replaces a whole object or array. `extraFields` map to `personal` and beat built-in rules.
- **Never masked:** identifier and safe fields (`*id`, `uuid`, `sku`, `status`...), device ids, bare digit runs, business
  names. Their values are still checked for credential shapes, and an identifier value that is empty, over 128 characters or outside
  `[A-Za-z0-9_.:/-]` goes through the full free-text masker. Not every `*id` is an identifier: `taxId` and `governmentId` are removed,
  `emailId` is an email token, `callerId` a phone token. Names inside free text are not recognised.
- **Credential shapes go from any text** (Bearer, `Authorization:`, JWT, `tok_`, `client_secret`, `access_token`, signatures)
  whatever the field name.
- **Tokens are deterministic:** the first 3 bytes of HMAC-SHA256(key, label, NUL, canonical value), so one value gives one
  token in every result and spelling (email lowercased, IPv4 and IPv6 canonical). Tokens contain no `.` or `:`.
- **Undecodable content is refused,** not guessed: percent-decoding is up to 3 layers, strict, fatal UTF-8; JSON that cannot be delimited, or that fails to parse and contains `":`, throws `malformed` (a bracketed span that fails to parse and holds no `":` is left for the text stages).
- **The key rotates daily.** `dailyMaskKey` keeps today's key and the two earlier UTC days (up to 3 files); `state.ts` rebuilds the masker per day and when
  `addMaskFields` adds names. A key under 16 bytes is refused; an empty `stateDir` is refused so a key never lands in the working folder.
- **Change a limit, token format or kind** and update [masking](../../docs/masking.md) and the code map in the same commit.

## Side Effects

- **Disk (`key.ts` only).** `<state>/mask/<YYYY-MM-DD>.key`: 32 random bytes, mode 0600; folder 0700, re-chmodded each
  call. Written through `kit/files.ts` (`createFileDurably`, `syncFolder`) under a temp name `<date>.key.<pid>.<hex>.tmp`,
  then `linkSync`ed so the first of two racing writers wins. A damaged (wrong length) key is replaced.
- **Clean-up.** Each call deletes keys older than 2 UTC days and stale matching `.tmp` files; other files stay.
- **Protected.** The `mask` folder is a protected path: Pi's file tools cannot read it and the sandbox hides it from `bash`.
- **Nothing else.** No env vars, network, processes or timers; `node:crypto` only. Everything but `dailyMaskKey` is pure.

## Verification

- Run from the repository root: `node --import ./test/support/host.mjs --test "plugins/jig-core/test/*.test.ts"`
- Narrower: `node --import ./test/support/host.mjs --test "plugins/jig-core/test/mask-*.test.ts"`
- Docs: `node scripts/check-docs.mjs`
