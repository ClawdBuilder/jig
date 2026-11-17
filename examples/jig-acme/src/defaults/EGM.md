# defaults

## Overview

The fictional company's defaults for nine generic plugins' `jig.json` sections. A company plugin cannot write the user's file, so it supplies defaults and the user's own section is laid over them. Each file is plain data in the shape its plugin documents; `index.ts` hands them all to `jig-core`.

## Interface

- **`registerDefaults(api: JigApi): void`** (`index.ts`): calls `api.config.addSectionDefaults(section, defaults)` once for each entry of `DEFAULTS`. Called from `../index.ts` through the profile-scoped view.
- **`DEFAULTS: Readonly<Record<string, unknown>>`** (`index.ts`): keys `jira`, `logs`, `mongo`, `api`, `ops`, `memory`, `git`, `theme`, `sandbox`.
- **One export per plugin**, each a plain object, none with a function:
  - `jiraDefaults` (`jira.ts`): `site`, `auth` (`email` plus a `pass:` reference), `projects`, `fields`, `updateFields`, `createDefaults`, `privateNames`.
  - `logsDefaults` (`logs.ts`): `backend` (`elasticsearch`, `auth: { signIn: "acme-sso" }`) and `environments` with one index pattern and `filter` per environment.
  - `mongoDefaults` (`mongo.ts`): `connections` per environment (`staging` and `prod` use `via: { tunnel: "acme-bastion" }`) and `access` (deny lists in `dev` and `staging`, allow list in `prod`).
  - `apiDefaults` (`api.ts`): `collections` (an `.http` folder) and `environments`; `Staging` names the `acme-gateway` transport.
  - `opsDefaults` (`ops.ts`): `services` (`orders-api`, `billing-worker`, GitHub Actions, Helm, Kubernetes) and `artifacts`.
  - `memoryDefaults` (`memory.ts`): `ticketPattern`.
  - `gitDefaults` (`git.ts`): `base`, `protected`, `branchName`, `prTitle`.
  - `themeDefaults` (`theme.ts`): the `acme` palette, based on `jig-signal`.
  - `sandboxDefaults` (`sandbox.ts`): `network.deny` for production database hosts.

## Invariants

- **Data only.** Nothing here imports a plugin; the owning plugin validates the section (with the user's laid over it) at session start. The only import is the type `JigApi` from `../jig/types.ts`.
- **No credential in a value.** Secrets are references such as `pass:acme/jira-token`; never a token or password.
- **Names must match their registrations.** `acme-sso` (`../signin.ts`), `acme-gateway` (`../transport.ts`) and `acme-bastion` (`../tunnel.ts`) are looked up by name; environment keys (`dev`, `staging`, `prod`) must be defined in `../environments.ts`, because an unknown name counts as production.
- **One ticket key, three places.** `jira.projects`, `memory.ticketPattern` and the `git` patterns all use `ACME`; change them together. The Jira overlay is `../../overlays/jira.md`.
- **Production stays narrow.** `prod` has no `deploy` in `ops`, uses a read-only Mongo user and an allow list. `jig-core`'s floor (read-only, masked) applies whatever is written here.
- **Layering.** Objects merge key by key; a user's list or string replaces the company's, unless the owning plugin says otherwise. `replace`: a choice among several (`auth`, `via`, `deploy`, an `api.environments` entry), where the user's replaces the company's whole. `oneOf`: keys that exclude each other (`logs.backend` `auth` versus `transport`), where setting one drops the company's others. `union`: lists that add up, company entries first, so `jira.privateNames` can only grow. `first`: an ordered map keeps the user's keys first.
- **A new plugin section** needs a file here and a line in `DEFAULTS`.

## Side Effects

- None at import. `registerDefaults` only records data in `jig-core` through `addSectionDefaults`: no network, no processes, no disk.

## Verification

- Run: `node --import ./test/support/host.mjs --test "examples/jig-acme/test/*.test.ts"` from the repo root. `layering.test.ts` and `loads.test.ts` read `DEFAULTS` through the real plugins.
- Whole suite: `npm test`.
