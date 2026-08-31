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
| [`docs/codex-archive.md`](docs/codex-archive.md)           | What `recall_codex` reads, what it never reads, what it writes, and how it fails                               |
| [`docs/skills/mochi-persona/`](docs/skills/mochi-persona/) | A skill for Claude Code or Codex, so an agent can interview you and write the character file                   |

## What she can do

Four tools, and each is a switch you can turn off in **What she may do**:

- **`ask_workspace`** — press `⌃⇧K` and ask. She reads one folder you point her
  at and, when the question needs it, the web, then answers in her own words.
  Read-only: she cannot change a file. This is the one thing the official
  ChatGPT desktop app cannot do for you, and it is why the Codex CLI is a
  requirement rather than a burden.
- **`remember_this`** — write a fact into her long-term note.
- **`recall_conversations`** — search what you have actually said to her.
- **`recall_codex`** — search what you have already said to **Codex** on this
  machine. **Off until you turn it on**, and read-only. See
  [Reading your Codex history](#reading-your-codex-history) below, and
  [`docs/codex-archive.md`](docs/codex-archive.md) for the whole boundary.

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

## Reading your Codex history

If you use the Codex CLI, this machine already holds thousands of conversations
you have had with it — what you asked, what it answered, and which repository
you were in. `recall_codex` lets her search them.

**It is off until you turn it on.** The other three switches govern things Mochi
does with its own state; this one governs reading **another application's**
archive of everything you have worked on, and a permission that arrives already
granted is not a decision anybody made.

The rest of this is the honest version of four things, and it belongs beside the
ten-day token warning above because it is the same kind of fact.

**It is borrowing, not remembering.** The opening paragraph of this README says
what she remembers is a note you can read, edit and delete. That stays true of
her note, and it is **not** true of this: the Codex archive is uncurated, nobody
wrote it for her, and you cannot edit it through Mochi. What you can do is switch
it off — and switching it off deletes Mochi's copy rather than merely hiding it.
Everything she quotes from it is attributed out loud: when it was, which
repository it was in, and whether it was you or Codex who said it.

**Reading it creates one file.** Mochi opens Codex's databases read-only and
never writes to them. SQLite itself may still create a `state_5.sqlite-shm`
beside them — a shared-memory index it manages and Codex recreates at will. So
"we touch nothing" would be false, and this says so instead. Mochi's own copy
lives under `codex-index/` in its own folder, and holds a mirror of that text
until you revoke the switch. **It is not small**: on the machine this was built
against, 9,381 conversations produce about **112 MB**, because the searchable
copy is stored twice — once readable and once tokenised. It is deleted when you
turn the switch off.

**Command output is never read, and known keys are masked.** What is indexed is
what was _said_ — your messages and Codex's replies. Everything Codex ran and
everything it printed is excluded at the query, which is where credentials
actually live: measured on one real archive, one key-shaped string in what is
indexed against sixteen in what is not. On top of that, known token and key
forms (OpenAI `sk-…` keys including `sk-proj-`, every documented GitHub token
prefix, AWS `AKIA…`/`ASIA…` ids, PEM key blocks, and values assigned to
well-known secret variable names) are masked out of anything she
is handed. **That is a reduction, not a guarantee** — a password written as a
sentence, or a token in a shape nobody has seen yet, will pass. A recall result
is sent to OpenAI as part of the conversation, so this matters, and it is part
of why the switch ships off.

**It will break when Codex changes, and it will say so.** Mochi checks that the
two database files are the ones it knows how to read, by name and by the shape
of every column it touches. When Codex moves — a new schema generation, a
renamed column — she says she cannot look, rather than going quiet or answering
from a stale copy. "I could not look" and "I looked and there was nothing" are
different sentences and she has both.

## Where your things are

Everything is on your machine, under `~/Library/Application Support/Mochi`:

|                         |                                                                                                                                                 |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `transcripts.db`        | Conversations, if you keep them. Deletable one at a time or all at once — and deletes are real: `secure_delete` plus a WAL checkpoint           |
| `memory/<id>.json`      | Her note about you, one file per character, editable by hand                                                                                    |
| `personas/`, `avatars/` | Characters and faces. A face is plain JSON — no code                                                                                            |
| `grants/`, `policies/`  | What she may do, and what is kept                                                                                                               |
| `codex-index/`          | Mochi's searchable copy of your Codex history, if you turned that switch on. About 112 MB for 9,381 conversations. Deleted when you turn it off |

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
