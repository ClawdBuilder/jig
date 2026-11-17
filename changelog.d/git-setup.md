### Added

- `jig setup` asks git's own questions: the `gh` login, and one `git.accounts` mapping per set of repositories, with the `gh` account the machine is signed in to as a proposal. A plugin whose questions are all optional, and whose section works with nothing written, shows as `ready (optional settings)` instead of `not set up`; git is the first, so it runs on its defaults without a nag and the doctor stays quiet until a mapping is wanted.
