# Background: where the tools come from

`git`, `pr` and `release` come from an inventory of about 26,000 real tool calls and standard developer needs. The one
missing thing was the wait after a push, which is now the CI watch in `jig-ops`; `jig-git` announces the push that starts it.
See the dated entry in [Decisions](../../../docs/decisions.md).
