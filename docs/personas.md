# Making a character

A character — a _persona_ — is who Mochi is when you talk to her: her name, her
voice, her colour, what she calls you, the prompt that makes her herself, and
what she says arriving and leaving. You can have as many as you like. Switching
from the tray makes her somebody else, and each one keeps her own memory, her own
conversations and her own retention setting.

There are three ways to make one, and they end in the same place:

1. **From the rail** — press **Duplicate** on a character you already have and
   edit it. Nothing to learn, and it cannot produce an invalid package.
2. **By hand** — write `persona.json` yourself. This page is the reference.
3. **By asking an agent** — see [Having Claude or Codex do
   it](#having-claude-or-codex-do-it) at the bottom.

---

## Where a character lives

```
~/Library/Application Support/Mochi/personas/<id>/persona.json
```

One folder per character, named by her `id`. The folder is the character; delete
it and she is gone, along with the memory and conversations filed under the same
id.

Mochi reads these on every wake, so an edit lands on her next session — no
restart. A file that fails to parse is reported in the window rather than
ignored, because a character that silently did not load presents as "the app
ignored my file", which is the least debuggable thing an application can do.

---

## The whole format

`"version": 4` is the current format. A worked example, complete and valid:

```json
{
  "version": 4,
  "id": "loki",
  "name": "Loki",
  "addressUser": "笑来",
  "pronoun": "she",
  "voice": "coral",
  "theme": "moss",
  "style": "You are a small green mochi who lives on the desktop as a companion. Warm, unhurried, a little playful. Never servile and never a chatbot.",
  "avatarId": "mine",
  "bubble": true,
  "bubbleSide": "left",
  "size": null,
  "faces": ["neutral", "happy", "shy", "sad", "angry", "surprised", "thinking", "sleepy"],
  "greeting": {
    "instruction": "as though they just came back",
    "verbatim": "Hi, I'm back, how's everything going?"
  },
  "farewell": { "instruction": "warm, not formal", "verbatim": null }
}
```

### Field by field

| Field         | Type                                              | Limit                      | What it actually changes                                                                                                                                                                  |
| ------------- | ------------------------------------------------- | -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `version`     | number                                            | must be `4`                | The format. An older one is migrated; a newer one is refused rather than guessed at                                                                                                       |
| `id`          | string                                            | `/^[a-z][a-z0-9-]{0,63}$/` | The folder name, and the key her memory and conversations are filed under. Lowercase letter first, then letters, digits and hyphens. **Effectively permanent** — changing it orphans both |
| `name`        | string                                            | 60                         | What she is called, in the rail and the masthead                                                                                                                                          |
| `addressUser` | string                                            | 60                         | What she calls _you_. Often left empty, which is a real answer                                                                                                                            |
| `pronoun`     | `she` \| `he` \| `it`                             | —                          | Used throughout the interface, not just in her speech. `they` is retired: still loads, no longer offered                                                                                  |
| `voice`       | see below                                         | —                          | The Realtime voice. **Locks after her first audio**, so a change takes effect on her next wake                                                                                            |
| `theme`       | see below                                         | —                          | Her colour. Appears on her face and the halo above it, and nowhere else in the window                                                                                                     |
| `style`       | string                                            | 4000                       | The prompt that makes her who she is. This is the field that matters most                                                                                                                 |
| `avatarId`    | string \| `null`                                  | —                          | Which face pack she wears. `null` means the built-in                                                                                                                                      |
| `bubble`      | boolean                                           | —                          | Whether her words are drawn beside her. **Off by default** — a bubble is words over somebody's desktop, and subtitling yourself by default decides that for them                          |
| `bubbleSide`  | `auto` \| `above` \| `below` \| `left` \| `right` | —                          | Where the bubble sits. `auto` picks a side that fits                                                                                                                                      |
| `size`        | number \| `null`                                  | —                          | How big she is drawn. `null` means the default                                                                                                                                            |
| `faces`       | array of emotions                                 | —                          | Which expressions she is _allowed_ to wear. Empty is legal; she falls back to `neutral`                                                                                                   |
| `greeting`    | moment                                            | —                          | What she says on waking                                                                                                                                                                   |
| `farewell`    | moment                                            | —                          | What she says on going to sleep                                                                                                                                                           |

**Voices** (10) — `alloy`, `ash`, `ballad`, `coral`, `echo`, `sage`, `shimmer`,
`verse`, `cedar`, `marin`. Every model accepts every voice, so no character can
break by choosing one. `cedar` and `marin` are marked as recommended for realtime
in the interface.

**Themes** (8) — `moss`, `sky`, `mint`, `sand`, `clay`, `blossom`, `lilac`,
`slate`.

**Emotions** (8) — `neutral`, `happy`, `shy`, `sad`, `angry`, `surprised`,
`thinking`, `sleepy`.

### Greeting and farewell

Each is an _instruction_ and, optionally, _verbatim_ words:

```json
"greeting": {
  "instruction": "as though they just came back",
  "verbatim": "Hi, I'm back, how's everything going?"
}
```

|               | Limit         |                                                 |
| ------------- | ------------- | ----------------------------------------------- |
| `instruction` | 300           | how to say it — shapes the turn                 |
| `verbatim`    | 300 or `null` | the exact words. `null` means let her phrase it |

`verbatim: null` is usually the better character. Fixed words are the same words
every single morning, and a companion who greets you identically forever stops
reading as a companion.

The greeting is sent as its own turn rather than folded into `style`, because she
has to speak **without having been spoken to** — there is no user turn for a
system prompt to shape an answer to. If she is not permitted to speak first, the
turn is never requested at all.

---

## Writing `style`, which is the part that matters

Everything else on this page is a value from a list. `style` is the character.

What it becomes: the persona text is assembled with her note about you and the
application's own rules into the `instructions` field of `session.update`, fresh
on every wake. So an edit lands on her next session, and so does an edit to her
memory note.

Things worth knowing before you write it:

- **She is spoken, not typed.** Text that reads well in a chat window — lists,
  headings, "Certainly! Here are three options" — sounds wrong out loud. Write
  for the ear.
- **Say what she is, not what she should avoid.** "Warm, unhurried, a little
  playful" produces a character. "Do not be robotic, do not be sycophantic, do
  not use bullet points" produces a model spending its attention on a checklist.
- **Length is not depth.** The default character is three sentences. The 4000
  ceiling is room for a genuinely different person, not a target.
- **She has tools, and she will use them.** If the character should look things
  up, say when — not how. The mechanics are the application's business.
- **Speaking _style_ comes from here; speaking _rate_ does not.** The Realtime
  API has a playback-speed control that this build does not send, and it would
  not be the same thing anyway.

---

## What will bite you

- **`id` is not a display name.** It is the folder, and the key her memory and
  transcripts are filed under. Renaming it later leaves both behind. Pick
  something short and permanent; change `name` freely instead. It must start with
  a lowercase letter, and it may not be a Windows device name (`con`, `prn`,
  `aux`, `nul`, `com1`–`com9`) — refused on every platform, so a character made on
  a Mac still opens on Windows.
- **A file from a newer Mochi is refused, not read.** `version` above the current
  format returns a single "update Mochi" problem rather than reading the file and
  silently dropping whatever the newer build added.
- **The voice locks after her first audio.** A voice change takes effect on her
  next wake. Nothing is wrong with the file.
- **`faces` restricts, it does not add.** Listing an expression her face pack
  does not draw gets you nothing; leaving one out genuinely withholds it —
  including from her waking animation.
- **An invalid file does not silently fall back.** It is reported, per package,
  by name. If a character did not appear, the window will tell you which file and
  why.
- **Editing while she is awake is fine.** The file is read on the next wake, so
  nothing is half-applied mid-conversation.

---

## Having Claude or Codex do it

`docs/skills/mochi-persona/` is a skill that interviews you about the character
you want and writes a valid `persona.json` into the right folder.

**Claude Code**

```sh
cp -R docs/skills/mochi-persona ~/.claude/skills/
```

Then ask for it by name, or just say _"make me a Mochi persona"_ — the skill's
description is what makes it trigger.

**Codex CLI**, and anything else that reads `AGENTS.md`-style instructions: point
the agent at `docs/skills/mochi-persona/SKILL.md` and ask it to follow that file.
It is written to be executable prose rather than to depend on a particular
harness — it names the schema, the enumerations, the limits and the one
irreversible field, and it validates before it writes.

The skill will not overwrite an existing character. That is deliberate: a
persona folder holds the only copy of who somebody made.
