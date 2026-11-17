# jig-acme src

## Overview

The Pi extension of the example company plugin. One small file per seam; each calls one thing on `jig-core`'s global handle and something in Jig reads the result. The factory only registers: no network, no processes, no timers and no file writes happen when Pi loads it. Acme Corp is fictional; other plugins' tests also use the name `acme`.

## Interface

- **`index.ts`**: default export `jigAcme()`, an `ExtensionFactory` (the `pi.extensions` entry in `../package.json`).
  - `jigAcme(options?: JigAcmeOptions)`: `JigAcmeOptions` is `{ hosts?, tunnel? }`, which tests replace.
  - `ACME_PLUGIN = "jig-acme"`: the `plugin` name in a `jig.json` `profiles` entry.
  - Inside one `withJig` callback it calls `profiles.register` (overlays `../overlays`, skill `acme-releases`; falls back to the bare API on an older `jig-core`), `config.registerSection("acme", validateAcme)`, then every `register*` below.
- **`config.ts`**: `validateAcme(raw): string[]`, `settingsOf(api): AcmeSettings`, `proxyOf(address): URL | undefined`, `DEFAULT_SSO_TOKEN` (`cmd:acme-sso`), `DEFAULT_GATEWAY_PROXY` (`http://127.0.0.1:3128`), `DEFAULT_BASTION_HOST`. The `acme` section: `sso.token`, `gateway.proxy`, `bastion.host`, `bastion.user`.
- **`environments.ts`**: `ENVIRONMENTS` (`dev` test, `staging` test with `mask`, `prod` production), `registerEnvironments`.
- **`hosts.ts`**: `ACME_HOSTS` (`.acme.example`, `acme.atlassian.net`), `hostAllowed(address, hosts)`, `isLoopback(host)`.
- **`secrets.ts`**: `SECRET_COMMANDS` (`acme-sso` runs `acme auth token`), `ENABLED_BACKENDS` (`cmd`), `registerSecretCommands`.
- **`signin.ts`**: `SSO_SERVICE = "acme-sso"`, `createSsoService(options)`, `registerSignIn(api, settings, hosts)`. Adds `Authorization: Bearer <token>`.
- **`transport.ts`**: `GATEWAY_TRANSPORT = "acme-gateway"`, `createGatewayTransport(options)`, `registerTransport(api, proxy, hosts)`. Carries a request through a local HTTP gateway.
- **`tunnel.ts`**: `BASTION_TUNNEL = "acme-bastion"`, `BastionDeps`, `systemDeps`, `sshArguments`, `failureOf`, `createBastionTunnels`, `registerTunnel`. An `ssh -L` forward, kind `forward`.
- **`masking.ts`**: `MASK_FIELDS` (`memberAlias`, `loyaltyCardHolder`). **`protection.ts`**: `ACME_LOGIN` (`~/.acme/credentials.json`), `PROTECTED_PATHS`, `registerProtection`.
- **`status.ts`**: `registerStatus` adds `/jig` lines. **`onboarding.ts`**: `ACME_ONBOARDING`, `registerOnboarding` (the `/jig setup` list in Acme's order and words).
- Subdirectories:
  - [defaults/](./defaults/EGM.md): section defaults for nine plugins.
  - [jig/](./jig/EGM.md): the global handle copy, port helpers copy and contract types.

## Invariants

- **Registers only.** The factory does no work at load; the sign-in, transport and tunnel act when `jig-core` calls them.
- **Late-load safe.** Everything runs inside `withJig`, so load order against `jig-core` does not matter. `status` and `onboarding` use `?.` because an older `jig-core` may lack them.
- **Profile-scoped.** Everything is given through the view `profiles.register` returns, so it applies only while the Acme profile is active.
- **Configuration and knowledge only.** A seam gives a tool another site or sign-in, never another behaviour. The floor holds: `prod` is read-only and masked; protected paths and mask fields can only be added.
- **No credential in code.** A secret is a reference (`env:`, `pass:`, `cmd:`). `validateAcme` refuses a pasted value and the message never repeats it.
- **Host allow-list.** `signin.ts` and `transport.ts` refuse any request whose host is not in `hosts`, or that is not https (loopback http excepted). Errors name no address, since it could hold a query.
- **The gateway is local.** `proxyOf` accepts only plain `http` to `127.0.0.1`, `localhost` or `[::1]`, with no credentials, path, query or fragment.
- **ssh is never given free text.** `tunnel.ts` tests the call's target host and the bastion host against `WORD`; the login is checked by `LOGIN` in `validateAcme` (`config.ts`), so none can read as an ssh option; `-F /dev/null`, `BatchMode=yes` and `StrictHostKeyChecking=yes` stay; ssh's own stderr is never echoed.
- **Names are shared.** `acme-sso`, `acme-gateway` and `acme-bastion` are referenced by `defaults/`; rename them together.
- **No Jig imports at run time** except through `./jig/`. Imports are Node modules and Pi packages only (`scripts/check-runtime-deps.mjs`).

## Side Effects

- **At load:** none. Registration writes into `jig-core`'s tables only.
- **Per request (`signin.ts`):** resolves the secret reference through `api.secrets.resolve` (which may run the `acme` command via the `cmd` backend); the token is never stored.
- **Per request (`transport.ts`):** an HTTP request to the local gateway (default `127.0.0.1:3128`), response read up to the caller's `maxBytes + 1`.
- **Per tunnel (`tunnel.ts`):** starts `ssh -N -L 127.0.0.1:<port>:<host>:<port>` through `api.exec.run`, with only `SSH_AUTH_SOCK` passed. Probes a free local port, lives at most 4 hours, and is stopped by abort signal.
- `secrets.ts` turns on the `cmd` secret backend for Acme users. `/jig` and `/jig setup` read `status.ts` and `onboarding.ts`.

## Verification

- Run: `node --import ./test/support/host.mjs --test "examples/jig-acme/test/*.test.ts"` from the repo root (also under `npm test`).
- Tests use a fake Pi, fake servers and a fake `ssh`; nothing real is contacted.
- See also the [README](../README.md).
