# jig-jira: code map

Every file of `src/`, what it does and who calls it, and then one real call followed through the files.
Read it with the code open. Back to the [jig-jira overview](../README.md).

## The files

| File | What it does | Called by |
|---|---|---|
| `api.ts` | Jira's REST endpoints (version 2), one function each. They return the shapes… | `commented.ts`, `create-meta.ts`, `field-hint.ts` and 11 more |
| `classify.ts` | How jig-core classifies a call: where it acts and whether it reads or… | `tool.ts` |
| `commented.ts` | `search` with `commented`: the issues a person commented on in some days.… | `format.ts`, `reads.ts` |
| `config.ts` | The `jira` section of jig.json: where the Jira is, how to sign in, and which… | `api.ts`, `classify.ts`, `http.ts` and 4 more |
| `create-meta.ts` | What Jira's create screen says about one issue type, and checking a value… | `plan-create.ts` |
| `field-hint.ts` | A search that names a field Jira does not know ("Field 'PR Link' does not… | `reads.ts` |
| `fields.ts` | Field names and values. A call names a field in one of three ways: a name… | `classify.ts`, `config.ts`, `create-meta.ts` and 5 more |
| `format.ts` | What the model reads: Jira's answers as compact plain text. One line per… | `plan-issue.ts`, `reads.ts` |
| `http.ts` | Talking to Jira: one HTTP request with the sign-in, a timeout, and errors… | `api.ts`, `commented.ts`, `create-meta.ts` and 5 more |
| `index.ts` | Pi entry point of jig-jira. The factory only registers: the `jira` section… || Pi |
| `jql.ts` | Reading and building JQL text: what a query says that its writer may not… | `commented.ts`, `reads.ts` |
| `page.ts` | The markup for the page the user opens with `o` on the review screen: the… | `shown.ts` |
| `params.ts` | The parameters of the `jira` tool. One flat object, because several model… | `classify.ts`, `commented.ts`, `plan.ts` and 4 more |
| `plan-comment.ts` | The plans for the three writes on a comment: add, replace and delete.… | `plans.ts` |
| `plan-create.ts` | The plan for a new issue. Everything the person approves is built here from… | `plans.ts` |
| `plan-fields.ts` | People in fields. Jira Cloud names a person by account id and Data Center by… | `plan-create.ts`, `plan-issue.ts` |
| `plan-issue.ts` | The plans for the two writes on an issue itself: move it to another status,… | `plans.ts` |
| `plan-link.ts` | The plans for the two writes on a link between issues: make one, and remove… | `plans.ts` |
| `plan.ts` | A plan is everything one write needs, worked out once: what the person is… | `plan-comment.ts`, `plan-create.ts`, `plan-issue.ts` and 4 more |
| `plans.ts` | Which planner builds the plan for which write. | `tool.ts`, `writes.ts` |
| `pointers.ts` | The local-pointer check: text that goes to Jira is read by people who do not… | `page.ts`, `plan-comment.ts`, `plan-create.ts` and 2 more |
| `reads.ts` | The eight read actions. Each is a request or two, shaped into compact text… | `tool.ts` |
| `shown.ts` | What a preview shows, as data, and the plain-text body made from it. The… | `page.ts`, `plan.ts`, `tool.ts` |
| `tool.ts` | The `jira` tool: what Pi registers, and the two functions jig-core's… | `index.ts` |
| `values.ts` | Reading what Jira sends back. Jira's answers differ by version and by… | `api.ts`, `commented.ts`, `config.ts` and 16 more |
| `wiki.ts` | Jira wiki markup to HTML, for the page the user opens with `o` before a… | `page.ts` |
| `window.ts` | Days as the person sees them. A call names whole days (`2026-10-01`), and a… | `commented.ts`, `params.ts` |
| `writes.ts` | Sending a write: once, and only if it is still what the person approved. Two… | `tool.ts` |

## One call: `jira get`

1. **The action.** `index.ts` registers the tool. `tool.ts` calls `parseCall` (`params.ts`) and `classifyCall` (`classify.ts`).
2. **The plan.** `buildPlan` (`plans.ts`) reaches `planIssue` (`plan-issue.ts`) for a read, which names the issue and the fields to ask for.
3. **The request.** `runRead` (`reads.ts`) calls `getIssue` in `api.ts`; `http.ts` adds the credential from `jig-core` and sends it.
4. **The shape.** `api.ts` checks Jira's answer and `fields.ts` turns field ids into names the model can use.
5. **The answer.** `format.ts` renders one issue as compact text; `tool.ts` returns it.

Back to the [jig-jira overview](../README.md).
