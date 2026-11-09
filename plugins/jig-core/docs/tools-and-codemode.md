# Tools and codemode

## Deferred tools

Each tool's description is sent to the model at session start. A tool named in `tools.deferred` is registered with Pi's
`deferred` exposure instead: the model does not see it until Pi's `tool_search` finds it by its name or description and
activates it, one extra step when it is needed.

```json
{ "tools": { "deferred": ["mongo", "logs", "deploy", "runtime"] } }
```

- **Only Jig's tools.** Pi's own (`read`, `bash`, `edit`, `write`, `grep`, `find`, `ls`, `tool_search`, `codemode`) are an
  error here. A name that no loaded plugin declared is a warning at session start, said once, and the rest still applies.
- **`tool_search` is switched on for you** when at least one Jig tool is deferred (Pi registers it off). When Pi has no
  `tool_search` (`-builtin:tool-search` in its settings), no tool is deferred, and session start says so.
- **A resumed or reloaded session keeps what it loaded:** a deferred tool that the session's transcript shows active stays active.
- **A workflow stage can bring tools in** while the work is in it (`jig-workflow`'s [stage tools](../../jig-workflow/docs/files.md#stage-tools)).
- **A company plugin may give a default** with `config.addSectionDefaults("tools", { deferred: [...] })`; your own list
  replaces it, and `[]` defers nothing.

Plugins register their tools through `registerJigTool` from the kit (`kit/tools.ts`), a drop-in for `pi.registerTool`, so a
company plugin's own tools can be deferred the same way.

## Codemode

Pi's `codemode` tool runs a JavaScript script that calls tools and returns only the script's output to the model. Jig
classifies the call from the **script text**:

- a script that names only tools is a **local read**. Every tool call inside it is classified and gated as its own call,
  as a direct call is, and a read-only role can run a script of reads;
- a script that names `models`, `globalThis`, `eval`, `Function`, `constructor`, `Reflect`, `import`, `this`, `self`,
  `global`, `getOwnPropertyDescriptor`, `getPrototypeOf`, `defineProperty`, `prototype` or `__proto__`, or computes a member
  access with something other than a number or one plain string, is an **external write**. It asks, with “the script can
  call outside models: ask”, and a role that may not write refuses it. `models` runs classifier and image models on the
  session's credentials, outside every Jig record and gate;
- a missing or unreadable script falls back to asking.

The check reads text. It is conservative, not a proof: a script that can reach `models` is asked even when it does not,
and a script that builds a name from pieces can still get past it. Pi defines `models` on the sandbox's global object as a
non-configurable, non-writable namespace, so Jig cannot remove it before the script runs; the text check and the ask are
the guard. What a missed script can reach is the session's own model providers, on its credentials, outside every Jig
record and gate. That is why the fallback is ask, not allow.

To turn it on, enable Pi's builtin in the agent's `settings.json` and keep the other tools declared:

```json
{ "defaultTools": ["+codemode"], "codemode": { "mode": "on" } }
```

`"only"` would hide the direct tools and list them inside `codemode`; Jig's docs and tests use `"on"`. Jig ships codemode
off, and Pi never lets a package defer it.

What Jig still guards inside the script:

- a nested write is classified as a write; a production write is denied, and a role that may not write refuses it;
- a nested call that needs an approval asks through Jig's dialog;
- a production result is masked, and a secret is removed, before the script or the model sees it;
- the role's `--tools` list limits what the script can reach; a tool outside the list is not a member of `tools`.

Before this change the undeclared `codemode` call counted as an unknown write, so a read-only role could not run a plain
read script and the first call asked. A plain read script now runs without a question; a script that can reach models
still asks, and the nested calls always do.

Back to the [jig-core overview](../README.md).
