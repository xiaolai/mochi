import type { ByPronoun } from '@shared/pronoun'

/**
 * Every message this window writes that is ABOUT her, one phrasing per pronoun.
 *
 * What the window SAYS, kept apart from what it draws. Read against
 * `shelf.pronoun`, which is re-read on every draw, so a character switch
 * rewords these on the same pass that redraws the sheet.
 *
 * Three blocks were stacked here, two of them saying this twice and the third
 * describing the `worn` message rather than the module. A rationale that sits
 * above the wrong declaration is read as being about that declaration, which is
 * worse than no rationale — it is now on the entry it is about.
 */
export const SAYS = {
  readingPermits: {
    she: 'Reading what she may do…',
    he: 'Reading what he may do…',
    it: 'Reading what it may do…',
  },

  marginFacesHead: { she: 'Her expressions', he: 'His expressions', it: 'Its expressions' },
  marginStored: 'Stored at',
  marginBuiltIn: {
    she: 'built-in · no file of her own',
    he: 'built-in · no file of his own',
    it: 'built-in · no file of its own',
  },
  marginUsedNone: 'none',

  /*
    The three views of her page.

    Sentences about her, so they take her pronoun — which is the whole reason
    they do not live in `tabs.ts` beside the movement they belong to. The worn
    character can change from the tray while this window is open, so
    `renderPlaces` re-resolves them on every pass rather than writing them once.
  */
  viewCast: { she: 'Who she is', he: 'Who he is', it: 'What it is' },
  viewArchive: {
    she: 'What she has said',
    he: 'What he has said',
    it: 'What it has said',
  },
  viewPermits: { she: 'What she may do', he: 'What he may do', it: 'What it may do' },

  /**
   * Clicking a card WEARS her — the handoff's own interaction (1a) — so the
   * plates, the assembled prompt and the conversations list all follow from one
   * click. A wake opens a new session, so nothing is torn down; the sheet says
   * as much rather than leaving somebody to wonder whether it took.
   */
  worn: {
    she: 'Worn. She will be this character from her next wake.',
    he: 'Worn. He will be this character from his next wake.',
    it: 'Worn. It will be this character from its next wake.',
  },
  saved: {
    she: 'Saved. It takes effect on her next wake.',
    he: 'Saved. It takes effect on his next wake.',
    it: 'Saved. It takes effect on its next wake.',
  },
  dropHers: {
    she: 'Delete every conversation with her?',
    he: 'Delete every conversation with him?',
    it: 'Delete every conversation with it?',
  },
  dropHersWhy: {
    she: 'Everything she has been told, and everything she said, is removed from this machine. Who she is, her voice and her look are untouched. This cannot be undone.',
    he: 'Everything he has been told, and everything he said, is removed from this machine. Who he is, his voice and his look are untouched. This cannot be undone.',
    it: 'Everything it has been told, and everything it said, is removed from this machine. Who it is, its voice and its look are untouched. This cannot be undone.',
  },
  droppedHers: {
    she: 'Every conversation with her is deleted.',
    he: 'Every conversation with him is deleted.',
    it: 'Every conversation with it is deleted.',
  },
  deleted: {
    she: 'Deleted, with her notes and her conversations. The built-in is worn now.',
    he: 'Deleted, with his notes and his conversations. The built-in is worn now.',
    it: 'Deleted, with its notes and its conversations. The built-in is worn now.',
  },
  restored: {
    she: 'The built-in is back as she ships.',
    he: 'The built-in is back as he ships.',
    it: 'The built-in is back as it ships.',
  },
  made: {
    she: 'Made, and worn. She will be this character from her next wake.',
    he: 'Made, and worn. He will be this character from his next wake.',
    it: 'Made, and worn. It will be this character from its next wake.',
  },
  cutEarly: {
    she: 'interrupted before she got a word out',
    he: 'interrupted before he got a word out',
    it: 'interrupted before it got a word out',
  },
  /*
    The first hour, and it is the delivery's own words.

    "She has not said anything yet. This page fills itself the first time you
    talk to her." A sentence about what will happen, not a report that a query
    returned nothing.
  */
  noTalks: {
    she: 'She has not said anything yet. This page fills itself the first time you talk to her.',
    he: 'He has not said anything yet. This page fills itself the first time you talk to him.',
    it: 'It has not said anything yet. This page fills itself the first time you talk to it.',
  },
  /*
    NOTHING TO SHOW is not the same as FAILED TO READ, and an empty page cannot
    tell you which. So the empty state says what is true of the machine: whether
    conversations are being kept at all, and how many times she has been awake.
    A person whose retention is off learns it here rather than after a week of
    talking to an archive that was never going to fill.
  */
  /* Said where the day strip would be, when no day has anything on it. */
  noDay: 'no day has anything in it',
  noTalksWhy: 'keeping conversations is',
  /* Said after a face is worn from the mood tiles. The face's own name comes
     first — "Done" over eight tiles that look alike at 56px says nothing
     anybody can check — and this is the tail. */
  lookAtHer: { she: ' — look at her.', he: ' — look at him.', it: ' — look at it.' },
  /* Said when the system prompt is saved with nothing in it. What actually
     happens, rather than "Saved": the document is empty and the character is
     still assembled from everything else. */
  promptNowEmpty: {
    she: 'The system prompt is empty. She is still told her character.',
    he: 'The system prompt is empty. He is still told his character.',
    it: 'The system prompt is empty. It is still told its character.',
  },
  /* The receipt after the notes are erased. It names what went and what did
     not, because the confirmation just promised the conversations were safe. */
  backToWho: { she: '‹ Who she is', he: '‹ Who he is', it: '‹ What it is' },
  /* The apparatus column's four labels. Facts, never arguments — the delivery's
     own first audit finding was that this column held prose about the design. */
  /*
    `marginIs`, `marginColour(Head)` and `marginFaces` were here — four
    paragraphs the apparatus column used to carry. They went with the column's
    prose: the delivery's first audit finding is that no words explaining the
    design are left in the interface, and one of them had gone false anyway,
    still saying her colour retints a window that no longer takes a hue.
  */
  /*
    The three drill-downs each have an apparatus column of their own — A2b, A2c
    and A8 all draw one — and all three were showing HER PAGE's four facts. So
    the screen about her notes stood beside "Last awake" and "Stored at · wisp",
    which are true and are about something else.
  */
  /* The rail's heading over the character list. A label, not a sentence — the
     count beside it is the part that moves. */
  /* The month picker on a fresh archive: nothing to choose, said rather than
     drawn as twelve dead buttons with no explanation. */
  monthNoneKept: 'Nothing has been kept in this year, so none of these opens anything.',
  railCast: 'Characters',
  keptHead: 'Lines kept',
  keptSizeHead: 'Written',
  keptWhereHead: 'Stored at',
  /* A8's "Right now", per state. `saving` is not a synonym for either of the
     others: while a save is in flight the box and both buttons are dead, and
     reporting that as "unsaved" would describe the freeze as an edit. */
  promptSaved: 'saved',
  promptUnsaved: 'unsaved',
  promptSaving: 'saving…',
  drawnHead: 'Drawn',
  allowedHead: 'Allowed',
  wearingHead: 'Wearing now',
  drawnAtHead: 'Drawn at',
  drawnAtOwn: {
    she: 'her desktop size',
    he: 'his desktop size',
    it: 'its desktop size',
  },
  sentAtWakeHead: {
    she: 'Sent at her next wake',
    he: 'Sent at his next wake',
    it: 'Sent at its next wake',
  },
  promptWhereHead: 'Stored at',
  /* A7's apparatus column: who the grants apply to, how many are withheld, and
     when a change to one takes effect. */
  permitsForHead: 'In force for',
  permitsForWhom: 'the worn character · the live one',
  permitsWithheldHead: 'Withheld',
  permitsWhenHead: {
    she: 'Sent at her next wake',
    he: 'Sent at his next wake',
    it: 'Sent at its next wake',
  },
  permitsWhen: 'off takes effect at once',
  marginNow: 'Right now',
  marginAsleep: 'asleep',
  marginLastAwake: 'Last awake',
  marginNeverAwake: 'never · nothing kept yet',
  keptErased: {
    she: 'Erased. Everything she had kept about you is gone.',
    he: 'Erased. Everything he had kept about you is gone.',
    it: 'Erased. Everything it had kept about you is gone.',
  },
  /*
    "on the left" was true of a layout that no longer exists — the list was in
    an aside beside the transcript and is above it now. A sentence that tells
    somebody to look in the wrong direction is worse than one that tells them
    nothing.
  */
  pickOne: {
    she: 'Pick a conversation above, or search everything she has ever said.',
    he: 'Pick a conversation above, or search everything he has ever said.',
    it: 'Pick a conversation above, or search everything it has ever said.',
  },
  noTroubles: {
    she: 'Nothing has gone wrong since she woke up.',
    he: 'Nothing has gone wrong since he woke up.',
    it: 'Nothing has gone wrong since it woke up.',
  },
  troubles: {
    she: 'Things she could not load since she woke up. Each one fell back to a working default, so nothing here stopped her — but a file you edited may not be the one she is using.',
    he: 'Things he could not load since he woke up. Each one fell back to a working default, so nothing here stopped him — but a file you edited may not be the one he is using.',
    it: 'Things it could not load since it woke up. Each one fell back to a working default, so nothing here stopped it — but a file you edited may not be the one it is using.',
  },
} as const satisfies Readonly<Record<string, ByPronoun | string>>
