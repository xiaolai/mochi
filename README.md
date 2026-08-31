# Mochi

A small companion who lives on your desktop and talks back.

She sits above your other windows without taking the Dock or stealing focus. A
keystroke wakes her, you talk, and she answers out loud — you can interrupt her
mid-sentence, the way you would interrupt anybody. What she remembers is a note
you can read, edit and delete, not something accumulating invisibly in a context
window.

---

## Install

```sh
brew install --cask xiaolai/tap/mochi
```

**The `xiaolai/tap/` prefix is not optional.** Homebrew's own cask index already
carries a `mochi` — a flashcards app from mochi.cards — so a bare
`brew install --cask mochi` fetches that one instead, and succeeds while doing
it. There is no error to notice.

Or take the disk image from the
[latest release](https://github.com/xiaolai/mochi/releases/latest):
`Mochi-<version>-arm64.dmg` for Apple Silicon, `Mochi-<version>-x64.dmg` for
Intel.

Either way it arrives signed, notarized and stapled — the app and both disk
images. That is what lets it open on a machine that did not build it; without a
notarization ticket macOS says _"Mochi is damaged and can't be opened"_, which
is Gatekeeper's phrasing for unnotarized rather than a real diagnosis.

### Updating

She checks for updates from **About Mochi**, and installs them herself. Through
Homebrew, the ordinary commands do the right thing:

```sh
brew upgrade                              # safe — leaves her alone
brew upgrade --cask --greedy              # safe
brew upgrade --cask xiaolai/tap/mochi     # safe — the prefix resolves to her
```

**The one command never to run is `brew upgrade --cask mochi`.** Homebrew keys
the Caskroom by bare token, so once she is installed she and the flashcards app
are one entry to it: without the prefix it resolves the token to mochi.cards and
offers `0.1.9 -> 26.8.2`. That is a different program replacing this one, not an
update — and `brew outdated` does not list it, so nothing warns you first.

All four of those were measured with `--dry-run` on 2026-08-31, not reasoned
about. Only the fourth is dangerous; the blanket upgrade most people actually
run is not, which is why this is a footnote rather than a reason to rename her.

One exception, permanent: **0.1.8's update button is broken.** `electron-updater`
hides its `autoUpdater` behind `.default` under CommonJS interop, so the app
destructured `undefined` and the button threw. It is fixed from 0.1.9 onward,
but a fix for the update mechanism cannot be delivered by the mechanism it
fixes. If you are on 0.1.8, cross the gap once with `brew upgrade` or the disk
image above, and it works from then on.

---

## What you need

Mochi is built for people who already pay for ChatGPT. It has no server of its
own and no API key of its own.

|                                                                 |                                                                                 |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| **A ChatGPT subscription**                                      | The realtime voice session runs on it                                           |
| **The [Codex CLI](https://github.com/openai/codex), signed in** | Mochi borrows its credential from `~/.codex/auth.json` (or `$CODEX_HOME`)       |
| **macOS**                                                       | Apple Silicon or Intel. Windows has run once; that is not the same as supported |

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

## Licence

Not yet chosen.
