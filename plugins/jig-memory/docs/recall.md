# Recall

Recall finds the earlier tickets that look like a new one and hands the agent a
short history: a closed ticket's card, or, when no card exists, an entry derived
from its notes. So a fix found once is not found again from scratch. This page
covers when it runs, how an entry is scored, the threshold, the message, the
indexes and the tests that measure it. Back to the
[jig-memory overview](../README.md).

## When it runs

- **At activation.** A ticket becomes active and has no notes yet (its `notes.md`
  is missing or still the template). Recall runs once per ticket per session.
- **By hand.** `/ticket recall` scores the cards and derived notes entries against
  the active ticket. `/ticket recall some text` scores them against that text. The
  result is shown to you and not sent to the agent.
- **Not automatically** when `recall.enabled` is false. By hand still works.

## What is known about the new ticket

- **The key,** which matters when an older entry names it.
- **The text of the message that activated it,** when a message did.
- **For a run by hand on the active ticket,** its notes and evidence as well.

`jig-jira` does not publish an issue's summary or description on Pi's event bus,
so recall does not use them. `/ticket KEY` has no message, so it recalls by the key
alone.

## How an entry is scored

Shared keys come first, then keyword search. The two add up to one score. A closed
ticket's card and a ticket's derived notes entry are scored the same way; a card
wins for its own ticket.

| Signal | Points |
|---|---|
| A shared ticket key, including the entry's own ticket | 6 each, up to 3 |
| A shared error line | 5 times its rarity, up to 2 |
| A shared identifier | 3 times its rarity, up to 4 |
| Shared words, by BM25 | 0.5 per rare word, up to 5 in all |

- **Rarity** runs from 1 for something only one entry holds down to near 0 for
  something almost every entry holds. A name shared by many entries says little.
- **Error lines** are compared after the numbers, ids and timestamps are replaced,
  so the same failure on two different orders is one error line.
- **BM25** is a small keyword score written for this plugin, with no dependency.
  Its word list is lower case, without common words, and without endings such as
  `-s`, `-ed` and `-ing`; a `CamelCase` name counts whole and in its parts. Each
  word's weight is scaled so one that only one entry uses is worth 1.
- **The text a card is searched by** is its three sections and its repositories.
  **The text a derived entry is searched by** is the ticket's `## Now` and
  `## Decisions` only, each bounded at 4 KB. A 73 KB note therefore costs the same
  as a small one, and evidence is never searched.

## The threshold and the budget

An entry needs `memory.recall.minScore` points, **2** unless you change it. In terms
of the table above:

- One rare shared key, error line or identifier passes alone.
- A name shared by most entries does not: it is worth less than a point.
- Words alone need about four rare ones, since they are the weakest signal.

`memory.recall.max` (3 by default) cuts the whole result. A derived entry also
counts against `memory.recall.maxNotes`, 1 by default: a card does not. Set
`maxNotes` to 0, or `recall.notes` to false, to leave derived entries out. The
numbers below are why the default is off.

## The message

One custom message, never the system prompt, so the cache stays valid. It is
appended without starting a turn. For each card it gives the ticket, why it
matched and its Cause and Fix lines. For a derived entry it gives the ticket, why
it matched, the date of the note, a sentence that notes hold text from tool
results and are history, and the start of its `## Now` and `## Decisions`:

```text
[recall PROJ-130] 1 earlier ticket may relate. Cards: <folder>/<KEY>/card.md. They are hints: check them against this ticket before relying on them.

PROJ-88 (from notes.md, 2026-11-03, may be out of date): shares OrderMapper; words: cancel
  Now: Status: cancelling fails with a NullPointerException in OrderMapper
  Decisions: Check for a null customer before mapping.
```

When no entry passes, no message is sent. `/ticket recall` says so in words.

## The indexes

`.cards.json` in the folder of all tickets holds, for every card, its keys,
identifiers, error lines (as compared), term counts, and its Cause and Fix lines.
`.notes.json` beside it holds a derived entry for every ticket that has notes: the
bounded `## Now` and `## Decisions`, the keys, identifiers and error lines found
there, its term counts and the note's date. Both are copies; recall reads them and
not the files.

- **Rebuilt by itself** when it is missing or unreadable, or when a card's or
  note's size or modification time differs from the stamp the index holds.
- **A card that fails the check** is left out of `.cards.json`; its ticket may
  still have a derived entry, because the card was never a valid card.
- **A notes entry is never written to `card.md`** and never stands in for a card.
- **Delete either file** and the next recall makes it again.

## The tests

`test/recall-eval/` holds 25 invented cards and 30 queries. It is the measurement
that decides whether keys and keywords are enough, before embeddings are
considered; it also runs the scoring change against a fixed floor.

- **The cards** are fictional and generic: an orders service, a payments worker, a
  reporting job, flaky CI, timeouts, a null value in a mapper, a wrong time zone, a
  migration, and others.
- **The queries** are written like the text of a new ticket. Some share a name with
  their card, some paste an error line, some share only words, some say the same
  thing in other words, and three have no card to find.
- **The test** runs recall with the default settings, prints each query with what came
  back and why, then prints recall at 3 and precision. It fails below a floor.

**Recall at 3** is the share of the cards a query should find that came back in the top
three. **Precision** is the share of the cards that came back that a query should have
found.

### Measured on invented data

| Run | `minScore` | Recall at 3 | Precision |
|---|---|---|---|
| First run | 2.5 | 22 of 28 = 0.786 | 22 of 24 = 0.917 |
| Default now | 2 | 25 of 28 = 0.893 | 25 of 27 = 0.926 |

The floors are recall 0.85 and precision 0.88. What stays missed: two paraphrases
that share few rare words, and the second of two cards in one query.

### Measured on our own tickets

`scripts/recall-eval.mjs --folder <tickets>` is the generic test. It takes the
first 25 meaningful lines of each note as the query (an approximation of the
message that starts a ticket), finds the tickets that note names as the real
links, removes every ticket key from the query and both documents, and prints
counts only. It has four linked cases in the current folder — too few to tune on —
and 13 tickets with no link:

| Run | Documents | Links found in top 3 | Recall@3 | No-link tickets with a hit | Apparent noise |
|---|---|---|---|---|---|
| Cards only | 0 | 0 of 4 | 0 | 0 of 13 | 0 |
| Notes index | 17 | 1 of 4 | 0.25 | 11 of 13 | 0.846 |

This is why `recall.notes` is **false** by default: the notes index adds one
correct result and a hit for almost every ticket with no recorded link. The
script's report says "apparent" because a shared service or error can be a real
relation that no ticket key records; the number is still the noise an agent would
pay for. Turn it on only after the noise falls; the README's status line and
`CHANGELOG.md` say the same.
