/**
 * The two halves of this window's state, and the order they are read in.
 *
 * ## The failure this exists for — contract L1
 *
 * The window title is "Mochi · <her name>", and the name comes from the
 * character half. Run in parallel, the title lost the race about half the time
 * and settled on her id — the one string the cards beside it never show.
 *
 * So: characters first, THEN conversations. Sequenced, not raced.
 *
 * ## Contract L2
 *
 * The same sequence runs on a character switch, not only at startup. The
 * archive is scoped per character, so wearing somebody changes whose
 * conversations these are; a switch that re-read only the character half would
 * leave the previous character's archive on screen under the new name. That is
 * why this is ONE function called from both places rather than a startup path
 * and a narrower switch path — two paths is how the switch lost its second read.
 */
export interface Reads {
  /** Her characters, and everything belonging to the one she is wearing. */
  readonly characters: () => Promise<void>
  /** The archive, which is scoped per character. */
  readonly conversations: () => Promise<void>
  /**
   * Say that the character half could not be read.
   *
   * Reported rather than thrown: at startup nothing awaits this, so a rejection
   * would reach `unhandledrejection` and be announced as "Something went wrong"
   * — a sentence that says less than the one this window can write.
   */
  readonly characterTrouble: (error: unknown) => void
}

/**
 * Both halves, in order, from startup and from a character switch alike.
 *
 * The conversations are read even when the characters could not be — `finally`
 * rather than `then`. The two are independent everywhere except in the order
 * they run, so a failure in one must not take the other down with it.
 *
 * Trouble in the CONVERSATION half is not caught here, because nothing
 * downstream of it can report and a blanket catch would make a dead archive
 * look like an empty one.
 */
export async function readEverything(reads: Reads): Promise<void> {
  try {
    await reads.characters()
  } catch (error: unknown) {
    reads.characterTrouble(error)
  }
  await reads.conversations()
}
