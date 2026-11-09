# Jira wiki markup

Text in Jira fields is wiki markup, not Markdown; this page is the table and the traps. Back to the [jig-jira README](../README.md).

Text is Jira wiki markup, not Markdown. `**bold**`, backticks, `# Heading`, `[text](url)` and code fences show up literally.

| Write | You get |
|---|---|
| `h3. Heading` (`h1.` to `h6.`) | a heading |
| `*bold*`, `_italic_`, `-strike-`, `+underline+`, `{{monospace}}` | marks |
| `* item`, `** nested`, `# numbered` | lists |
| `[text\|https://example.test]`, `[https://example.test]` | a link (http, https and mailto only) |
| `[~accountid:ID]` on Jira Cloud, `[~username]` on Data Center | a mention |
| `{code:java}...{code}`, `{noformat}...{noformat}` | a block, kept as written |
| `{quote}...{quote}`, `bq. a line` | a quote |
| `{panel:title=Next steps}...{panel}` | a panel |
| `{color:red}text{color}` | a colour |
| `\|\|Name\|\|Value\|\|` then `\|a\|b\|` | a table |
| `----`, `\\` | a rule, a line break |

Traps:
- `{` and `}` open macros, even inside `{{ }}`. Write a placeholder as `<name>`, or put text with braces in `{code}`.
- A line that starts with `*`, `#` or `-` and a space is a list item.
- A `|` ends a table cell, except inside a `[link]`.
