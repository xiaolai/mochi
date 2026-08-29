import type { ByPronoun } from '@shared/pronoun'

/**
 * What the shelf says about her, kept apart from what the shelf draws.
 *
 * The table is per-surface on purpose. The READER is already shared —
 * `pronoun.ts` owns `forPronoun` — so what lives here is only this pane's
 * wording, and a fourth pronoun still lands in one place. What it buys by
 * sitting in its own module is that `shelf.ts` can be read as a sequence of
 * sections without a hundred lines of prose between the imports and the first
 * one.
 */
/**
 * Every sentence on this pane that is ABOUT her, one phrasing per pronoun.
 *
 * Collected here rather than written at each site because that is what makes
 * them reviewable as a set: a translator, or anybody adding a fourth pronoun,
 * has one list to read instead of a dozen. Nothing that is not about her is
 * here -- "calls you", "on waking", "colour" are labels for fields and are the
 * same words whoever is worn.
 */
export const SAYS = {
  /* The system prompt box's hint, drawn while it is empty. */
  promptEmpty: {
    she: 'Empty. She is still told her character, what she remembers and what she can do — this is prose of your own, above all of it.',
    he: 'Empty. He is still told his character, what he remembers and what he can do — this is prose of your own, above all of it.',
    it: 'Empty. It is still told its character, what it remembers and what it can do — this is prose of your own, above all of it.',
  },
  /* The name field's hint. It shows for one keystroke when the name is cleared
     before `change` puts it back, which is the only time anybody sees it. */
  namePlaceholder: { she: 'her name', he: 'his name', it: 'its name' },
  /* The size section: its heading, its reading, and the way back. */
  sizeHeading: { she: 'Her size', he: 'His size', it: 'Its size' },
  sizeOwn: { she: 'Use her own size', he: 'Use his own size', it: 'Use its own size' },
  sizeAsFaceAsks: {
    she: 'as her face asks for',
    he: 'as his face asks for',
    it: 'as its face asks for',
  },
  sizeYours: {
    she: 'yours, not her face’s',
    he: 'yours, not his face’s',
    it: 'yours, not its face’s',
  },
  /* The tail of a mood tile's tooltip: "See happy" + this. A SUFFIX, which is
     the shape `everythingOf` already uses in the settings copy — the variable
     sits in the middle of the sentence and a slot mechanism for one string
     would be a second way of doing this. */
  seeMoodOn: { she: ' on her', he: ' on him', it: ' on it' },
  noFile: {
    she: 'the built-in, with no file of her own',
    he: 'the built-in, with no file of his own',
    it: 'the built-in, with no file of its own',
  },
  nextWake: {
    she: 'ten · a change is a reconnect, so it lands on her next wake',
    he: 'ten · a change is a reconnect, so it lands on his next wake',
    it: 'ten · a change is a reconnect, so it lands on its next wake',
  },
  bubbleWhen: {
    she: 'off by default · the switch lands on her next wake, a side moves them now',
    he: 'off by default · the switch lands on his next wake, a side moves them now',
    it: 'off by default · the switch lands on its next wake, a side moves them now',
  },
  keeps: {
    she: 'What she is told and what she says are written to this machine, and stay there until you delete them.',
    he: 'What he is told and what he says are written to this machine, and stay there until you delete them.',
    it: 'What it is told and what it says are written to this machine, and stay there until you delete them.',
  },
  keptAlready: {
    she: 'Turning this off stops NEW conversations being written. It does not delete the ones already here — the Archive is where those are removed.',
    he: 'Turning this off stops NEW conversations being written. It does not delete the ones already here — the Archive is where those are removed.',
    it: 'Turning this off stops NEW conversations being written. It does not delete the ones already here — the Archive is where those are removed.',
  },
  bubbleSide: {
    she: 'A side that will not fit is not honoured — dragged into a corner she puts her words wherever there is room.',
    he: 'A side that will not fit is not honoured — dragged into a corner he puts his words wherever there is room.',
    it: 'A side that will not fit is not honoured — dragged into a corner it puts its words wherever there is room.',
  },
  moods: {
    she: 'eight drawn · what she is told she has',
    he: 'eight drawn · what he is told he has',
    it: 'eight drawn · what it is told it has',
  },
  moodsHow: {
    she: 'Which expressions this character claims. Nothing changes her face on its own except falling asleep and waking up, so today this only decides what she is told about herself — and which tiles you can try below. The tool that let her choose was removed after 275 sessions in which she never used it.',
    he: 'Which expressions this character claims. Nothing changes his face on its own except falling asleep and waking up, so today this only decides what he is told about himself — and which tiles you can try below. The tool that let him choose was removed after 275 sessions in which he never used it.',
    it: 'Which expressions this character claims. Nothing changes its face on its own except falling asleep and waking up, so today this only decides what it is told about itself — and which tiles you can try below. The tool that let it choose was removed after 275 sessions in which it never used it.',
  },
  noMoods: {
    she: 'None left on. She will be told she has one face and cannot change it.',
    he: 'None left on. He will be told he has one face and cannot change it.',
    it: 'None left on. It will be told it has one face and cannot change it.',
  },
  colour: {
    she: 'eight themes · retints this window and her',
    he: 'eight themes · retints this window and him',
    it: 'eight themes · retints this window and it',
  },
  colourAuthored: {
    she: 'Her avatar file names its own five colours, so a theme would overwrite what somebody drew. Clear the file below to choose one.',
    he: 'His avatar file names its own five colours, so a theme would overwrite what somebody drew. Clear the file below to choose one.',
    it: 'Its avatar file names its own five colours, so a theme would overwrite what somebody drew. Clear the file below to choose one.',
  },
  /* Said when she names an avatar file that is not there. The swatches cannot
     be offered -- each one is HER at that colour and there is no her to draw --
     and eight built-in mochis in her place would be the substitution the dashed
     card next to them exists to refuse. */
  colourMissing: {
    she: 'Her avatar file is named but not there, so there is nothing to colour. Choose a file below, or clear it to wear the built-in.',
    he: 'His avatar file is named but not there, so there is nothing to colour. Choose a file below, or clear it to wear the built-in.',
    it: 'Its avatar file is named but not there, so there is nothing to colour. Choose a file below, or clear it to wear the built-in.',
  },
  whoSheIs: { she: 'Who she is', he: 'Who he is', it: 'What it is' },
  whoSheIsHint: {
    she: 'her manner, sent as the session instructions',
    he: 'his manner, sent as the session instructions',
    it: 'its manner, sent as the session instructions',
  },
  remembers: { she: 'What she remembers', he: 'What he remembers', it: 'What it remembers' },
  wroteThese: { she: 'she wrote these', he: 'he wrote these', it: 'it wrote these' },
  noNotes: {
    she: 'She has not written anything down about you yet.',
    he: 'He has not written anything down about you yet.',
    it: 'It has not written anything down about you yet.',
  },
  restore: {
    she: 'Put the built-in back as she ships',
    he: 'Put the built-in back as he ships',
    it: 'Put the built-in back as it ships',
  },
  ownHue: {
    she: 'She wears a hue of her own; none of the eight is stored.',
    he: 'He wears a hue of his own; none of the eight is stored.',
    it: 'It wears a hue of its own; none of the eight is stored.',
  },
  deleting: {
    she: 'her notes and her conversations',
    he: 'his notes and his conversations',
    it: 'its notes and its conversations',
  },
  assembled: {
    she: 'Write the prompt; Sent is the exact string she is handed once her character and her notes are folded in; Tools is the rest of what she is told, which is not editable. Saving lands on her next wake.',
    he: 'Write the prompt; Sent is the exact string he is handed once his character and his notes are folded in; Tools is the rest of what he is told, which is not editable. Saving lands on his next wake.',
    it: 'Write the prompt; Sent is the exact string it is handed once its character and its notes are folded in; Tools is the rest of what it is told, which is not editable. Saving lands on its next wake.',
  },
} as const satisfies Readonly<Record<string, ByPronoun>>
