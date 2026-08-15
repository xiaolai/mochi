/**
 * Walk a list, one item per turn, remembering the place.
 *
 * The vocabulary drill, generalised out of `index.ts`. Nothing here knows the
 * items are words: it is a list, a phrase that advances it, and a template.
 * Which is why the same shape is a phrasebook, a flashcard deck, scenario
 * prompts, interview questions, or anything else somebody walks through.
 *
 * ## The app chooses, the model speaks
 *
 * Which item is next, which have been covered, when the list wraps -- all of
 * it is code and a file on disk. The model is handed one item and asked to say
 * something with it. It is never asked to remember, and it never picks. A
 * model asked to track state does it plausibly and wrongly, and the failure is
 * invisible: a repeated item sounds exactly like a new one.
 *
 * ## The place is committed when she is HEARD, not when she is asked
 *
 * This is the whole reason `onUtteranceEnded` exists. The first version marked
 * an item covered at the moment it sent the request, so a request that never
 * played still advanced the list and the item was skipped in silence -- the
 * one failure a drill must not have. Now the item is held as pending and
 * committed only on `played`; `cancelled` and `failed` put it back.
 */

import { fill } from '@shared/artifact'
import { pick, type Progress } from '@shared/drill'
import { ALONE, type UtteranceId } from '@shared/utterance'
import type { Capability, SessionView } from './capability'

export interface WalkAList {
  readonly items: readonly string[]
  /** Utterances that mean "give me another". Matched against the tail. */
  readonly advanceOn: (said: string) => boolean
  /** What she is told, with `{item}` standing for the chosen one. */
  readonly say: string
  /** Said once when the list wraps, or null for no announcement. */
  readonly onRestart: string | null
  readonly read: () => Progress
  readonly write: (progress: Progress) => void
}

export function walkAList(name: string, spec: WalkAList): Capability {
  /**
   * The item that has been spoken for but not yet heard.
   *
   * Held rather than written, because "asked for" and "heard" are different
   * moments and only the second one means the item was practised.
   */
  let pending: { id: UtteranceId; progress: Progress } | null = null

  /**
   * An advance asked for while she was still speaking.
   *
   * Ordinary, not exotic: once a room measures as having no echo the
   * microphone STAYS OPEN while she talks, and she is audible for seconds
   * after the model has finished generating -- eight, on an item of any
   * length. So "next" lands mid-sentence as a matter of course.
   */
  let advanceWhenQuiet = false

  /** Choose the next item and hand back what to say, or null for an empty list. */
  const next = (): { instructions: string; progress: Progress } | null => {
    const chosen = pick(spec.items, spec.read(), (upTo) => Math.floor(Math.random() * upTo))
    if (chosen === null) {
      console.error(`[${name}] the list is empty`)
      return null
    }
    console.log(
      `[${name}] ${chosen.word} (${String(chosen.progress.seen.length)}/${String(spec.items.length)})`,
    )
    // The wording is the ARTIFACT's, not this module's. Nothing here knows
    // the items are words, which is what makes the same shape a phrasebook, a
    // flashcard deck or a set of scenario prompts.
    const opening = chosen.restarted && spec.onRestart !== null ? `${spec.onRestart} ` : ''
    return {
      instructions: opening + fill(spec.say, chosen.word),
      progress: chosen.progress,
    }
  }

  /** Ask for one, and remember what it would commit if it is heard. */
  const offer = (session: SessionView): void => {
    const chosen = next()
    if (chosen === null) return
    const id = session.say(chosen.instructions, ALONE)
    // No session to ask means the attempt is gone. Nothing is committed and
    // nothing is pending, so the next wake offers the same item again.
    if (id === null) return
    pending = { id, progress: chosen.progress }
  }

  return {
    name,
    // She speaks only when this asks. A drill that answered questions on its
    // own would not be a drill, and prose asking a model to ignore you is
    // honoured most of the time rather than every time.
    drives: true,

    // Waking is just the first "next". Nothing about the opening item is
    // special, so nothing about it gets its own rules.
    onWake: (session) => {
      // Both transient fields belong to the SESSION, not to the persona, and
      // this object outlives sessions. Ask for "next", have the session die
      // before the cancellation lands, wake again -- and the opening item
      // inherited `advanceWhenQuiet`, so finishing it silently burned a second
      // item nobody had asked for.
      pending = null
      advanceWhenQuiet = false
      offer(session)
    },

    onUserSaid: (text, session) => {
      if (!spec.advanceOn(text)) return
      // Stop her first, then offer when the outcome lands. Asking for a second
      // while the first is in flight cannot be represented: the session has one
      // slot for "who is sounding" and no server frame carries our id, so the
      // first one's ending would be handed to the second and an item nobody
      // heard would be marked practised.
      if (pending !== null) {
        advanceWhenQuiet = true
        session.stop(pending.id)
        return
      }
      offer(session)
    },

    onUtteranceEnded: ({ id, outcome }, session) => {
      if (pending === null || pending.id !== id) return
      const held = pending
      pending = null
      if (outcome === 'played') {
        spec.write(held.progress)
      } else {
        // Interrupted or failed: the item was never practised, so it stays
        // unseen.
        console.log(`[${name}] ${outcome}, so the item stays unseen`)
      }
      // Offered only when the interruption WAS a request for another. An
      // ordinary interruption is somebody saying "not now", and answering that
      // with a fresh item is how a drill becomes something you switch off.
      if (advanceWhenQuiet) {
        advanceWhenQuiet = false
        offer(session)
      }
    },
  }
}
