# jig-review passkey

## Overview

WebAuthn on `node:crypto` alone, with no library. It checks that a person with a registered authenticator approved a review, and keeps the public keys. `../approval.ts` calls it and `../coordinator.ts` builds the `PasskeyStore`; nothing here touches the network or a review. Specification: [Passkeys](../../docs/passkeys.md).

## Interface

- **`webauthn.ts`**
  - `RP_ID` (`"localhost"`), types `Algorithm` (`"ES256" | "RS256"`) and `WebAuthnFailure`.
  - `class WebAuthnError` (`code: WebAuthnFailure`).
  - `verifyRegistration(RegistrationInput): Registration`: `{ credentialId, key, signCount }`.
  - `verifyAssertion(AssertionInput): { signCount }`: returns the counter to store.
  - `challengeOf(clientDataJSON)`: the challenge a client-data blob names, to find which issued challenge it answers.
  - `publicKeyFromCose(cose)`, `publicKeyFromSpki(spki)`: both return `PublicKey { algorithm, spki, key }`.
  - `parseAuthenticatorData`, `fingerprintOf(spki)` (64 hex), `formatFingerprint`, `toBase64Url`, `fromBase64Url`.
- **`cbor.ts`**: `decodeCbor(bytes, offset?)`, `decodeCborExactly(bytes)`, `class CborError`, type `Cbor`.
- **`challenges.ts`**: `ChallengeBook<Context>` (`issue`, `take`, `clear`, `size`), `ChallengePurpose` (`"register" | "approve"`), `CHALLENGE_BYTES` (32), `CHALLENGE_TTL_MS` (2 minutes).
- **`store.ts`**: `PasskeyStore(file)` with `read()`, `add(passkey)`, `remove(fingerprint)`, `recordUse(fingerprint, signCount, at)`; `StoredPasskey`, `PasskeyRead`, `class PasskeyStoreError`.

## Invariants

- **Key types**: only ES256 (P-256) and RS256 (RSA of 2048 bits or more, exponent 65537 or an odd larger one). Anything else is refused, in `publicKeyFromCose` and `publicKeyFromSpki` alike, so a stored key is never weaker than a registered one.
- **Ceremony checks**: client-data type, challenge (`timingSafeEqual`), origin in `allowedOrigins`, no `crossOrigin`, relying-party hash is SHA-256 of `localhost`, user present and user verified. The attestation statement is deliberately not examined.
- **Counter**: an assertion fails with `sign-count` unless the counter rose, except when both the stored and reported counters are 0.
- **Challenges**: single use, whatever the outcome (`take` deletes before checking purpose and expiry). Bound to a purpose, so a register challenge cannot approve. At most 16 outstanding, the oldest dropped first.
- **CBOR is strict**: no floats, tags, indefinite lengths, repeated map keys, or depth over 8. `decodeCbor` itself accepts trailing bytes and returns `end`; `decodeCborExactly` and the callers' length checks (`webauthn.ts:122`, `:280`) refuse them.
- **Store trust**: `read()` re-reads the file every time. The whole file is `unusable` (no key trusted, never overwritten) when it is not a plain file, is group or world writable, has another owner, is over 1 MiB, cannot be read (any `lstat` or read error but ENOENT), is not JSON, or is not `{ "version": 1, "passkeys": [...] }`. An entry is ignored when its fingerprint is not the SHA-256 of its key, it lacks `confirmedAt`, its algorithm is not its key's, or it duplicates another. The cap of 10 keys is enforced only by `add`; `read()` trusts however many valid entries the file holds (`store.ts:84-97`, `:108`).
- **Writes** are whole-file, via `replaceFileDurably` from `jig-core`'s `kit/files.ts`. Never add a code path that writes a key without a confirmed fingerprint.
- Failures are typed (`WebAuthnError.code`); a malformed message is refused, never guessed at.

## Side Effects

- **Disk**: `PasskeyStore` reads and writes `<agent folder>/jig-review/passkeys.json` (file mode 0600; creates the folder with mode 0700 and chmods it). No other file access.
- **No network, no processes, no env vars.** `ChallengeBook` keeps state in memory only and takes an injectable clock for tests.

## Verification

- Run from the repo root: `node --import ./test/support/host.mjs --test "plugins/jig-review/test/*.test.ts"`
- Whole suite: `npm test`
