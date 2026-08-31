---
name: mochi-persona
description: Create a character (persona) for the Mochi desktop voice companion — interview the user about who she should be, then write a valid persona.json into their Mochi personas folder. Use when the user wants to make, design, add or edit a Mochi character or persona, mentions persona.json, or asks for a new Mochi voice/personality.
---

# Making a Mochi character

Mochi is a desktop voice companion. A **character** is a folder holding one
`persona.json`. Your job is to find out who the user wants, then write that file
correctly. The full human-facing reference is `docs/personas.md` in the mochi
repository; this file is the executable version of it.

## Where it goes

```
~/Library/Application Support/Mochi/personas/<id>/persona.json
```

**Never overwrite an existing folder.** A persona folder holds the only copy of a
character somebody made. If `<id>` exists, stop and ask — offer a different id,
or offer to edit the existing file in place after showing them what is in it.

Create the folder if the parent exists. If `~/Library/Application Support/Mochi/`
does not exist, Mochi has never been run; say so rather than creating a
half-populated directory for another application.

## Interview first, write second

Do not ask for the fields. Ask about the character, then choose the fields
yourself and show the user what you picked. Four questions is usually enough:

1. **Who is she?** A sentence or two. This becomes `style` and it is the only
   field that really matters.
2. **What should she call you?** Often nothing, which is a real answer.
3. **How should she sound?** Map their answer onto a voice; do not read them the
   list of ten.
4. **Should she show her words on screen?** Off is the default, and the better
   default — a bubble is words over somebody's desktop.

Infer the rest. Offer the finished file for approval before writing it.

If the user has already told you who she is in their first message, do not run
the interview at all. Write the file and show them.

## The schema

```json
{
  "version": 4,
  "id": "…",
  "name": "…",
  "addressUser": "",
  "pronoun": "she",
  "voice": "coral",
  "theme": "moss",
  "style": "…",
  "avatarId": null,
  "bubble": false,
  "bubbleSide": "auto",
  "size": null,
  "faces": ["neutral", "happy", "shy", "sad", "angry", "surprised", "thinking", "sleepy"],
  "greeting": { "instruction": "…", "verbatim": null },
  "farewell": { "instruction": "…", "verbatim": null }
}
```

**Copy that shape exactly — no comments, no trailing comma.** It is written as
plain JSON on purpose: an annotated template is a template somebody pastes the
annotations along with. The constraints live in the table instead.

| Field                  | Constraint                                                       |
| ---------------------- | ---------------------------------------------------------------- |
| `version`              | exactly `4`                                                      |
| `id`                   | `/^[a-z][a-z0-9-]{0,63}$/`, and the folder name                  |
| `name`                 | ≤60                                                              |
| `addressUser`          | ≤60; `""` is normal                                              |
| `pronoun`              | `she` \| `he` \| `it`                                            |
| `voice`                | one of the ten below                                             |
| `theme`                | one of the eight below                                           |
| `style`                | ≤4000 — the character                                            |
| `avatarId`             | `null` for the built-in face                                     |
| `bubble`               | `false` unless asked                                             |
| `bubbleSide`           | `auto` \| `above` \| `below` \| `left` \| `right`                |
| `size`                 | `null` for the default                                           |
| `faces`                | any subset of the eight below                                    |
| `greeting`, `farewell` | `instruction` and `verbatim` each ≤300; `verbatim` may be `null` |

**Enumerations — a value outside these makes the character fail to load.**

- `voice`: `alloy` `ash` `ballad` `coral` `echo` `sage` `shimmer` `verse` `cedar`
  `marin`. `cedar` and `marin` are the two recommended for realtime.
- `theme`: `moss` `sky` `mint` `sand` `clay` `blossom` `lilac` `slate`
- `pronoun`: `she` `he` `it` (`they` is retired — do not write it)
- `faces`: any subset of `neutral` `happy` `shy` `sad` `angry` `surprised`
  `thinking` `sleepy`. Include all eight unless the user wants a character who
  genuinely never shows one.

## Rules that are not obvious

- **`id` must match `/^[a-z][a-z0-9-]{0,63}$/`** — a lowercase letter first, then
  letters, digits and hyphens, 64 characters at most. No underscores, no capitals,
  no leading digit. It also may not be a Windows device name (`con`, `prn`, `aux`,
  `nul`, `com1`–`com9`), which are refused whatever the extension.
- **`id` is permanent in practice.** It is the folder name _and_ the key her
  memory and conversations are filed under. Renaming it later orphans both. Pick
  a short lowercase slug and tell the user it is not the display name — `name`
  is, and that one changes freely.
- **`verbatim: null` is almost always right.** Fixed greeting words are the same
  words every morning, which stops reading as a companion. Use `instruction`
  alone unless the user explicitly wants exact words.
- **Write `style` for the ear.** She is spoken, never typed. No lists, no
  headings, no "Certainly!". Say what she _is_ rather than what to avoid — "warm,
  unhurried, a little playful" beats three sentences of prohibitions, which only
  spend her attention on a checklist.
- **Three sentences is a good length.** 4000 is a ceiling, not a target.
- **Do not invent fields.** Anything outside the schema above is not read, and a
  file with extra keys is a file whose author believed something false.

## Before writing, check

- `version` is `4`
- every enumerated value is spelled from the lists above
- `id` matches the folder name you are about to create, and that folder does not
  already exist
- every length is under its limit — `style` 4000, `name`/`addressUser` 60, `id`
  64, each `instruction`/`verbatim` 300
- the JSON parses

## After writing

Tell the user:

- the path you wrote
- that she appears in the rail on Mochi's next launch, and that an edit to the
  file lands on her **next wake** rather than immediately
- that the voice locks after her first audio, so a later voice change also takes
  effect on the next wake — the file is not wrong

Then show them the `style` you wrote, because that is the part they will want to
change.
