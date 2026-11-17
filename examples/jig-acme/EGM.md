# jig-acme

## Overview

An example company plugin for a fictional company, Acme Corp: the only place a company plugin lives in this repository. `acme` is a neutral placeholder: other plugins' tests, fixtures and docs also use the name. It gives configuration and knowledge through `jig-core`'s public contract and never changes a tool.

Copy it, rename it and replace the values. Guides: the [README](./README.md) and [Writing a company plugin](../../docs/company-plugin.md).

- **Manifest:** `package.json` (private, `pi-package`) declares `pi.extensions: ["./src/index.ts"]` and `pi.skills: ["./skills"]`. Pi packages are peer dependencies (`*`); no runtime dependency of its own.
- **Not a Jig plugin of the core set.** It has its own tests and runs under `npm test` (`examples/*/test/*.test.ts`).
- **Values stay fictional** (`acme.example`, `orders-api`); never put a real company's hosts, names or credentials here.

## Subdirectories & Boundaries

- src: [./src/EGM.md](./src/EGM.md) - the extension: `index.ts` registers the profile and calls one `register*` per seam (environments, sign-in, transport, tunnel, masking, protected paths, status, onboarding) and the `acme` section of `jig.json`.
- src/defaults: [./src/defaults/EGM.md](./src/defaults/EGM.md) - the company's defaults for nine plugins' sections, as plain data.
- src/jig: [./src/jig/EGM.md](./src/jig/EGM.md) - copies of `jig-core`'s global-handle lookup and port helpers, plus the contract's types; a test fails when a copy drifts.
- `overlays/jira.md` (not linked): the company's Jira rules, merged by `jig-core` into the generic `jira` skill as `## Acme rules`. Markdown only.
- `skills/acme-releases/SKILL.md` (not linked): a skill with no generic counterpart, listed for the model only while the Acme profile is active.
- `test/` (not linked): the real plugins in a fake Pi with fake servers and programs; `test/support/` has the loaders. Tests name each rule they check.

## Verification

- Run: `node --import ./test/support/host.mjs --test "examples/jig-acme/test/*.test.ts"` from the repo root (it also runs under `npm test`).
