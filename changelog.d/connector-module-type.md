### Added

- For a plugin author: the kit's `tools.ts` exports the types `EngineTool`, `CallContext`, `ToolResult`, `JsonSchema` and `ConnectorModule`, so a plugin can write its tools as `EngineTool` objects and hand them to an agent that is not Pi in a `connector.ts`; `jig-git` does this for `pr` and `release`, and nothing changes for a person who uses Jig in Pi.
