### Added

- `/jig doctor` inside Pi gains a "Codemode" line: on or off as Pi's active tools say, and "turned on by Pi: an MCP server is configured" when that is why. `jig doctor` in a terminal shows the line as skipped, because only a running session knows. The Tools and codemode page no longer says Jig ships codemode off: it is Pi's tool, inactive until `defaultTools` adds `"+codemode"`, a run passes `--tools +codemode`, or an MCP server with `codemode` exposure is configured.
