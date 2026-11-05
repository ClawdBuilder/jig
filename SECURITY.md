# Security policy

Jig's promise is narrow and testable: a call runs only when a rule allows it, a secret does not reach the model, and
production results are masked. A report that breaks one of those promises is the most valuable kind.

## Supported versions

| Version | Supported |
|---|---|
| the latest tag, `v0.3.0` today | yes, with fixes in a patch release |
| an older tag | no: move to the latest, or open an issue that names why you cannot |
| a branch or a commit | no: it is not a release, and it changes |

The current release is the one on the [Releases](https://github.com/Dev-Mriganka/jig/releases) page. [Compatibility](docs/compatibility.md)
says what this repository promises to keep stable.

## Report a vulnerability privately

Use GitHub's private advisory form:
[Report a vulnerability](https://github.com/Dev-Mriganka/jig/security/advisories/new).

- **Do not open a public issue** for a vulnerability, and do not post it in a discussion.
- **Do not paste a real credential**, even to prove the point. A reference such as `pass:example` and the command that
  would have read it say everything.
- **Include what you can:** the tag, the Pi and Node versions, the tool call or configuration, what Jig decided, and what
  happened instead.

## What is in scope

- **A call runs when it should not:** a classified write that was allowed in production, a rule that can be lowered by
  configuration, or a call that runs after the decision failed.
- **A secret reaches the model:** a value that survives redaction in a result, a record line, a session file, a preview, a
  log line or a review page.
- **Masking can be skipped**, or personal data reaches a result from a production environment.
- **The sandbox can be escaped** by the agent's `bash`: a credential path it can read, a file it can write outside the
  working folders, or a process it can reach.
- **Approval can be forged:** a review approved without a passkey signature, or a second endpoint that approves.
- **A path is not protected** that should be: Pi's agent folder, the secret stores, or a file that runs code unsandboxed at
  the next start, including a project's `.pi` settings, skills, prompts, themes, extensions, packages and system files,
  guarded by path and refused for `write` and `edit`.
- **The harness is fooled about what it recorded:** a call missing from the records, or recorded with another decision.

## What is not in scope

- **A plugin you chose to install.** Pi packages run as extensions with your rights; installing one is trusting it. Jig
  governs the tools, not the plugin's own code.
- **Doing what you approved.** A call you allowed in the screen is the system working.
- **A company plugin's own code.** Report it to that company; this repository holds none of it.
- **Pi, or another package, having a vulnerability of its own.** Report it to them. Tell us if Jig's handling makes it
  worse.
- **A model producing bad advice.** That is a quality problem, not a security one, and it belongs in an issue.

## What happens next

1. **We acknowledge** the advisory, usually within a week, and say whether it is in scope.
2. **We work on a fix** in a branch, with a test that fails before it and an entry in [Decisions](docs/decisions.md) when
   the design changes.
3. **The fix ships in a patch release**, and the advisory is published with the versions affected.
4. **We credit you** in the advisory, unless you would rather we did not.

There is no bug bounty. This is a harness one person maintains, and a clear report is paid in a fixed release and a
thank-you.

Back to [Contributing](CONTRIBUTING.md).
