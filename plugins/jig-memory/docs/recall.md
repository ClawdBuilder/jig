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

A derived entry reaches the agent only with real evidence: a shared ticket key,
identifier, ID or error line, or a word that is rare in this folder. A word is
rare when BM25's relative rarity is at least 0.6 — about three of seventeen
tickets, or six of 1,700 — so the rule does not need a different number for a
large folder. Common words alone never surface a note, however many of them
match. Six generic words (`one`, `still`, `branch`, `review`, `plan`, `account`)
are never evidence even when a small folder makes them look rare. Hyphenated tool
and script names such as `order-sync` and `run-tests.sh` are extracted as names,
because a real neighbour can share one instead of sharing a word.

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

### The hand-label test

`scripts/recall-eval.mjs --folder <tickets>` is the generic test. It takes the
first 25 meaningful lines of each note as the query (an approximation of the
message that starts a ticket), removes every ticket key from the query and both
documents, and prints counts only.

**Hand labels beat derived links.** A ticket naming another is not proof they are
related: the name can be a branch in a code pointer or a test account. With
`--labels <file>`, a JSON file of key pairs replaces the derived links. A person
who read the hits can say which pairs are topical; the file is read by the
script and never copied into the repository. Without labels, the script keeps the
derived links for any company's folder.

A label pair is counted both ways, and the test uses `--top 3` for the scoring while
`recall.maxNotes` remains the display budget. The test therefore sees three
derived entries even when the display would show one.

### Measured on our own tickets

The current folder has 17 tickets and four label pairs.

| Run | Documents | Links found in top 3 | Recall@3 | Pairs found (any / both) | Tickets with no label, hit | Noise (upper bound) | Hits with a name / word only |
|---|---|---|---|---|---|---|---|
| Cards only | 0 | 0 of 8 | 0 | 0 / 0 of 4 | 0 of 11 | 0 | 0 / 0 |
| Notes, rule off | 17 | 4 of 8 | 0.5 | 3 / 1 of 4 | 9 of 11 | 0.818 | 5 / 4 |
| Notes, rule on | 17 | 4 of 8 | 0.5 | 3 / 1 of 4 | 9 of 11 | 0.818 | 5 / 4 |
| Notes with derived links | 17 | 2 of 4 | 0.5 | — | 11 of 13 | 0.846 | 7 / 4 |

- **The rule removed no hit on this folder.** Every hit already had a shared name,
  ID, error or rare word; the four word-only hits are rare words, not the generic
  words the hand reading called junk. The noise figure is an **upper bound** because
  three of the eleven unlabelled tickets do have real neighbours that no label
  records.
- **The top-3 cap was real.** With the display budget of one, the derived test found
  one of four; with `--top 3` it finds two of four. The hand labels then show four of
  eight directions, three of four pairs in at least one direction, and one pair in
  both directions.
- **The labels are only four pairs.** This is a sanity check, not a benchmark; it
  cannot tune a threshold.

`recall.notes` is **off** in the code until the person decides on these numbers.
