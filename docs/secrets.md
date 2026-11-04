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
reference, not changing tools. A store that is not in the table works through
`cmd:` (see [Other stores](#other-stores)).

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

**Unlocking at start.** With `"unlockAtStart": true` in `secrets.pass`, `jig-core` has `pass` open one entry at session
start, in the background, so no passphrase prompt interrupts a task later. gpg-agent shows its own prompt; Jig never asks
for, sees or keeps the passphrase ([details](../plugins/jig-core/docs/configuration.md#at-session-start)).

## Other stores

`jig-core` depends on no password store: each backend is a program it runs. So any store with a
command line works through `cmd:`, with one declared command per secret. Turn `cmd` on in
`secrets.backends`, name the command in `secrets.commands`, and write the name in the reference:

```json
{
  "secrets": {
    "backends": ["pass", "cmd"],
    "commands": {
      "orders-db-password": ["vault", "kv", "get", "-field=password", "secret/orders/db"]
    }
  }
}
```

A tool then names the secret as `cmd:orders-db-password`. A command is the program and its
arguments as a list, run without a shell; the trimmed output is the secret
([`cmd` in detail](../plugins/jig-core/docs/configuration.md#cmd-a-command-that-owns-the-login)).

| Store | Command to declare | Note |
|---|---|---|
| gopass | `gopass show -o <path>` | `-o` prints the password alone |
| HashiCorp Vault | `vault kv get -field=password <path>` | |
| AWS Secrets Manager | `aws secretsmanager get-secret-value --secret-id <id> --query SecretString --output text` | |
| Azure Key Vault | `az keyvault secret show --vault-name <v> --name <n> --query value -o tsv` | |
| Linux Secret Service | `secret-tool lookup <attr> <value> ...` | |
| Bitwarden | `bw get password <item>` | Unlocking with `bw unlock` stays your job |

- **The command sees a short environment,** the one `cmd` passes on, without tokens. A variable that only
  Pi's environment holds is not there.
- **Windows Credential Manager has no backend.** No standard command prints a stored password, so there
  is nothing for `cmd:` to run.
- **A `.env` file is a last resort.** Read through `file:` or `env:`, it is plain text on disk. Prefer a
  store that encrypts.

**A team and its stores.** A company plugin's defaults name references, such as `pass:orders/api-token`.
To use your own store, replace that one field in your own `jig.json` with a reference to it, such as
`op://Private/orders/token` (with `op` in `secrets.backends`). Your section is laid over the company's
([how](company-plugin.md)), so no tool changes.

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

## No password entry in Jig

Jig never asks for, takes or stores a secret: not in a prompt, not in a panel, not in a command. You add a
secret with your own store's tool, in your own terminal, such as `pass insert work/jira-token`.

A password typed into Jig, or into a terminal program that Jig runs for you, passes through code that is
not the store's own. Jig keeps none of that code. What you give it is a reference, and `jig-core` reads
the value from your store when a request needs it.

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

## Later

`/jig doctor` and `/jig setup` share one read-only status for every reference in the effective settings,
saying **found**, **missing**, **locked** or **not checked**, never a value. Each store is asked for metadata
only:
- **`pass`:** the entry file exists.
- **`env`:** the variable is set in this Pi process; its value and length are not shown.
- **`file`:** the path is a regular, non-empty file; its mode is checked, and a file other users can read is
  a warning. The file is never read.
- **`keychain`:** `security find-generic-password -s <service> -a <account>`, without `-w` or `-g`.
- **`op`:** `op item list --vault <vault> --format json`, matched by item title. The field is not verified;
  `op item get` and `op read` are never run.
- **`cmd`:** the login tool's own status (`gh auth status --no-refresh`, `glab auth status`). Other commands
  are not checked, because checking them would mean reading what they print.

A missing one comes with the store's own command to add it, and setup offers **Check again**. Setup asks
where a credential is kept and builds the reference itself; a chosen store that was off is added to
`secrets.backends`, and `secrets.disabledBackends` is never written or removed. Still to come: a side panel.
