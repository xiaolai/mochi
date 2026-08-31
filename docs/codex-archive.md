# Reading your Codex history

What `recall_codex` reads, what it never reads, what it writes, and how it
fails. This is the boundary in full; the README has the short version.

**It is off until you turn it on**, in **What she may do**. Nothing described
here happens until you do.

---

## What it is

The Codex CLI keeps every conversation you have had with it in two SQLite
databases under `$CODEX_HOME` — `~/.codex` unless you have moved it. On the
machine this was built against that is **9,349 conversations**: what you asked,
what Codex answered, and which repository you were in at the time.

`recall_codex` gives Mochi a searchable copy of the _spoken_ part of that, so
she can answer "what did we decide about the fonts" from something you actually
said rather than from a guess.

It is a **separate switch from `recall_conversations`**, and deliberately so.
That one searches what you and she said to each other; this one searches what
you and a tool said to each other. Merging them would have made where an answer
came from a field she can drop rather than a permission you chose.

## What is read

| source                                     | what it gives                                                    | coverage               |
| ------------------------------------------ | ---------------------------------------------------------------- | ---------------------- |
| `state_5.sqlite` → `threads`               | the opening of each conversation, and which repository it was in | **every** conversation |
| `thread_history_1.sqlite` → `thread_items` | the turn-by-turn messages                                        | about **18%** of them  |

The second table is the richer one and it is not the primary one: Codex only
projects turn-by-turn rows for conversations in its newer `paginated` history
mode, so 82% of conversations have no message rows at all. The header row is
where the rest lives — including, on the machine this was measured on, the one
voice conversation the feature was built to find.

A hit therefore says **which of the two it came from**, because they support
different claims:

| `source`  | what it means                                                                                                   |
| --------- | --------------------------------------------------------------------------------------------------------------- |
| `said`    | a turn that was actually taken, in order                                                                        |
| `opening` | how a conversation began                                                                                        |
| `pasted`  | a document pasted into the opening field — 4,411 of 9,093 are over 2,000 characters, and the longest is 148,357 |

She is told never to present a pasted document as something you said.

## What is never read

- **Everything Codex ran, and everything it printed.** `commandExecution` is
  22,473 rows and **408 MB** — 95% of the file — and it is where credential
  material lives: shell output, environment dumps, `.env` reads, token echoes.
  It is excluded in the query, so those pages are never read into the process at
  all.
- **Reasoning blocks**, which are opaque.
- **The rollout files.** `~/.codex/sessions/**.jsonl` is 5.1 GB of append-only
  ground truth that Codex projects the databases _from_. Reading it would mean
  re-implementing that projection to obtain what Codex has already extracted.
- **Three files in `~/.codex` that could not be traced to OpenAI** —
  `realtime-voice-continuity.json`, `transcription-history.jsonl` and
  `dictation-history/`. The first is the most convenient shape of anything in
  that directory, which is exactly why nothing is built on it.

## Whose speech is whose

There are three parties in this archive and one of them is a tool, so a hit
carries one of three attributions rather than two:

| `who`     | who it was                                                                                        |
| --------- | ------------------------------------------------------------------------------------------------- |
| `them`    | you                                                                                               |
| `codex`   | Codex                                                                                             |
| `unknown` | genuinely not attributable — she says "somewhere in that conversation" rather than naming anybody |

`unknown` is not a gap that should be filled. It covers a sub-agent's opening
message (written by another agent, not by you) and the unlabelled half of the
voice-delegation encoding, where guessing would put a tool's words in your
mouth. Voice gives a listener no citation to check, so a wrong attribution is
not correctable by the person hearing it.

## What it writes

**Nothing to Codex's databases.** They are opened with `SQLITE_OPEN_READONLY`.

**One file that is not nothing.** SQLite may create a `-shm` beside a database
it opens — a shared-memory index it manages itself, which Codex creates and
recreates at will. Read-only stops writes to the _database_; it does not stop
that. The risk is very low and it is not zero, and saying "we touch nothing"
would be false.

**Mochi's own copy**, under `codex-index/` in Mochi's own folder. It holds the
indexed text so a search can be answered without going back to Codex's files
every time — **about 112 MB** for the 9,381 conversations measured here, because
the text is stored twice: once readable, so she can quote it back to you, and
once tokenised, so it can be searched in Chinese as well as English. **Revoking the switch deletes it** — with `secure_delete` and a
write-ahead-log checkpoint, the same treatment `transcripts.db` gets, because
this is somebody's history and "off" has to mean the bytes are gone.

## What is masked, and what is not

Excluding command output removes the bulk source of credential material rather
than the class of it. Measured on one real archive:

|                                            | indexed | excluded |
| ------------------------------------------ | ------- | -------- |
| key-shaped strings (`sk-` + 20 characters) | **1**   | **16**   |

On top of that, a conservative mask runs over everything she is handed, covering
high-confidence forms only: OpenAI `sk-` keys (including the hyphenated
`sk-proj-` and `sk-svcacct-` shapes), every documented GitHub prefix — `ghp_`,
`gho_`, `ghu_`, `ghs_`, `ghr_` and the fine-grained `github_pat_` — AWS
`AKIA`/`ASIA` access key ids, PEM key blocks including their body, and values
assigned to a short list of well-known secret variable names, which is the only
way to catch a credential that has no shape of its own.

**This is a reduction, not a guarantee.** A password written as a sentence, a
token with a private prefix, a key in a format invented next year — all pass.
The mask is narrow on purpose: a mask that mangled `risk-based-authentication`
would make her quote your own words back to you wrongly, with no way for you to
notice.

Why it matters that this is masked at all rather than merely spoken quietly: a
capability result is sent to OpenAI's Realtime service as part of the
conversation. It does not stay on the machine.

## How it fails

Three failures, and each has its own answer.

**Codex moves.** The filenames carry a schema generation — `state_5`,
`thread_history_1` — bumped by hand upstream. Mochi refuses a _higher_
generation sitting beside the one it knows, and it verifies that every column it
reads still exists with the type it reads it as. Both produce "I could not
look", never silence and never an answer from a stale copy.

**The archive is rebuilt or corrupt.** Codex treats these databases as
disposable — it exports its own corruption handling and rebuilds this projection
from rollouts. So an archive that is empty, partial or replaced is an ordinary
state of the world, and "I could not look" is a first-class answer rather than
an error path.

**The index is still building.** The first build reads the whole archive and
takes seconds, so it runs in the background when you grant the switch, never on
startup. While it runs the tool is simply **not offered** — which, to every
layer that matters, is the same as a permission not yet given, and she already
has a sentence for that.

In all three cases the distinction she keeps is the one that matters: _"I looked
and there was nothing"_ and _"I could not look"_ are different sentences, and
she is never handed a shape that makes her choose between them at random.

## What it costs

Measured on the archive described above:

|                           |                                  |
| ------------------------- | -------------------------------- |
| first build               | seconds, in the background, once |
| deciding what has changed | tens of milliseconds             |
| answering a search        | 4–15 ms                          |

Refreshes are not a re-read. Codex maintains its own per-conversation cursor
saying how far it has projected each one; Mochi compares four numbers per
conversation against it and reads only what moved. Conversations you delete in
Codex are removed from Mochi's copy on the same pass — an index that kept them
would be her remembering something you told Codex to forget.

## The method

`dev-docs/research-codex-archive.md` carries every measurement quoted here with
the command that produced it, and `dev-docs/plan-recall-codex.md` carries the
design and the two rounds of adversarial review that changed it. Both live in
the working tree rather than in the published package.
