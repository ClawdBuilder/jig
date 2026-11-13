# jig-acme: an example company plugin

**Status: example, built.** Tested against fakes with the real `jig-core` and every built Jig plugin loaded into a fake Pi. Acme
Corp is made up; nothing here has been tried against a real Jira, log cluster, database or bastion.

`jig-acme` is what a company adds to Jig so that the generic plugins work at that company. It proves the generic plugins need no
company code, and it is a template: copy it, rename it and replace the values. It uses only Jig's public contract, through the
global handle, and adds no behaviour of its own to any tool.

For example, with this plugin loaded, a user who writes one line gets a working Jira, logs, databases and a deploy catalog:

```json
{ "acme": { "bastion": { "user": "jdoe" } } }
```

![The files of jig-acme, each making one call on jig-core's global handle withJig, and what Jig reads: environments, a sign-in, masking and a status line](../../docs/img/acme-seams.svg)

*One file per seam. Each file calls one thing on `jig-core`'s global handle, and something in Jig reads the result. The files
are in [The parts](#the-parts): configuration and knowledge, with an overlay skill the agent reads beside the generic one.*

## The parts

| File | What it gives Jig | What a real company puts there |
|---|---|---|
| [`src/environments.ts`](src/environments.ts) | `dev` and `staging` (test), `prod` (production) | The names its tools and logs use, and which hold live customer data |
| [`src/defaults/`](src/defaults) | Defaults for nine plugins' sections: jira, logs, mongo, api, ops, memory, git, theme, sandbox | Where its systems are, and its conventions |
| [`src/secrets.ts`](src/secrets.ts) | The command `acme-sso`, which `cmd:acme-sso` runs, and the `cmd` backend turned on | The command-line tool that owns its login |
| [`src/signin.ts`](src/signin.ts) | The sign-in service `acme-sso`: a bearer header from a secret reference | Whatever its gateway wants: a token, an HMAC, a cloud signature |
| [`src/transport.ts`](src/transport.ts) | The transport `acme-gateway`: a request carried by a gateway on this machine | A sign-in proxy, a VPN gateway's API, a browser-session broker |
| [`src/tunnel.ts`](src/tunnel.ts) | The tunnel `acme-bastion`: `ssh -L`, a forward, with jig-core's port helpers | A jump host, a cloud port forward, a VPN client's command |
| [`src/masking.ts`](src/masking.ts) | Two field names for the masker: `memberAlias`, `loyaltyCardHolder` | The names that hold personal data in its own systems |
| [`src/protection.ts`](src/protection.ts) | One secret path: `~/.acme/credentials.json` | Where its own tools keep a login |
| [`src/status.ts`](src/status.ts) | Lines for `/jig`: the sign-in, transport and tunnel it adds, and what this user still has to set | What a user needs to see at a glance |
| [`src/onboarding.ts`](src/onboarding.ts) | What each Acme person must supply, in Acme's order and words: the SSO token's place, the bastion login, a proxy, the GitHub login | So `/jig setup` reads like Acme, not like a schema |
| [`overlays/jira.md`](overlays/jira.md) | The company's Jira conventions as an overlay: jig-core adds it to the generic `jira` skill as a section `## Acme rules`, so the model reads one skill | Its projects, fields, workflow and manners |
| [`skills/acme-releases`](skills/acme-releases/SKILL.md) | A skill with no generic counterpart, listed for the model only while the Acme profile is active | Rules for something only this company has |
| [`src/index.ts`](src/index.ts) | Registers the plugin as `jig-acme` (`profiles.register`), with its overlays and its own skill, and gives everything else through the view that returns | The name and the folder of overlays |
| [`src/config.ts`](src/config.ts) | The `acme` section of `jig.json`, for what only one person can say | The few per-person settings |
| [`src/hosts.ts`](src/hosts.ts) | The hosts the sign-in service and the transport serve, and no others | Its own hosts, so a credential never goes where somebody else chose |
| [`src/jig/`](src/jig) | The global handle, the port helpers and the contract's types | Copies of `client.ts` and `kit/ports.ts`, and the types from a checkout of Jig |

[`src/index.ts`](src/index.ts) calls each of them from one `withJig` callback, so it does not matter whether Pi loads this package
before `jig-core` or after it.

## Rules

- **Public contract only.** `src/jig/client.ts` is a copy of `jig-core`'s lookup, and `src/jig/ports.ts` of its port helpers,
  because a separate package cannot import its modules; a test fails when a copy differs. Types come from `contract.ts` with `import type`.
- **Configuration and knowledge, never a change to a tool.** A tool gets another site or another sign-in, not another behaviour.
- **No credential in the code.** A secret is a reference (`env:`, `pass:`, `cmd:`); a value pasted in its place is refused, and
  the message does not repeat it. The company's own tool owns the login.
- **The floor holds.** `prod` is read-only and masked whatever this plugin says, and a protected path can only be added.

## Profiles

`jig-acme` registers as `jig-acme`. With nothing else configured it is the only company, so it is active everywhere. A person who also
works for another company names when Acme applies, in `~/.jig/jig.json`:

```json
{
    "profiles": {
        "acme": { "plugin": "jig-acme", "when": { "folders": ["~/work/acme/**"], "remotes": ["github.com:acme-org/*"] } }
    }
}
```

Outside those folders and repositories, Acme is dormant: its environments, defaults and skills do not apply
([Profiles](../../plugins/jig-core/docs/profiles.md)). Its Jira rules are an overlay, not a second skill, so the model reads one `jira`
skill whichever company it works for. The tests for this are in [`test/profiles.test.ts`](test/profiles.test.ts).

## Configure

In `~/.jig/jig.json`. Everything is optional, and each plugin's own section is laid over the company's defaults, so a user
writes only what they change (see [Writing a company plugin](../../docs/company-plugin.md#how-your-jigjson-layers-over-the-defaults)).

| Field | Default | Meaning |
|---|---|---|
| `acme.sso.token` | `cmd:acme-sso` | The secret reference the sign-in service reads its token from |
| `acme.gateway.proxy` | `http://127.0.0.1:3128` | The gateway's address: plain http, on this machine only |
| `acme.bastion.host` | `bastion.acme.example` | The bastion host |
| `acme.bastion.user` | none | Your login on the bastion, which only you know. `/jig` says when it is missing |

The default token comes from the `acme` command, which needs the `cmd` secret backend, so jig-acme turns `cmd` on (with
`config.enableSecretBackends`) and a user adds nothing. A token kept in a variable needs `env`, which stays the user's to turn on.
A user who does not want `cmd` turns it off, and `/jig` lists the backends that are on and who enabled them:

```json
{
  "secrets": { "backends": ["pass", "env"], "disabledBackends": ["cmd"] },
  "acme": { "sso": { "token": "env:ACME_SSO_TOKEN" } }
}
```

## Copy it for a real company

1. **Copy the folder** to a repository of your own and rename `jig-acme` in `package.json`, the code and the skill. Keep the
   repository private.
2. **Replace the values** in `src/environments.ts` and `src/defaults/`, one plugin at a time. Delete the files you have no use for,
   and their lines in `src/index.ts`.
3. **Point `src/jig/types.ts` at Jig.** Here it is a relative path inside this repository; link a checkout of Jig next to yours (a
   `.jig` folder) and re-export from it, as [Writing a company plugin](../../docs/company-plugin.md#test-it-the-way-jig-acme-does) shows.
4. **Replace the sign-in, transport and tunnel** with the code your company needs, or delete them.
5. **Run the tests** and change them with the values. The tests name each rule they check.

## Layout

```text
jig-acme/
  package.json        the manifest: pi.extensions and pi.skills
  src/                index.ts and one small file per seam; defaults/ has one file per plugin; jig/ is the handle
  overlays/jira.md    the overlay for the generic jira skill
  skills/acme-releases/   a skill only this company has
  test/               the real plugins in a fake Pi, and fake servers and programs; support/ has the loaders
```

## More detail

- [Writing a company plugin](../../docs/company-plugin.md): what goes in one, the seams in order, layering, testing, keeping it private
- [Plugins](../../docs/plugins.md#what-a-company-plugin-supplies): what each generic plugin takes from a company plugin
- [Plugin contract](../../plugins/jig-core/docs/plugin-contract.md) and
  [credential sources](../../plugins/jig-core/docs/sign-in-and-transports.md): the calls this plugin makes
