# scripts/lib

## Overview

What more than one script shares. Plain Node ES modules (`.mjs`) that import only Node's own modules, so a script that uses them runs before `npm ci`. [scripts](../EGM.md) says which script runs when.

## Interface

| File | Used by | What it gives |
|---|---|---|
| `tree-copy.mjs` | `check-gateway.mjs`, `check-claude-plugin.mjs` | `filesOfTree(repo)` and `copyTree(repo, target)` |

- **`filesOfTree(repo)`**: the names, relative and written with `/`, of the tracked files and of the new files git would add (`git ls-files -z --cached --others --exclude-standard`). A name that is not an existing file is left out: a tracked file that was deleted, a submodule's folder.
- **`copyTree(repo, target)`**: copies those files to `target`, making folders as needed, and returns the names.

## Invariants

- **What a commit would hold.** The list is what a clone of the next commit would have: no ignored file (`node_modules`, build output nobody commits) and no `.git`.
- **No dependency.** Only `node:` imports.
- **No machine path.** Nothing here names a folder of a person's machine.

## Side Effects

- Runs `git ls-files` in `repo`. `copyTree` writes files under `target` and nothing else.

## Verification

- Run: `node --import ./test/support/host.mjs --test test/tree-copy.test.ts`.
