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
  /**
   * The fallback speaker label, when the character whose conversation this is
   * has gone from the shelf.
   *
   * Her NAME is what a transcript uses, and what this build shipped instead was
   * the object pronoun: a paragraph headed "HIM" above a paragraph headed "YOU",
   * which is not how anybody writes down a conversation. The name is only
   * missing if the persona was deleted while a transcript of hers was open, and
   * then this is better than a blank.
   */
  spoke: { she: 'her', he: 'him', it: 'it' },
  cutEarly: {
    she: 'interrupted before she got a word out',
    he: 'interrupted before he got a word out',
    it: 'interrupted before it got a word out',
  },
  noTalks: {
    she: 'Nothing has been kept yet. Conversations appear here once she has been awake and her conversations are being saved.',
    he: 'Nothing has been kept yet. Conversations appear here once he has been awake and his conversations are being saved.',
    it: 'Nothing has been kept yet. Conversations appear here once it has been awake and its conversations are being saved.',
  },
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
  machineIsFor: {
    she: 'Who she is is on the Cast tab. This holds only what is true whoever is worn.',
    he: 'Who he is is on the Cast tab. This holds only what is true whoever is worn.',
    it: 'What it is is on the Cast tab. This holds only what is true whoever is worn.',
  },
  pickOne: {
    she: 'Pick a conversation on the left, or search everything she has ever said.',
    he: 'Pick a conversation on the left, or search everything he has ever said.',
    it: 'Pick a conversation on the left, or search everything it has ever said.',
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
} as const satisfies Readonly<Record<string, ByPronoun>>
