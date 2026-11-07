# Reading paths

Jig has a lot of documentation. Start with [Your first hour](first-hour.md), then pick the path that matches what you
are doing. This page keeps the longer reading list that used to sit in the root README.

**New here?** [Your first hour with Jig](first-hour.md) takes you from install to your first approval, the sandbox
check and `/lens`, in plain words. When something is missing, [Setup and doctor](setup-and-doctor.md) explains what
`jig doctor` found and what to do. Then:

1. [Architecture](architecture.md): how the tool manager sits over every tool, what it can and cannot control, and
   where each plugin fits.
2. [Permissions](permissions.md): environments, rules per tool, and the floor that configuration cannot lower.
3. [Approvals](approvals.md): how and where you are asked.
4. [Secrets](secrets.md): where passwords and tokens come from, where `pass` looks, and how to use the store you
   already have.
5. [Plugins](plugins.md): every tool and the plugin it belongs to.
6. [Writing a company plugin](company-plugin.md): what a company adds, the seams in order, how your `jig.json`
   layers over its defaults, and the tested example in `examples/jig-acme`.
7. [Decisions](decisions.md): what was decided, what was rejected, and why.
8. [Compatibility](compatibility.md): what Jig is tested with, which names are public, and what counts as breaking.
9. [Glossary](glossary.md): the terms these documents use.
10. [Writing the docs](writing.md): how these pages are written, if you add to them.
11. **The code, with a map.** The big plugins each have a code map:
    [`jig-core`](../plugins/jig-core/docs/code-map.md), [`jig-api`](../plugins/jig-api/docs/code-map.md),
    [`jig-ops`](../plugins/jig-ops/docs/code-map.md), [`jig-sandbox`](../plugins/jig-sandbox/docs/code-map.md),
    [`jig-agents`](../plugins/jig-agents/docs/code-map.md) and
    [`jig-workflow`](../plugins/jig-workflow/docs/code-map.md).

Back to [the README](../README.md).
