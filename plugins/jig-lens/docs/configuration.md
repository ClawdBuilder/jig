# Configuration: the `lens` section

The fields of the `lens` section of `jig.json`. Back to the [jig-lens overview](../README.md).

## The fields

In `~/.jig/jig.json`, under `lens`. The field is optional. `jig-core` checks
the section when a session starts; a mistake names the key, and the defaults apply.

| Field | Default | Meaning |
|---|---|---|
| `port` | 3300 | The port of Grafana or Datasette on `127.0.0.1`. `/lens web` takes a free port of its own |

```json
{ "lens": { "port": 3300 } }
```

`viewer` is gone: the command names the viewer now (see
[Viewer settings](viewer-settings.md#the-viewer-setting-is-gone)).

Back to the [jig-lens overview](../README.md).
