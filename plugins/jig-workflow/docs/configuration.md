# Configuration: the `workflow` section

The fields of the `workflow` section of `jig.json`. Back to the [jig-workflow overview](../README.md).

## The fields

In `~/.jig/jig.json`, under `workflow`. Every field is optional.

| Field | Default | Meaning |
|---|---|---|
| `folders` | none | More folders to read workflow files from: absolute, or starting with `~/` |
| `disabled` | none | Names of workflows to leave out, from whichever folder they come |
| `tests` | by build file | A test command per repository: a name or path pattern, then a command or `{ command, timeoutSeconds, env, outside, reports }` |
| `testTimeoutSeconds` | `900` | How long one test run may take, from 10 to 7200 |

```json
{ "workflow": { "tests": {
    "orders-api": { "command": "./gradlew test", "env": { "JAVA_HOME": "~/.sdkman/candidates/java/17.0.9-tem" } },
    "billing": { "command": "./gradlew test", "outside": true },
    "libs/*": { "command": "npm test", "timeoutSeconds": 300 }
} } }
```

Files are read from `folders` (a company's, then yours: the two lists add up), then `~/.jig/workflows/`, then
the project's `.pi/workflows/` once Pi trusts the project; a later file with the same name wins, and `disabled`
leaves a name out whatever its folder. A company's `disabled` list and yours add up. [Tests](tests.md) has the defaults per build file, `env` (plain
variables such as `JAVA_HOME`) and `outside` (a command that needs what the sandbox hides; it asks).

Back to the [jig-workflow overview](../README.md).
