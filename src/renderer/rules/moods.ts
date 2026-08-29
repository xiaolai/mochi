import { EMOTIONS, type Emotion } from '@shared/avatar'

/**
 * Which faces she may reach for, across two toggles that overlap one reload.
 *
 * ## The failure this exists for — contract C2
 *
 * Each toggle sent the whole list, rebuilt from the set as it was at RENDER
 * time. Two toggles before the reload lands therefore both start from the same
 * snapshot, and the second one's payload has no idea the first happened —
 * turning `happy` on and then `sad` on wrote a list with `sad` and WITHOUT
 * `happy`, silently undoing a change the control still showed as made.
 *
 * The fix is that the live set is mutated rather than rebuilt, which is what
 * somebody clicking two things in a row asked for. That is one line of
 * behaviour, and it lived inside a change listener where the only way to
 * exercise it was to click a real control twice.
 *
 * ## Two things this deliberately keeps
 *
 * The whole list goes every time, not the change: the store keeps what it is
 * given, and a payload of just the toggle would read as "these are the only
 * ones".
 *
 * And the list comes back in `EMOTIONS` order rather than click order, so what
 * is stored does not depend on the order somebody happened to press — two
 * identical sets must not compare unequal.
 */
export interface Moods {
  /**
   * Turn one face on or off, and get back the payload to send.
   *
   * The set is LIVE. A second call before the first write has come back sees
   * the first one's change, which is the whole point of the module.
   */
  allow(emotion: Emotion, on: boolean): readonly Emotion[]
  /** What is allowed now, without changing anything. */
  allowed(): readonly Emotion[]
}

export function moods(initial: Iterable<Emotion>): Moods {
  // A copy of the caller's list, because the view it came from is re-read from
  // the store rather than patched here — writing back would make this the
  // second place a character lives.
  const on = new Set<Emotion>(initial)
  // Empty is LEGAL and is not the same as "all of them": a manifest that does
  // not mention faces is given every one, and an empty list is somebody saying
  // none.
  const payload = (): readonly Emotion[] => EMOTIONS.filter((one) => on.has(one))
  return {
    allow: (emotion, want) => {
      if (want) on.add(emotion)
      else on.delete(emotion)
      return payload()
    },
    allowed: payload,
  }
}
