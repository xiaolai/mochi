# Mochi

A small companion who lives on your desktop and talks back.

She sits above your other windows without taking the Dock or stealing focus. A
keystroke wakes her, you talk, and she answers out loud — you can interrupt her
mid-sentence, the way you would interrupt anybody. What she remembers is a note
you can read, edit and delete, not something accumulating invisibly in a context
window.

**Status: 0.1.3, and nothing is published yet.** You can run it from source
today, and `.github/workflows/release.yml` will build, sign, notarize and
publish a `v*` tag once the Apple credentials are in the repository's secrets.
See [Building](#building) for what is and is not wired.

---

## What you need

Mochi is built for people who already pay for ChatGPT. It has no server of its
own and no API key of its own.

|                                                                 |                                                                           |
| --------------------------------------------------------------- | ------------------------------------------------------------------------- |
| **A ChatGPT subscription**                                      | The realtime voice session runs on it                                     |
| **The [Codex CLI](https://github.com/openai/codex), signed in** | Mochi borrows its credential from `~/.codex/auth.json` (or `$CODEX_HOME`) |
| **macOS**                                                       | Windows cross-builds and installs; Linux is configured but unexercised    |
| **Node 24+, pnpm 10+**                                          | To build                                                                  |

There is deliberately **no API-key path**. One credential source, and it is
Codex.

### The one thing that will bite you

That stored token has a lifetime of about **ten days**, and nothing refreshes it
except running `codex` yourself. A machine nobody has opened Codex on for a
fortnight has a credential that fails the moment she tries to speak.

Mochi checks for this at startup rather than at her first word, and tells you
which of the four states you are in — no CLI, no login, a token that expired, or
one the service refused. The remedy is almost always:

```sh
codex        # once, to refresh the login
```

## Guides

|                                                            |                                                                                                                |
| ---------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| [`docs/personas.md`](docs/personas.md)                     | Making a character — the whole `persona.json` format, what each field actually changes, and what will bite you |
| [`docs/realtime-api.md`](docs/realtime-api.md)             | What the OpenAI Realtime API exposes, which parts Mochi sends, and where the walls are                         |
| [`docs/skills/mochi-persona/`](docs/skills/mochi-persona/) | A skill for Claude Code or Codex, so an agent can interview you and write the character file                   |

## What she can do

Three tools, and each is a switch you can turn off in **What she may do**:

- **`ask_workspace`** — press `⌃⇧K` and ask. She reads one folder you point her
  at and, when the question needs it, the web, then answers in her own words.
  Read-only: she cannot change a file. This is the one thing the official
  ChatGPT desktop app cannot do for you, and it is why the Codex CLI is a
  requirement rather than a burden.
- **`remember_this`** — write a fact into her long-term note.
- **`recall_conversations`** — search what you have actually said to her.

Her note is also rewritten for her when she goes to sleep, from the presence
that just ended. That runs on the same Codex subscription, so remembering you
does not sit behind a second paywall.

## What she can reach, and what she cannot

Both the workspace lookup and the sleep-time note rewriter run `codex exec` with
`-s read-only`. **That names what the sandbox may write, not what it may read** —
measured, `dev-docs/findings.md` §72 — and no Codex setting withholds the shell
from a run. So a model that decides to read a file elsewhere on your disk can.

Two consequences worth knowing before you point her at anything:

- **Treat the workspace as code you trust.** `ask_workspace` reads it, and a file
  in it can carry text addressed to the model rather than to you.
- **The note rewriter runs with your Codex configuration ignored**
  (`--ignore-user-config`), so any MCP servers you have configured are not
  started by it. The lookup does load your configuration, deliberately — a
  profile is how you give a lookup extra tools.

What stands between a hostile string and her long-term note: the conversation is
fenced and the model is told the fence contains data, the answer must fit a
closed schema, and any entry containing a path, a URL or shell syntax is thrown
away. Her note is a plain file you can read, edit and revert one version.

## Where your things are

Everything is on your machine, under `~/Library/Application Support/Mochi`:

|                         |                                                                                                                                       |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `transcripts.db`        | Conversations, if you keep them. Deletable one at a time or all at once — and deletes are real: `secure_delete` plus a WAL checkpoint |
| `memory/<id>.json`      | Her note about you, one file per character, editable by hand                                                                          |
| `personas/`, `avatars/` | Characters and faces. A face is plain JSON — no code                                                                                  |
| `grants/`, `policies/`  | What she may do, and what is kept                                                                                                     |

Nothing is uploaded anywhere except to OpenAI, as part of the conversation you
are having.

## More than one of her

A character is her name, her voice, her colour, what she calls you, the prompt
that makes her who she is, and what she says arriving and leaving. Switch from
the tray and she is somebody else. Each one has her own memory, her own
conversations and her own retention setting, and deleting her takes all three
with her.

## Building

```sh
pnpm install
pnpm dev          # run it
pnpm verify       # format, lint, typecheck, tests — the gate
pnpm dist:mac     # a signed .app and .dmg
```

`pnpm dist` runs `verify` first and will not build over a red gate.

**Signing and notarization.** Signing is wired and takes the Developer ID
certificate from your keychain, so `pnpm dist:mac` gives you a build that opens
on the machine that made it.

**You do not have to notarize anything to use Mochi yourself.** Notarization is
what lets somebody _else_ open your build — without it they get _"Mochi is
damaged and can't be opened"_, which is Gatekeeper's phrasing for unnotarized
rather than a real diagnosis. Publishing is the release workflow's job: push a
`v*` tag and it signs, notarizes and staples the app and both disk images, and
refuses to publish if the check below disagrees.

`pnpm verify:signing` reads what is actually in `release/` — Developer ID
authority, hardened runtime, a secure timestamp, no `get-task-allow`, a stapled
ticket, and Gatekeeper's own verdict — refuses a build older than the source, and
exits non-zero. It is written for a build you intend to hand to somebody, so it
will fail on an ordinary local one for the single reason that it carries no
notarization ticket. That is the expected answer, not a broken build.

## Licence

Not yet chosen.
