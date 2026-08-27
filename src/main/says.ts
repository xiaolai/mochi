import { type ByPronoun } from '@shared/pronoun'

/**
 * What MAIN says about her, in the sentences a person actually reads.
 *
 * ## Why main has copy at all
 *
 * Because `SettingsWrite.why` and `problems.note`'s detail are prose, and both
 * are drawn verbatim in the conversations window. That is arguably the wrong
 * shape — the window owns copy everywhere else — but it is the shape this
 * bridge has, and those sentences carry interpolated detail (`${held.why}`,
 * `${String(error)}`) that a code-plus-table scheme cannot pass through without
 * inventing a payload mechanism. So the copy stays here, and this file is what
 * stops it being written for one pronoun.
 *
 * ## The rule, and where it stops
 *
 * **Resolve where the character is in hand; word it without a pronoun where it
 * is not.** Main can reach the worn pronoun through `wornPronoun(userData)`,
 * which is what every entry below is for. Two kinds of message cannot:
 *
 * - Anything inside `catalogue()`. `wornPronoun` calls `catalogue`, so
 *   resolving there is infinite recursion — not a style preference, a stack
 *   overflow.
 * - Anything in `store/`. A module reading `preferences.json` has no business
 *   loading the persona catalogue to word an error, and `applyHearing` already
 *   settled this: a pure checker says it without a pronoun rather than
 *   assuming one.
 *
 * Those messages are pronoun-free instead, which costs nothing — a
 * `problems.note` row already names the character in its own id column, so the
 * detail beside it never needed to.
 *
 * ## Why not in the renderer's tables
 *
 * `panes-says.ts` and `shelf-says.ts` are renderer modules and importing one
 * here would drag the window's copy into the main process. The reader is what
 * is shared — `pronoun.ts` owns `forPronoun` — and a fourth pronoun still lands
 * in one place because every table is typed `ByPronoun`.
 */
export const SAYS = {
  /* The precondition every note and persona action carries: the page named the
     character it was showing, and somebody switched since. */
  characterChanged: {
    she: 'That was for a different character — she has changed since. Have another look.',
    he: 'That was for a different character — he has changed since. Have another look.',
    it: 'That was for a different character — it has changed since. Have another look.',
  },
  noPreviousNote: {
    she: 'There is no earlier version of her notes to go back to.',
    he: 'There is no earlier version of his notes to go back to.',
    it: 'There is no earlier version of its notes to go back to.',
  },
  /* A PREFIX: the store's own reason for the failure is appended. */
  notesUnreadable: {
    she: 'Her notes could not be read, so they were left alone: ',
    he: 'His notes could not be read, so they were left alone: ',
    it: 'Its notes could not be read, so they were left alone: ',
  },
  nothingToForget: {
    she: 'There is nothing in her notes to forget.',
    he: 'There is nothing in his notes to forget.',
    it: 'There is nothing in its notes to forget.',
  },
  builtInStays: {
    she: 'The built-in cannot be deleted. Put her back as she ships instead.',
    he: 'The built-in cannot be deleted. Put him back as he ships instead.',
    it: 'The built-in cannot be deleted. Put it back as it ships instead.',
  },
  notOnScreen: {
    she: 'She is not on screen just now, so there is nothing to put a face on.',
    he: 'He is not on screen just now, so there is nothing to put a face on.',
    it: 'It is not on screen just now, so there is nothing to put a face on.',
  },
  /* A PREFIX: the error is appended. Said when a grant reached disk and the
     live session could not be told about it. */
  notTold: {
    she: 'saved, but she was not told: ',
    he: 'saved, but he was not told: ',
    it: 'saved, but it was not told: ',
  },
  /* `grant-outcome.ts`'s two honest refusals. Both begin "Saved" because the
     write DID land; what did not happen is the telling. */
  grantOtherCharacter: {
    she: 'Saved. She is still speaking as another character, so it applies from her next wake.',
    he: 'Saved. He is still speaking as another character, so it applies from his next wake.',
    it: 'Saved. It is still speaking as another character, so it applies from its next wake.',
  },
  grantNotTold: {
    she: 'Saved, but she could not be told just now — it applies from her next wake.',
    he: 'Saved, but he could not be told just now — it applies from his next wake.',
    it: 'Saved, but it could not be told just now — it applies from its next wake.',
  },
} as const satisfies Readonly<Record<string, ByPronoun>>
