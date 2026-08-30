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
  herName: { she: 'Her name', he: 'His name', it: 'Its name' },
  herWords: { she: 'Her words', he: 'His words', it: 'Its words' },
  /* The hint beside Appearance when she carries her own hue rather than one of
     the eight. */
  /* A2b's second section. The fence is a safety boundary, so the screen that
     shows her notes is where it has to be explained. */
  fenceHead: {
    she: 'How she is told to read it',
    he: 'How he is told to read it',
    it: 'How it is told to read it',
  },
  /*
    What the fence SAYS, not where it is kept.

    "under 'What she is told'" is a location, and a location is not the fact
    somebody on this screen needs — A2b puts the fence's own words here, because
    the boundary is the point and where it is stored is a detail of it.
  */
  fenceWhere: {
    she: 'data, not instructions',
    he: 'data, not instructions',
    it: 'data, not instructions',
  },
  fenceWhy: {
    she:
      'These lines reach her wrapped in a fence that says they are background DATA, not ' +
      'instructions — because a model wrote them, and anything a model wrote could try to ' +
      'change how she behaves. The wording of that fence is under “What she is told”, and ' +
      'removing it removes the boundary.',
    he:
      'These lines reach him wrapped in a fence that says they are background DATA, not ' +
      'instructions — because a model wrote them, and anything a model wrote could try to ' +
      'change how he behaves. The wording of that fence is under “What he is told”, and ' +
      'removing it removes the boundary.',
    it:
      'These lines reach it wrapped in a fence that says they are background DATA, not ' +
      'instructions — because a model wrote them, and anything a model wrote could try to ' +
      'change how it behaves. The wording of that fence is under “What it is told”, and ' +
      'removing it removes the boundary.',
  },
  ownAppearance: { she: 'her own', he: 'his own', it: 'its own' },
  sentAtWake: {
    she: 'sent at her next wake',
    he: 'sent at his next wake',
    it: 'sent at its next wake',
  },
  deeperFaces: { she: 'Her expressions', he: 'His expressions', it: 'Its expressions' },
  deeperNotes: {
    she: 'What she has kept',
    he: 'What he has kept',
    it: 'What it has kept',
  },
  deeperInstruction: {
    she: 'Her instruction',
    he: 'His instruction',
    it: 'Its instruction',
  },
  whoHead: { she: 'Who she is', he: 'Who he is', it: 'What it is' },
  whoHint: {
    she: 'Her name, the words she takes, and what she calls you.',
    he: 'His name, the words he takes, and what he calls you.',
    it: 'Its name, the words it takes, and what it calls you.',
  },
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
    she: 'ten · lands on her next wake',
    he: 'ten · lands on his next wake',
    it: 'ten · lands on its next wake',
  },
  bubbleWhen: {
    she: 'off · lands on her next wake',
    he: 'off · lands on his next wake',
    it: 'off · lands on its next wake',
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
  /*
    A2b's heading. "What she remembers" is a claim about her; this is a claim
    about a FILE, and the difference is the screen's whole subject — what is on
    it is the lines she wrote down, not everything she has retained.
  */
  remembers: {
    she: 'What she has written down about you',
    he: 'What he has written down about you',
    it: 'What it has written down about you',
  },
  /*
    Why the lines cannot be edited, said where somebody would first try.

    The section had "she wrote these" as its only note — three words that state
    the authorship and answer none of the questions it raises. The unrewritable
    part is the one people push on, and the reason is worth one sentence: a note
    you rewrote would no longer be what she remembers.
  */
  wroteThese: {
    she:
      'She writes these herself, when you ask her to remember something. You can read all of ' +
      'it, and you can take it away — but you cannot edit it, because a note you rewrote would ' +
      'no longer be what she remembers.',
    he:
      'He writes these himself, when you ask him to remember something. You can read all of ' +
      'it, and you can take it away — but you cannot edit it, because a note you rewrote would ' +
      'no longer be what he remembers.',
    it:
      'It writes these itself, when you ask it to remember something. You can read all of ' +
      'it, and you can take it away — but you cannot edit it, because a note you rewrote would ' +
      'no longer be what it remembers.',
  },
  /* Beside the erase control, saying what pressing it costs before it is
     pressed. D2's sheet is the thing this describes. */
  eraseAsks: {
    she: 'asks once, and offers a copy first',
    he: 'asks once, and offers a copy first',
    it: 'asks once, and offers a copy first',
  },
  /* The destructive control on her notes. Named, because "Erase everything" on
     its own does not say everything of WHAT — and the sheet it opens says the
     rest. */
  expressions: {
    she: 'Her expressions',
    he: 'His expressions',
    it: 'Its expressions',
  },
  seeingAndPermitting: {
    she:
      'Each one is drawn here at the size she appears on your desktop. Seeing one and ' +
      'permitting it are two separate things — the tile shows you the face, the switch under ' +
      'it decides whether she may wear it.',
    he:
      'Each one is drawn here at the size he appears on your desktop. Seeing one and ' +
      'permitting it are two separate things — the tile shows you the face, the switch under ' +
      'it decides whether he may wear it.',
    it:
      'Each one is drawn here at the size it appears on your desktop. Seeing one and ' +
      'permitting it are two separate things — the tile shows you the face, the switch under ' +
      'it decides whether it may wear it.',
  },
  mayBeEmpty: {
    she:
      'Withholding one does not hide the tile — you can always look. The set may legally be ' +
      'empty: switch all eight off and she is simply never told she has a face to change.',
    he:
      'Withholding one does not hide the tile — you can always look. The set may legally be ' +
      'empty: switch all eight off and he is simply never told he has a face to change.',
    it:
      'Withholding one does not hide the tile — you can always look. The set may legally be ' +
      'empty: switch all eight off and it is simply never told it has a face to change.',
  },
  eraseKept: {
    she: 'Erase everything she has kept…',
    he: 'Erase everything he has kept…',
    it: 'Erase everything it has kept…',
  },
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
  /* A8's title for this screen. It was "System prompt", which names the
     mechanism; the row that opens it, the rail's own vocabulary and the
     artboard all call it her instruction. */
  instruction: { she: 'Her instruction', he: 'His instruction', it: 'Its instruction' },
  /* Beside Save and Abandon, where somebody about to press one is looking.
     Autosave is the habit every other control on this shelf has taught, so the
     one that does not has to say so at the control rather than in a paragraph
     above it. */
  notAsYouType: {
    she: 'Not saved as you type. Saving lands on her next wake.',
    he: 'Not saved as you type. Saving lands on his next wake.',
    it: 'Not saved as you type. Saving lands on its next wake.',
  },
  /* Why the box goes dead for a moment — said before it happens, so the freeze
     reads as a rule rather than as the window hanging. */
  whileSaving: {
    she: 'While a save is in flight, both of these and the text itself are unavailable — there is one document and two writers, and the honest resolution is that one of them waits.',
    he: 'While a save is in flight, both of these and the text itself are unavailable — there is one document and two writers, and the honest resolution is that one of them waits.',
    it: 'While a save is in flight, both of these and the text itself are unavailable — there is one document and two writers, and the honest resolution is that one of them waits.',
  },
  assembled: {
    she: 'Write the prompt; Sent is the exact string she is handed once her character and her notes are folded in; Tools is the rest of what she is told, which is not editable. Saving lands on her next wake.',
    he: 'Write the prompt; Sent is the exact string he is handed once his character and his notes are folded in; Tools is the rest of what he is told, which is not editable. Saving lands on his next wake.',
    it: 'Write the prompt; Sent is the exact string it is handed once its character and its notes are folded in; Tools is the rest of what it is told, which is not editable. Saving lands on its next wake.',
  },
} as const satisfies Readonly<Record<string, ByPronoun>>
