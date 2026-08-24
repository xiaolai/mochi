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
