### Added

- `jig-gateway`, a command that offers Jig's tools to an agent that is not Pi, and a Claude Code plugin that starts it (`claude plugin marketplace add`, then `claude plugin install jig@clawdbuilder`): Claude Code can read pull requests and releases through Jig's `pr` and `release` tools, every call is recorded, and a write is refused for now because Jig cannot ask you from there; `jig doctor` has an "Other agents" group that checks the setup.
