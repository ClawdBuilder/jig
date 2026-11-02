# Secrets

Tools that need a password or token name it with a **reference**.
`jig-core` resolves the reference just before the tool runs. The value never
appears in:
- what the model sees;
- tool output;
- records or logs;
- command lines.

## References and backends

| Reference | Backend | Platforms | Status |
|---|---|---|---|
| `pass:work/jira-token` | [pass](https://www.passwordstore.org/), GPG-encrypted files | Linux, macOS (Homebrew) | built; on by default |
| `keychain:service/account` | macOS Keychain, through the `security` command | macOS | built; turn on in `secrets.backends` |
| `op://vault/item/field` | 1Password CLI | Linux, macOS, Windows | built; turn on in `secrets.backends` |
| `env:NAME` | an environment variable of the Pi process | any | built; turn on in `secrets.backends` |
| `cmd:gh` | a command you declared by name, such as `gh auth token` | any | built; turn on in `secrets.backends`, declare in `secrets.commands` |
| `file:~/.config/tool/token` | the first line of a file | any | built; turn on in `secrets.backends` |

All six are built, and `secrets.backends` says which may resolve a reference
(`pass` alone by default). A new machine or employer means setting a different
reference, not changing tools.

A company plugin can turn a backend on for its own references
(`config.enableSecretBackends`), and `secrets.disabledBackends` turns any off
again: you keep the last word. `/jig` lists the backends that are on and who
turned them on.

**Jig will not build its own password manager.** A homemade password store is a
security liability, and every platform already has one with a command-line
interface. **Nor does it sign in:** the tool that owns a login does it, and
`cmd:gh` reads the token `gh auth token` prints, so Jig keeps none of its own
(see [Decisions](decisions.md)).

## Where pass looks

`pass` is a program, so `jig-core` tells it where its store and its GnuPG keys are. Each folder comes
from the first of these that is set:
1. **`jig.json`:** `secrets.pass.storeDir` and `secrets.pass.gnupgHome`, each an absolute path or `~/...`;
2. **Pi's environment:** `PASSWORD_STORE_DIR` and `GNUPGHOME`;
3. **`pass`'s own defaults:** `~/.password-store` and `~/.gnupg`.

```json
{
  "secrets": {
    "pass": { "storeDir": "~/vault/pass-store", "gnupgHome": "~/vault/gnupg" }
  }
}
```

Binding the folders in `jig.json` means the store does not depend on how Pi was started: from a
terminal, a launcher or a desktop shortcut. The two settings are independent, and each wins over the
environment on its own.

**These folders are protected without further setting.**
- The two folders in `secrets.pass`.
- Every credential folder that an environment variable moves: `PASSWORD_STORE_DIR`, `GNUPGHOME`,
  `AWS_CONFIG_FILE`, `AWS_SHARED_CREDENTIALS_FILE`, `KUBECONFIG`, `GH_CONFIG_DIR`, `GLAB_CONFIG_DIR`,
  `CLOUDSDK_CONFIG` and `DOCKER_CONFIG`.

Pi's file tools refuse them, and `jig-sandbox` hides them from `bash`
([the list](permissions.md#protected-paths)). `/jig` shows the folders `secrets.pass` binds, as paths.

## Rules

- **Only through `jig-core`:** a tool gets a secret by naming its reference.
  It never reads a password file itself.
- **Unlock once:** a locked store asks you to unlock it once, even when several
  calls need it at the same moment.
- **Remove on sight:** every resolved value is removed from all output before
  the model sees it.
- **Hidden from `bash`:** the secret stores themselves are hidden from the
  agent's shell by the sandbox.
- **Your own tools only:** tools from other packages keep their own credentials.
  `jig-core` can mask and record their calls, but not manage their secrets.

## Sign-in that a company provides

Some systems are not signed in to with a stored password. A single sign-on
gateway hands out a short-lived token that code has to fetch and renew. A
company plugin supplies that code as a **sign-in service**, and a tool asks for
the headers of one request by the service's name instead of naming a secret
reference.

The headers are treated like secrets: `jig-core` removes their values from
every result before the model sees it. See
[Sign-in services](../plugins/jig-core/docs/sign-in-and-transports.md#sign-in-services).

A request names a reference, a sign-in service or a transport in `auth`, and
`jig-core` attaches the credential, so a plugin never sees it (see
[Credential sources](../plugins/jig-core/docs/sign-in-and-transports.md)).
