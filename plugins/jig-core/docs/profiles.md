# Profiles and skill overlays

A profile says which company's setup applies to the work at hand, so a person who works for more than one company loads
all their company plugins and only one of them acts. A skill overlay is a company's rules for a generic skill, added to that
skill, so the model reads one skill and not two. Back to the [jig-core overview](../README.md).

```text
 jig.json                      company plugins (load at start, then wait)
 profiles: acme  -> jig-acme       jig-acme    environments, defaults, skills, overlays
           globex -> jig-globex    jig-globex  environments, defaults, skills, overlays
 profile: "auto"
        |
        |  session start: working folder, git origin remote
        v
   chosen: acme (folder ~/work/acme/**)
        |
        +--> jig-acme's environments, rules, section defaults, secret settings, status   apply
        +--> jig-globex's the same                                                       dormant
        +--> overlays/jira.md  + generic jira SKILL.md --> <state>/skills/acme/jira/SKILL.md
        |         each turn: the skill list shows ONE jira, at the merged file
        +--> acme-only skills listed; globex-only skills left out
```

*One choice at session start decides which company's parts apply for the whole session. A merged skill is the generic file plus
the company's section.*

## Configure

Two sections of `jig.json`, both optional:

```json
{
    "profiles": {
        "acme": { "plugin": "jig-acme", "when": { "folders": ["~/work/acme/**"], "remotes": ["github.com:acme-org/*"] } },
        "globex": { "plugin": "jig-globex", "when": { "folders": ["~/work/globex/**"] } }
    },
    "profile": "auto"
}
```

- **A profile** has a name (the key, what `/profile` takes), the `plugin` it points at (the name the company plugin registered
  under, `jig-acme` here) and a `when`. Two profiles may point at the same plugin.
- **`when.folders`** are globs on the session's working folder. `~` is your home, `*` stays inside one folder name, `**` crosses
  folders, and a pattern ending in `/**` also matches the folder itself. Both the folder and its real path are tried.
- **`when.remotes`** are globs on the `origin` remote of the repository the working folder is in, written
  `host:owner/repo`: `git@github.com:acme-org/orders.git` and `https://github.com/acme-org/orders.git` are both
  `github.com:acme-org/orders`. Case is ignored.
- **`profile`** is `"auto"` (the default), `"none"` or a profile name.

## How a profile is chosen

The first rule that fits decides. `/profile` shows which one, and the pattern that matched.

| Order | Rule | Reason shown |
|---|---|---|
| 1 | `/profile <name>` in this session | `session` |
| 2 | `"profile": "<name>"` in `jig.json` (`"none"` means no company) | `explicit` |
| 3 | `"profile": "auto"`: the first profile in the file whose folder or remote matches | `folder`, `remote` |
| 4 | No `profiles` section at all, and exactly one company plugin loaded: that company | `sole` |
| 5 | Anything else | `none` |

- **An empty or non-matching `profiles` section is `none`,** not rule 4. Writing profiles means you decided where each company applies.
- **A name that is not a profile, or whose plugin is not loaded, activates nothing** and `/profile` says why. It never falls back to
  another company.
- **An invalid `profiles` or `profile` section activates nothing** (even a sole company), and `/jig` lists the problem.
- **The remote is read from `.git/config`,** found from the working folder upwards (a worktree reads the shared config). No process
  is started and nothing touches the network. `include` and `insteadOf` are not followed.
- **Back compatible.** With no `profiles` section and one company plugin, the company is active as it was before profiles existed.
  A plugin that does not register (`profiles.register`) applies always, as before.

## What dormant means

A company plugin registers with `profiles.register(name, options)` and gives its parts through the view that call returns. Only
the active company's parts apply:

| Part | While dormant |
|---|---|
| Environments (`addEnvironments`) | Not defined, so the names count as production |
| Rules, classification rules | Not applied |
| Section defaults (`addSectionDefaults`) | Not laid under your sections, so those plugins are not configured by it |
| Secret commands and backends | Not available |
| Status lines (`status.register`) | Not shown in `/jig` |
| Skills the company listed in `skills` | Left out of the model's skill list |
| Overlays | Not merged |
| Protected paths, mask fields | **Still apply:** they can only protect |
| Tunnels, transports, sign-in services | Stay registered, and are used only if configuration names them |
| Tools of its own | Its `onChange(false)` is called: hide them with `exposure: "hidden"`, show them again on `onChange(true)` |

- **Safety is the reason for the split.** A dormant company's production environments must not leak into another company's work, and a
  dormant company's allow rules must not weaken another's. A path that protects, or a field that is masked, harms nobody.
- **`onChange(active)` is called once at session start with the state it begins in,** and again when `/profile` changes it (after the
  reload). A tool re-registered with `exposure: "hidden"` is withdrawn, since Pi cannot unregister one.
- **Child agents** start their own Pi in their own working folder, so each chooses its own profile.

## Choosing for one session

- **`/profile`** shows the active profile and why, the profiles in `jig.json`, which company plugins are loaded and which skills carry company rules.
- **`/profile <name>`** chooses a profile for this session and reloads once the agent is idle, because plugins read their sections
  when a session starts. The choice is an entry in the session file (never shown to the model), so a reload or a resume keeps it.
- **`/profile auto`** drops the choice, **`/profile none`** turns every company off for the session.
- **`/jig`** shows the active profile in one line.

## Skill overlays

A company plugin keeps `overlays/<skill-name>.md` next to its code. It is plain Markdown with no front matter, so Pi can never load
it as a skill. It starts at heading level 3, because the merged skill adds the level-2 heading. The plugin passes the folder as
`overlays` when it registers.

For the active company, when a session starts, jig-core writes for each overlay whose generic skill is loaded:

```text
<state folder>/skills/<profile>/<skill-name>/SKILL.md
```

- **The generic file comes first, unchanged:** its front matter, so name and description are the generic ones, and its body.
- **Then `## <display name> rules` and the overlay.** The display name is what the plugin registered.
- **The other files of the generic skill's folder are copied beside it,** so a relative link in the skill (`references/guide.md`) still
  resolves from the merged copy. Symbolic links are not copied. A skill folder over 400 files or 8 MiB is not merged and `/profile` says so.
  A link that leaves the skill's folder (`../other`) is not rewritten.
- **Each turn,** in `before_agent_start`, the skill list of the prompt is edited: the overlaid skill's file is the merged copy. The model sees
  one `jira` skill with the generic description, and reading it gives both texts. Pi's own skill objects are not changed, a new list is set.
- **The copies are rewritten at session start and reload,** or when a turn shows a different skill list. Edit an overlay or the generic
  skill, then `/reload`.

Interactions:

- **jig-session's skill switches work on the generic name,** which does not change. A skill switched off stays off.
- **A company-only skill** (no generic counterpart) is a normal skill in the company package. The company lists its name in `skills` when
  it registers, and it is in the skill list only while the company is active.
- **An overlay whose generic skill is not loaded** applies to nothing; `/profile` notes it.
- **A skill invoked as a command** (`/skill:jira`) is Pi's own and reads the generic file; the overlay applies to the model's list.

## Writing the company side

See [Writing a company plugin](../../../docs/company-plugin.md#8-profile-and-skills), which also shows how to move from a
`<company>-<skill>` skill to an overlay.

Back to the [jig-core overview](../README.md).
