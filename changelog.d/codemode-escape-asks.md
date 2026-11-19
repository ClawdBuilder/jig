### Fixed

- A codemode script that contains a `\u` escape now asks before it runs, as one that names `models` does: `\u006dodels` spelled the word without writing it, so the text check let the script through as a plain read. A `\u` inside a string asks too, which is the safe side. The check still reads text and is not a proof.
- `jig doctor` and `/jig doctor` gain a "Codemode" line: on or off, and "turned on by Pi: an MCP server is configured" when that is why. The Tools and codemode page no longer says Jig ships codemode off: it is Pi's tool, inactive until `defaultTools` adds `"+codemode"` or an MCP server is configured.
