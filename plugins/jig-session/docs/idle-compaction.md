# Compacting while idle

How a session can compact itself while the person is away, a little before the provider's prompt cache expires.

```json
{
    "session": {
        "compactWhenIdle": { "afterSeconds": 270, "minTokens": 150000 }
    }
}
```

With that in `jig.json`, a session that has been idle for four and a half minutes compacts once, if its context holds
at least 150,000 tokens. The person sees one line when it happened:

```text
jig-session: compacted while idle: 152,300 → 23,800 tokens
```

## What it saves

A provider's prompt cache lasts a few minutes, five on Anthropic and Bedrock. When a person comes back after a longer
pause, the next turn writes the whole context to the cache again at the cache-write price. Compacting while the session
is idle leaves a much smaller context to write on that turn, and a smaller context on every turn after it.

The summary is not a cache read. Pi builds a new summarization prompt from the conversation and turns cache retention off
for it, so the summary is billed as ordinary input at the context's input price. The saving is the cache write the next
turn avoids, less the summary and the smaller write that replaces it: real on a large context that continues after the
pause, and negative on a small one or when nobody comes back. That is the trade-off this setting exposes.

It costs when nobody comes back (the summary), and a summary loses detail. That is why it is off by default and why the
wait and the size are settings, not constants: a provider's cache lifetime is not readable by an extension, and a short
session is not worth a summary. Pi has its own compaction, at a threshold and for context overflow, and `/compact` for a
person to ask; none of them looks at idleness.

## The setting

| Key | Range | Default | What it is |
|---|---|---|---|
| `afterSeconds` | 60 to 290 | 270 | How long the session must be idle |
| `minTokens` | 1,000 or more | 150,000 | The smallest context worth a summary |

- **`afterSeconds` is at least 60**: below that it would fire while a person is thinking, not away. At most 290: the
  prompt cache lives about five minutes, so the wait must not outlast it.
- **`minTokens` starts at 1,000; the default is 150,000.** It is a starting point: near this size the summary and the
  smaller cache write cost about the cache write they avoid, and the smaller context pays from later turns. Raise it when
  only larger contexts are worth a summary for your provider.

`"compactWhenIdle": true` uses both defaults and `"compactWhenIdle": false` turns it off; so does leaving the `session`
section out. A misspelt key or a value outside the range is a configuration error naming the key, never a silent default.
`/jig` shows `Idle compaction: after 270 s idle, from 150,000 tokens` when it is set.

## When it fires

- **After the agent has settled**, not after a turn: a retry, an automatic compaction or a queued message would follow a
  turn end, and Pi's `agent_settled` is the first moment nothing more will run. An aborted run (Escape) starts no timer.
- **Only when the session is idle**, nothing is queued, and the context is big enough. The checks run again when the timer
  fires, because the person may have come back in the meantime.
- **Not while the person is writing**: submitted input, a turn, a tool call, an extension prompt, a compaction or a
  shutdown cancels the wait, and a draft in the editor stops the compaction at the moment it would start.
- **Only when someone is there.** `print` and `json` runs have nobody to come back, so no timer starts for them.
- **Once per idle stretch.** It does not try again until the next settle, so a small context or a draft costs nothing more.

## If you type while it runs

Extensions see submitted input and the text in the editor, not keystrokes. A draft at the moment the timer fires prevents
the compaction. A prompt submitted while a compaction is already running is refused by Pi itself, with "Cannot submit a
prompt while compaction is in progress. Wait for compaction to finish and retry." That is the same answer `/compact`
gives, and the window is one summarization call. A watch that wakes in that window is not held: Pi starts its run while
the summary is made. It is the one case this setting cannot foresee, because Pi does not tell an extension when a watch
will next poll.

## What it is built on

Pi's extension API: `agent_settled` is the final-idle signal, and `ctx.compact({ onComplete, onError })` starts the
compaction without waiting for it. Before it starts, it checks `ctx.isIdle()`, `ctx.hasPendingMessages()`,
`ctx.getContextUsage()` and the editor text through `ctx.ui.getEditorText()`. `onComplete` carries the tokens before and
the estimated tokens after, which is the line above. Pi still runs `session_before_compact`, so another extension can
cancel or replace the summary, and `session_compact` reports the result. Child sessions (`jig-agents`) register the
section so a `session` key stays valid in their `jig.json`, but never compact: their parent is the one with a person in
front of it.

Back to [jig-session](../README.md).
