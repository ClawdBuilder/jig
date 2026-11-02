# The service catalog

Every field of the `ops` section of `~/.pi/agent/jig.json`, and what is checked.
Back to the [jig-ops overview](../README.md).

`jig-core` checks the section when a session starts. An unknown field is an
error, and so is a field with a value it cannot use.
- **Each error names its key** (`ops.services.orders-api.environments.staging.deploy.release`)
  and never repeats the value it refused, because a secret pasted into the wrong
  place must not reach the model.
- **While the section has an error,** the tools say `ops is not set up` and do
  nothing; `/jig` lists the problems.

## Services and environments

| Field | Meaning |
|---|---|
| `services` | A map from a service name to its entry: 1 to 100 services |
| `repo` | Where the code lives, such as `acme/orders-api`, or a GitLab project's whole path, `platform/payments/orders-api`: up to 200 characters, no white space |
| `ci` | The CI system and where it is (see [`ci`](#ci) below) |
| `environments` | A map from an environment name to its entry: 1 to 20 per service |

- **A service name** has 1 to 40 letters, digits, `.`, `_` and `-`, and starts with a
  letter or a digit.
- **An environment name** has letters, digits, `_` and `-`, starts with a letter,
  and has up to 40 characters.
A section may also have `watch` and `artifacts`, which are not about one service: see
[Watching CI](#watching-ci).

An environment has `deploy`, `pinned`, `runtime`, `health` and `job`, and at least one of them.

**An environment's name is the name `jig-core` knows it by.** The rules, the
masking and the kind of environment (local, external, test or production) come
from that name, so there is no second mapping to keep. Define the test
environments in `jig.json`:

```json
{ "environments": { "staging": { "kind": "test" } } }
```

A name `jig-core` does not know counts as production. Deploys and rollbacks
there are refused, a health check in a pod is refused, and results are masked.
If a test environment is refused as production, this is the setting to add.

## `ci`

An object with a `system`, one of `github-actions`, `gitlab`, `jenkins` and `concourse`, and
the fields of that system. An unknown system or field is an error that names it. What
the tool does with them is in [CI](ci.md).

| System | Field | Meaning |
|---|---|---|
| any | `environment` | Optional. The `jig-core` environment the CI server is in |
| `github-actions` | `workflow` | Optional. The workflow file whose runs `runs` lists, such as `build.yml` |
| | | The service needs `repo`, of the form `owner/name`: the run is found by repository |
| `gitlab` | `url` | The address of the server: `https`, with no user name, query or fragment |
| | `project` | A project id, or the path with its namespace, such as `acme/orders-api` |
| | `auth` | A `token`, a `signIn` service or a `transport` |
| | `required` | Optional. Up to 20 job names that a `required` watch waits for |
| `jenkins` | `url` | As for GitLab |
| | `job` | The job with its folders, such as `orders/build`. A name may hold a space |
| | `auth` | A `user` with a `token`, a `signIn` service or a `transport` |
| | `required` | Optional. Up to 20 pipeline stage names that a `required` watch waits for |
| `concourse` | `url` | As for GitLab |
| | `team`, `pipeline`, `job` | Where the job is: letters, digits, `.`, `_`, `-`, not starting with a dot or a dash |
| | `auth` | A `token` (sent as a bearer), a `signIn` service or a `transport` |
| | `signInHint` | Optional. Up to 200 characters, one line: the command that renews the login, shown when it is refused |

- **`environment`:** without it, the CI host is `external`. A name `jig-core` does
  not know counts as production.
- **`url`** may have a path (`https://host/gitlab`).
- **`auth`** is `{ "token": "<secret reference>" }` (for Jenkins `{ "user": "<name>", "token": "<secret reference>" }`),
  `{ "signIn": "<service>" }` or `{ "transport": "<name>" }`.
- **A Concourse entry** has no `required`: a build has no stages to name. The token is a secret reference, here a
  command you declare that prints only the token `fly login` wrote:

```json
{
  "system": "concourse",
  "url": "https://ci.example.com",
  "team": "main",
  "pipeline": "deploy",
  "job": "orders-api-staging",
  "auth": { "token": "cmd:fly-main" },
  "signInHint": "fly -t main login"
}
```

A token is a secret reference such as `pass:ci/gitlab`; one pasted by hand is an
error that never repeats it. With a transport, the address may be plain `http`:
the transport signs in, so no credential travels.

## Watching CI

The `watch` and `artifacts` parts of the section were `git.watch` and
`git.artifacts` while `jig-git` ran the watch. All fields are optional.

| Field | Default | Meaning |
|---|---|---|
| `watch.auto` | `true` | Start a watch after a push and after a pull request is created |
| `watch.pollSeconds` | 30 | Poll every 5 to 3600 seconds, at least; a CI system can ask for longer |
| `watch.stallMinutes` | 30 | A "still waiting" notice after 1 to 1440 minutes |
| `watch.timeoutMinutes` | 60 | Give up after 1 to 1440 minutes |
| `artifacts` | none | The "artifact ready" rules, a list |

`artifacts` rules: each has a `kind` (`image`, `tag` or `release`) and exactly one place to look:
- `check`: a job name, with an optional `log` pattern;
- `comment`: a pattern, with an optional `bot` login;
- `tag`: a name pattern.

```json
{
  "ops": {
    "services": {
      "orders-api": {
        "repo": "acme/orders-api",
        "ci": {
          "system": "gitlab", "url": "https://gitlab.example.com", "project": "acme/orders-api",
          "auth": { "token": "pass:ci/gitlab" }, "required": ["build", "test"]
        },
        "environments": { "staging": { "health": "https://api.staging.example.com/orders/health" } }
      }
    },
    "watch": { "pollSeconds": 20 },
    "artifacts": [{ "kind": "image", "check": "build-image", "log": "image: (\\S+)" }]
  }
}
```

## `job`

The CI job that acts on an environment: the Concourse job that deploys it, the Jenkins job that builds for it. It is a `ci`
entry (the fields are [above](#ci)) for any system but GitHub Actions, which has no trigger. A `ci` call that names the
environment uses it ([CI jobs](ci.md#a-ci-job-per-environment)).

```json
{
  "ops": {
    "services": {
      "orders-api": {
        "ci": { "system": "github-actions", "workflow": "build.yml" },
        "repo": "acme/orders-api",
        "environments": {
          "staging": {
            "job": {
              "system": "concourse", "url": "https://ci.example.com", "team": "main", "pipeline": "deploy",
              "job": "orders-api-staging", "auth": { "token": "cmd:fly-main" }, "signInHint": "fly -t main login"
            },
            "runtime": { "kubernetes": { "context": "staging", "namespace": "orders", "selector": "app=orders-api" } }
          }
        }
      }
    }
  }
}
```

- **The environment is the key it sits under.** A `job` that names an `environment` is an error.
- **It needs no `repo`,** and an environment may have only a `job`.
- **A job never starts a watch on a push.** Only the service's own `ci` does.
- **A user's own `auth`** for a job replaces the company's whole, as for the service's `ci`.

## `deploy`

An object with a `method`. An environment without `deploy` cannot be deployed
to by the agent, and `production` has none on purpose. `helm` and `kubectl-image` deploy to a
cluster, so the environment must also have `runtime.kubernetes`, which gives the
context and the namespace. A `pin` changes a line of a repository, and needs no cluster.

| Method | Field | Meaning |
|---|---|---|
| `helm` | `release` | The Helm release name: lower-case letters, digits and `-`, up to 53 characters |
| | `chart` | A folder, a chart of a repository such as `acme/orders-api`, or an OCI address |
| | `valuesFile` | Optional. A values file, with the same rules as `chart` |
| | `set` | Optional. Up to 20 Helm values, such as `{ "replicaCount": 2 }` |
| `kubectl-image` | `workload` | `deployment/<name>` or `statefulset/<name>` |
| | `container` | The container of that workload whose image tag changes |

- **`chart`:** up to 300 characters, no white space, not starting with `-`.
- **`set`:** a value is a number, a boolean or text of letters, digits and
  `. _ : / @ + % ~ = -`, up to 200 characters, so that helm cannot read a comma or
  a brace in it. `image.tag` is not allowed: the deploy sets it from the version.

The chart must take the version as `image.tag`. The `pin` method has its own section, [below](#pin). A relative `chart` or
`valuesFile` is read from the folder Pi was started in; give an absolute path for
another. The commands that are built from these fields are in
[Deploy](deploy.md#the-commands).

## `pin`

A `deploy` with `method: "pin"`: the version of an environment is one line of a file in a control repository (a chart version, a
Hiera line, an image tag), and a pipeline or the platform applies it from there. This plugin reads the pin today:
`deploy status`, `deploy plan` and the line a trigger preview shows. `deploy run` and the watch come later, so the writing
fields (`write`, `ticket`, `values`, `branch`, `title`, `merge`, `apply`) are checked now and not yet used to write.

```json
{
  "method": "pin",
  "repo": "acme/deploy-control",
  "base": "main",
  "pins": [{ "file": "clusters/staging/orders-api/chart.version", "line": "^(?<version>\\S+)$", "write": "{version}" }],
  "version": "^(?:\\d+\\.\\d+\\.\\d+|0\\.0\\.0-pr-[A-Za-z0-9._-]+-[0-9a-f]{7})$",
  "ticket": "^PROJ-\\d+$",
  "holder": "(?:^|-)(?<ticket>PROJ-\\d+)(?:-|$)",
  "branch": "deploy/{ticket}-{environment}-{service}",
  "title": "{ticket}: deploy {service} {version} to {environment}",
  "merge": "person",
  "apply": "job"
}
```

| Field | Meaning |
|---|---|
| `repo`, `base` | The control repository on GitHub (`owner/name`) and the branch that deploys |
| `pins` | 1 to 4 places, each `{ file, line, write }`. A file appears once |
| `pins[].line` | Matches exactly one line of the file. A named group `version` is required; others are kept values |
| `pins[].write` | The new line, with `{version}`, `{ticket}`, `{service}`, `{environment}` and the groups of `line` |
| `version` | What a version looks like. It must match from end to end, and is checked before anything is read |
| `ticket` | Optional. The `ticket` parameter's pattern. Required when a template uses `{ticket}` |
| `values` | Optional. Groups of `line` that a call may set, each with its pattern |
| `holder` | Optional. A pattern with a group `ticket`, tried on the first pin's current line |
| `runsAs` | Optional. A pattern with a group `version`: what the runtime reports for a pinned version |
| `branch`, `title` | Templates of the pull request's branch and title, with the four placeholders |
| `merge` | `person` (default) or `tool`: who merges the pull request |
| `apply` | `job`: the environment's CI `job` deploys what `base` pins. `itself`: the platform does |

- **Checked when a session starts:** every pattern compiles, `line` has a group `version`, every placeholder is known, a template
  that uses `{ticket}` has a `ticket` pattern, `values` names only groups of a `line`, and `apply: "job"` has the environment's `job`.
- **What may reach GitHub** is checked once: the repository and the branch are plain names, a file path has no `..`, no white space and
  no leading slash. A call never names any of them.
- **A version, a ticket and a value** from a call must match their pattern from end to end, and be printable text on one line.
- **`holder`** is how `deploy status` says who holds an environment. With the example, a line that holds
  `0.0.0-pr-feature-PROJ-41-1a2b3c4` is held for `PROJ-41`.
- **`runsAs`** turns a pinned version into what the runtime reports: `1.4.3-0` runs as `1.4.3`. `deploy status` judges the pods by it.
- **A user's own `deploy`** replaces the company's whole, as for Helm and kubectl.

## `pinned`

The read-only twin of a pin for an environment with no `deploy`, which is how production keeps no `deploy` entry and is still
read. It has `repo`, `base`, `pins` (each `{ file, line }`), and optionally `version`, `holder` and `runsAs`, with the same meaning.
An environment cannot have both `deploy` and `pinned`: a pin deploy is read through itself.

```json
{
  "repo": "acme/deploy-control",
  "base": "main",
  "pins": [{ "file": "clusters/production/orders-api/chart.version", "line": "^(?<version>\\S+)$" }],
  "holder": "(?:^|-)(?<ticket>PROJ-\\d+)(?:-|$)"
}
```

`deploy status` and `deploy plan` read it, with production's answers masked by `jig-core`. Nothing is ever written there.

## `runtime`

An object that names a runtime. Kubernetes is the only one so far, as
`runtime.kubernetes`:

| Field | Meaning |
|---|---|
| `context` | The kubectl context, as `kubectl config get-contexts` shows it |
| `namespace` | The namespace the service runs in |
| `selector` | The label selector of the service's pods, such as `app=orders-api` |
| `container` | Optional. The service's own container |
| `healthPath`, `port` | Optional, with `container`. A health check made inside a pod |

- **`context`:** a cloud context may hold `:` and `/`; none may start with `-`.
- **`selector`:** one to ten `key=value` pairs, comma separated, equality only. The
  deployments and statefulsets behind the pods are the ones whose selector or pod
  template carries these labels.
- **`container`:** the one `logs` reads when a call names none, the one whose image
  tag is the version, and the one a health check runs curl in. Without it, it is
  the pod's only container, or the one named like the service by its name or its
  image.
- **`healthPath` and `port`:** such as `/actuator/health` and `8080`. The path
  starts with `/`, has up to 400 characters of the usual set, and no `..`, however
  it is percent-encoded.

`healthPath`, `port` and `container` go together: one of them alone is an error,
because the check could never run.

## `health`

An https address that answers when the service is healthy, such as
`https://api.staging.example.com/orders/health`.
- **The limits:** no user name, password or fragment, and up to 500 characters.
- **Plain `http` is not accepted,** and certificates are always checked: to trust a
  private certificate authority, start Pi with `NODE_EXTRA_CA_CERTS` pointing at
  its certificate.

When an environment has both a `health` address and a health path in a pod,
`runtime health` uses the address. A check in a pod is for test environments
that have no address.

## Examples

A service deployed with Helm, with a values file and a value, whose health is
checked by address in staging and read in production:

```json
{
  "ops": {
    "services": {
      "orders-api": {
        "environments": {
          "staging": {
            "deploy": {
              "method": "helm", "release": "orders-api", "chart": "deploy/chart",
              "valuesFile": "deploy/values-staging.yaml", "set": { "replicaCount": 2 }
            },
            "runtime": { "kubernetes": { "context": "staging", "namespace": "orders", "selector": "app=orders-api" } },
            "health": "https://api.staging.example.com/orders/health"
          },
          "production": {
            "runtime": { "kubernetes": { "context": "prod", "namespace": "orders", "selector": "app=orders-api" } },
            "health": "https://api.example.com/orders/health"
          }
        }
      }
    }
  }
}
```

A service whose image is set with `kubectl`, and whose health is checked with
curl inside its pod (one entry of `services`):

```json
{
  "billing": {
    "environments": {
      "staging": {
        "deploy": { "method": "kubectl-image", "workload": "deployment/billing", "container": "billing" },
        "runtime": {
          "kubernetes": {
            "context": "staging", "namespace": "billing", "selector": "app=billing",
            "container": "billing", "port": 8080, "healthPath": "/actuator/health"
          }
        }
      }
    }
  }
}
```
