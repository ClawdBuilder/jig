# CI platforms

Which actions each CI system supports. Back to the [jig-ops README](../README.md).

| | status, runs, run, log | rerun | trigger |
|---|---|---|---|
| GitHub Actions | yes | yes, no trigger | no |
| GitLab CI | yes | failed jobs only | yes, on a `ref` |
| Jenkins | yes | no | yes |
| Concourse | yes | no | yes, the job, with no `ref` |
