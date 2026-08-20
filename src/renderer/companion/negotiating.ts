/**
 * What survives a session negotiation.
 *
 * ## The bug this is the shape of
 *
 * `openSession` reads main's answers ONCE, at the door, and then spends two
 * network round trips negotiating. Everything applied from that answer
 * afterwards is a snapshot that may be seconds old — and main can change any of
 * it in the meantime by sending a frame, which the renderer applies immediately.
 * Apply the snapshot unconditionally after the awaits and the OLDER value wins.
 *
 * It is not self-correcting, which is what makes it worth a module. Main only
 * sends a frame when a value CHANGES — `setAsleep` returns early when the new
 * value equals the stored one — so once the two sides disagree, main will never
 * send the correction, because it believes the renderer already has it. The
 * disagreement lasts until somebody happens to toggle the same thing twice.
 *
 * ## Found three times
 *
 * The grants had it first and were fixed in place: a permission revoked during a
 * negotiation came back for the rest of the session. The comment describing that
 * fix sits three lines above `asleep = next.asleep`, which had exactly the same
 * bug and no guard, and `problems` and `bubbleSide` below it had it too.
 *
 * `asleep` is the one that gets reported, in both directions and with the second
 * being the serious one:
 *
 * - Woken while she was negotiating, the renderer kept `asleep: true` — eyes
 *   held shut by `blink: 1`, microphone closed — while main thought she was up
 *   and went on driving her voice. She talks with her eyes closed and hears
 *   nothing.
 * - Put to REST while she was negotiating, the renderer kept `asleep: false`,
 *   and her microphone stayed open after somebody asked her to stop listening.
 *
 * ## Why a counter rather than a timestamp
 *
 * Two changes that cancel out still count as two. Rest toggled off and on during
 * one negotiation leaves the value equal to the snapshot, and taking the
 * snapshot would then be correct by accident — but a comparison of VALUES cannot
 * tell that case from the one where nothing was ever sent, and the second case is
 * the one this exists for. Counting events answers the question actually being
 * asked: did anybody say anything about this while we were not listening.
 */

/**
 * The newer of a snapshot and whatever arrived while it was being fetched.
 *
 * `changed` is the caller's comparison of a counter taken before the awaits
 * against the same counter after them — kept as a boolean here so this function
 * has one job and can be read in one line at the call site.
 */
export function keepsNewer<T>(snapshot: T, live: T, changed: boolean): T {
  return changed ? live : snapshot
}
