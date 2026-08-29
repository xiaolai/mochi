/**
 * Reads whose answer comes from outside this window, and go stale while it is
 * away.
 *
 * ## The failure this exists for — contract M4
 *
 * The count of things that have gone wrong was read once, at launch. Failures
 * happen DURING use, not at launch, and this window is opened and closed rather
 * than lived in — so the number was taken at the one moment it is guaranteed to
 * be zero and then never taken again. A problem surface stayed hidden for the
 * whole life of the session, precisely when there was something to show.
 *
 * ## Why registering is one call and not two
 *
 * The read at launch and the read on return are the same read, and writing them
 * as two statements is what lets them drift: a read added to the focus listener
 * but not run at launch shows nothing until the window is left and come back
 * to, and one run at launch but never registered is the original defect
 * verbatim. `afresh` takes them together so neither can exist without the other.
 *
 * ## What belongs here
 *
 * Only answers this window does not own — the store's count of failures, an
 * external tool's readiness, whether the operating system still grants a
 * shortcut. Anything the window itself changed is re-read by the write that
 * changed it, and putting it here would mean reading it twice and racing.
 */
export interface Returns {
  addEventListener(type: 'focus', run: () => void): void
  removeEventListener(type: 'focus', run: () => void): void
}

/**
 * Read each of them now, and again every time the window comes back.
 *
 * Answers a way to stop, so a test can register without leaking a listener into
 * the next one.
 */
export function afresh(where: Returns, ...reads: ReadonlyArray<() => void>): () => void {
  const readAll = (): void => {
    // `reads` is a rest parameter, so it is already ours — a caller mutating
    // the array it spread cannot change what a later focus reads. Taking them
    // as a single array argument would lose that, and quietly.
    for (const read of reads) read()
  }
  where.addEventListener('focus', readAll)
  readAll()
  return () => {
    where.removeEventListener('focus', readAll)
  }
}
