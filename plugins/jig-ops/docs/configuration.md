# Configuration: the `ops` section

The fields of the `ops` section of `jig.json`. Back to the [jig-ops overview](../README.md).

| Field | Meaning |
|---|---|
| `services` | The service catalog: environments, their deploy, runtime and health, CI and pins |
| `watch` | CI and rollout watch defaults: poll interval, limit and when to give up |
| `artifacts` | When an artifact is "ready" for a watch that passes |

[The catalog](catalog.md) has every service field and what is checked.

Back to the [jig-ops overview](../README.md).
