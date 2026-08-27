import type { ByPronoun } from '@shared/pronoun'

/**
 * What the settings panes say about her, kept apart from what they draw.
 *
 * Group NAMES are deliberately mixed in rather than kept apart: "Looking
 * things up" and "Keys" are the same words whoever is worn, and writing each
 * three times would put one word in three slots and invite somebody to change
 * one of them. `Pane.label` is therefore `string | ByPronoun`, and `label()`
 * is what reads either kind.
 */
/**
 * Every sentence in this window that is ABOUT her, one phrasing per pronoun.
 *
 * Group NAMES are deliberately mixed in with them rather than kept apart:
 * "Looking things up" and "Keys" are the same words whoever is worn, and
 * writing each three times would put one word in three slots and invite
 * somebody to change one of them. `Pane.label` is therefore `string |
 * ByPronoun`, and `label()` is what reads either kind -- which is the case
 * `pronoun.ts` describes and the reason that function exists.
 */
export const SAYS = {
  mayDo: { she: 'What she may do', he: 'What he may do', it: 'What it may do' },
  /*
    Says WHOSE answer this is.

    Permissions became per character in 2026-08 and this pane did not say so, so
    somebody withholding the workspace here would reasonably believe they had
    withheld it everywhere. The switches are the same; what changed is who they
    are about, and a pane that does not say that is a pane that misleads.
  */
  mayDoWhose: {
    she: 'These are for the character she is wearing. Each one has her own.',
    he: 'These are for the character he is wearing. Each one has his own.',
    it: 'These are for the character it is wearing. Each one has its own.',
  },
  atOnce: {
    she:
      'Turning one off takes effect at once, and she is told — she will say she can no longer ' +
      'do it rather than quietly failing. Speaking first is the exception: it is decided when ' +
      'she wakes, so that one applies from her next wake.',
    he:
      'Turning one off takes effect at once, and he is told — he will say he can no longer ' +
      'do it rather than quietly failing. Speaking first is the exception: it is decided when ' +
      'he wakes, so that one applies from his next wake.',
    it:
      'Turning one off takes effect at once, and it is told — it will say it can no longer ' +
      'do it rather than quietly failing. Speaking first is the exception: it is decided when ' +
      'it wakes, so that one applies from its next wake.',
  },
  told: {
    she: 'What she is told she can do',
    he: 'What he is told he can do',
    it: 'What it is told it can do',
  },
  noTools: {
    she: 'Nothing. She is offered no tools at all, which is a fault in this build.',
    he: 'Nothing. He is offered no tools at all, which is a fault in this build.',
    it: 'Nothing. It is offered no tools at all, which is a fault in this build.',
  },
  /*
    Where the words in this column come from, and that they are not fixed.

    Every description here is an entry in the prompt catalogue and has been
    rewritable the whole time -- but only from another group, under a title that
    does not obviously cover "what a tool is for". Somebody reading a
    description they disagree with had nothing on screen telling them it could
    be changed, which is `prompts.ts`'s own complaint about the state before
    that pane existed, one pane along.
  */
  /* The hint inside the empty workspace field. Unreachable in practice — the
     workspace always resolves to at least the default — and it keeps the box's
     edge while it is empty, which is what `:placeholder-shown` reads. */
  /* Under the keys, and it says what a reset actually does — deleting the
     stored answer rather than writing today's default in, so the key keeps
     tracking whatever later releases ship. */
  keysReset: {
    she:
      'Reset gives a key back to what the app ships, and keeps it there: it stops being a ' +
      'choice of yours rather than becoming a copy of today\u2019s answer. Both work while she ' +
      'is asleep.',
    he:
      'Reset gives a key back to what the app ships, and keeps it there: it stops being a ' +
      'choice of yours rather than becoming a copy of today\u2019s answer. Both work while he ' +
      'is asleep.',
    it:
      'Reset gives a key back to what the app ships, and keeps it there: it stops being a ' +
      'choice of yours rather than becoming a copy of today\u2019s answer. Both work while it ' +
      'is asleep.',
  },
  workspacePlaceholder: {
    she: 'a folder she may read',
    he: 'a folder he may read',
    it: 'a folder it may read',
  },
  /* Said after the folder panel, and it NAMES the folder: a picker that
     answered "Saved." alone would leave somebody checking the field to find out
     what they had just agreed to. */
  workspaceSaved: {
    she: 'Saved. She reads ',
    he: 'Saved. He reads ',
    it: 'Saved. It reads ',
  },
  toolWording: {
    she:
      'Not fixed. Every description here can be rewritten under "What she is told", and what ' +
      'you write is what she is sent.',
    he:
      'Not fixed. Every description here can be rewritten under "What he is told", and what ' +
      'you write is what he is sent.',
    it:
      'Not fixed. Every description here can be rewritten under "What it is told", and what ' +
      'you write is what it is sent.',
  },
  noCli: {
    she: 'The Codex CLI could not be found, so she cannot look anything up.',
    he: 'The Codex CLI could not be found, so he cannot look anything up.',
    it: 'The Codex CLI could not be found, so it cannot look anything up.',
  },
  noCliLong: {
    she:
      'The Codex CLI could not be found on this machine, so nothing here has anything to ' +
      'run. She says so out loud rather than answering from memory.',
    he:
      'The Codex CLI could not be found on this machine, so nothing here has anything to ' +
      'run. He says so out loud rather than answering from memory.',
    it:
      'The Codex CLI could not be found on this machine, so nothing here has anything to ' +
      'run. It says so out loud rather than answering from memory.',
  },
  halo: {
    she:
      'The ring over her head. Hiding it hides nothing you need: the menu bar item marks ' +
      'itself while the microphone is open, whatever this says and wherever she is, and macOS ' +
      'shows its own orange dot beside it that no application can turn off.',
    he:
      'The ring over his head. Hiding it hides nothing you need: the menu bar item marks ' +
      'itself while the microphone is open, whatever this says and wherever he is, and macOS ' +
      'shows its own orange dot beside it that no application can turn off.',
    it:
      'The ring over it. Hiding it hides nothing you need: the menu bar item marks itself ' +
      'while the microphone is open, whatever this says and wherever it is, and macOS shows ' +
      'its own orange dot beside it that no application can turn off.',
  },
  chipSwitch: {
    she: 'Show it while the pointer is on her',
    he: 'Show it while the pointer is on him',
    it: 'Show it while the pointer is on it',
  },
  chip: {
    she:
      'The little speech bubble at her shoulder, which opens her conversations. Turning it off ' +
      'closes no door: the same control sits inside her speech bubble whenever she has said ' +
      'something, and the menu bar opens the same window.',
    he:
      'The little speech bubble at his shoulder, which opens his conversations. Turning it off ' +
      'closes no door: the same control sits inside his speech bubble whenever he has said ' +
      'something, and the menu bar opens the same window.',
    it:
      'The little speech bubble at its shoulder, which opens its conversations. Turning it off ' +
      'closes no door: the same control sits inside its speech bubble whenever it has said ' +
      'something, and the menu bar opens the same window.',
  },
  rests: {
    she:
      'Resting closes the session and gives the microphone back, so nothing is connected while ' +
      'nobody is talking to her. She wakes from the menu bar, the key, or a click on her.',
    he:
      'Resting closes the session and gives the microphone back, so nothing is connected while ' +
      'nobody is talking to him. He wakes from the menu bar, the key, or a click on him.',
    it:
      'Resting closes the session and gives the microphone back, so nothing is connected while ' +
      'nobody is talking to it. It wakes from the menu bar, the key, or a click on it.',
  },
  kept: {
    she:
      'What she remembers and how long conversations are kept are per character, and live ' +
      'on the shelf with the character they belong to.',
    he:
      'What he remembers and how long conversations are kept are per character, and live ' +
      'on the shelf with the character they belong to.',
    it:
      'What it remembers and how long conversations are kept are per character, and live ' +
      'on the shelf with the character they belong to.',
  },
  everythingOf: {
    she: 'Everything of hers is under ',
    he: 'Everything of his is under ',
    it: 'Everything of its is under ',
  },
  whoSheIs: {
    she:
      'Who she is — her name, her voice, her face, her prompt, her bubble and what she ' +
      'remembers about you — is on the shelf, with the character it belongs to. This ' +
      'window holds only what is true whoever is worn.',
    he:
      'Who he is — his name, his voice, his face, his prompt, his bubble and what he ' +
      'remembers about you — is on the shelf, with the character it belongs to. This ' +
      'window holds only what is true whoever is worn.',
    it:
      'Who it is — its name, its voice, its face, its prompt, its bubble and what it ' +
      'remembers about you — is on the shelf, with the character it belongs to. This ' +
      'window holds only what is true whoever is worn.',
  },
} as const satisfies Readonly<Record<string, ByPronoun>>

/**
 * What each halo answer is called on screen.
 *
 * Here rather than in `HALO_WHEN`, because the store's list is the GRAMMAR — the
 * values main will accept — and these are words somebody reads. `?? one` in the
 * caller, so a value main starts offering before anybody writes a label for it
 * appears as itself rather than as a blank row.
 */
export const HALO_LABELS: Readonly<Record<string, string>> = {
  always: 'always',
  listening: 'only while the microphone is open',
  never: 'never',
}
