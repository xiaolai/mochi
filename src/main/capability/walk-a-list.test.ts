/**
 * The rule the whole refactor exists for: an item counts when she is HEARD.
 *
 * The first version committed at the moment it sent the request, so anything
 * that stopped the request from being played still advanced the list and the
 * item was skipped in silence. That is the one failure a drill cannot have,
 * and it is invisible — a skipped item looks exactly like an item you were not
 * paying attention to.
 */

import { describe, expect, it, beforeEach } from 'vitest'
import { NO_PROGRESS, type Progress } from '@shared/drill'
import { ALONE, type Isolation, type UtteranceId } from '@shared/utterance'
import type { SessionView } from './capability'
import { walkAList } from './walk-a-list'

const ITEMS = ['ephemeral', 'ubiquitous', 'candid']

let written: Progress[] = []
let asked: { instructions: string; isolation: Isolation }[] = []
let stopped: UtteranceId[] = []
/** Whether the session can still take a request. False stands for a dead attempt. */
let alive = true
/**
 * Ids INCREMENT, as the real session's do.
 *
 * Handing back a fixed id hid a defect: with every utterance called 1, code
 * that mixed up two of them still matched on the way out, and four tests
 * passed over a version that committed an item nobody had heard.
 */
let issued = 0

const session: SessionView = {
  say: (instructions, isolation) => {
    asked.push({ instructions, isolation })
    if (!alive) return null
    issued += 1
    return issued
  },
  stop: (id) => {
    stopped.push(id)
  },
}

function build(progress: Progress = NO_PROGRESS) {
  let held = progress
  return walkAList('drill', {
    items: ITEMS,
    advanceOn: (said) => said.trim().toLowerCase() === 'next',
    say: 'Use "{item}" in one sentence.',
    onRestart: 'Starting again.',
    read: () => held,
    write: (next) => {
      held = next
      written.push(next)
    },
  })
}

beforeEach(() => {
  written = []
  asked = []
  stopped = []
  alive = true
  issued = 0
})

describe('asking for another while she is still speaking', () => {
  // Reachable the moment a room measures as having no echo: the microphone
  // stays open while she talks, and she stays audible for seconds after the
  // model has stopped generating. Observed 2026-08-14 at nearly eight.

  it('stops the one in flight instead of stacking a second request', () => {
    // Two in flight cannot be represented. The session has one slot for who is
    // sounding and no server frame carries our id, so the first one's ending
    // would be handed to the second.
    const drill = build()
    drill.onWake?.(session)
    expect(asked).toHaveLength(1)

    drill.onUserSaid?.('next', session)
    expect(stopped, 'the utterance in flight was not stopped').toEqual([1])
    expect(asked, 'a second request was stacked on top of the first').toHaveLength(1)
  })

  it('offers the next one once the interrupted one has ended', () => {
    const drill = build()
    drill.onWake?.(session)
    drill.onUserSaid?.('next', session)
    drill.onUtteranceEnded?.({ id: 1, outcome: 'cancelled' }, session)
    expect(asked, 'the request never arrived after the interruption').toHaveLength(2)
  })

  it('does not mark the interrupted item practised', () => {
    const drill = build()
    drill.onWake?.(session)
    drill.onUserSaid?.('next', session)
    drill.onUtteranceEnded?.({ id: 1, outcome: 'cancelled' }, session)
    expect(written, 'an item she was cut off mid-way counted as practised').toEqual([])
  })

  it('commits the first one when it finished before the stop landed', () => {
    // The race at the boundary: her audio drains in the same breath as the
    // request. She DID say it, so it counts, and the next one still follows.
    const drill = build()
    drill.onWake?.(session)
    drill.onUserSaid?.('next', session)
    drill.onUtteranceEnded?.({ id: 1, outcome: 'played' }, session)
    expect(written, 'an item she finished was thrown away').toHaveLength(1)
    expect(asked).toHaveLength(2)
  })

  it('does not carry a pending request across a session', () => {
    // This object outlives sessions; the two transient fields do not. Ask for
    // "next", lose the session before the cancellation lands, wake again --
    // and the opening item used to inherit the request, so finishing it burned
    // a second item nobody had asked for.
    const drill = build()
    drill.onWake?.(session)
    drill.onUserSaid?.('next', session)
    expect(stopped).toEqual([1])

    // The session dies here: no outcome ever arrives for #1.
    drill.onWake?.(session)
    expect(asked, 'waking should offer exactly one item').toHaveLength(2)
    drill.onUtteranceEnded?.({ id: 2, outcome: 'played' }, session)
    expect(asked, 'the stale request offered an item nobody asked for').toHaveLength(2)
    expect(written).toHaveLength(1)
  })

  it('offers nothing extra when the interruption was not a request', () => {
    // Somebody who just talks over her is saying "not now".
    const drill = build()
    drill.onWake?.(session)
    drill.onUtteranceEnded?.({ id: 1, outcome: 'cancelled' }, session)
    expect(asked).toHaveLength(1)
    expect(stopped).toEqual([])
  })
})

describe('asking for the next item', () => {
  it('says nothing unless the phrase advances it', () => {
    const drill = build()
    drill.onUserSaid?.('what does that mean', session)
    expect(asked).toEqual([])
    drill.onUserSaid?.('next', session)
    expect(asked).toHaveLength(1)
  })

  it('asks for an utterance that can see nothing', () => {
    // Observed: asked for a sentence with a new item while an unanswered
    // question sat in the conversation, she answered the question with the
    // item and the item was burned.
    const drill = build()
    drill.onUserSaid?.('next', session)
    expect(asked[0]?.isolation).toEqual(ALONE)
  })
})

describe('when the item counts', () => {
  it('commits only once she has been heard', () => {
    const drill = build()
    drill.onUserSaid?.('next', session)
    // Asked for, and NOT yet counted. This is the whole point.
    expect(written, 'the item was counted before she said it').toEqual([])

    drill.onUtteranceEnded?.({ id: 1, outcome: 'played' }, session)
    expect(written).toHaveLength(1)
    expect(written[0]?.seen).toHaveLength(1)
  })

  it('leaves the item unseen when she was interrupted', () => {
    const drill = build()
    drill.onUserSaid?.('next', session)
    drill.onUtteranceEnded?.({ id: 1, outcome: 'cancelled' }, session)
    expect(written, 'an interrupted item was counted as practised').toEqual([])
  })

  it('leaves the item unseen when the request failed', () => {
    const drill = build()
    drill.onUserSaid?.('next', session)
    drill.onUtteranceEnded?.({ id: 1, outcome: 'failed' }, session)
    expect(written).toEqual([])
  })

  it('does not offer another item after an interruption', () => {
    // Somebody who interrupts is saying "not now". Answering that with a fresh
    // item is how a drill becomes something you switch off.
    const drill = build()
    drill.onUserSaid?.('next', session)
    drill.onUtteranceEnded?.({ id: 1, outcome: 'cancelled' }, session)
    expect(asked).toHaveLength(1)
  })

  it('ignores an outcome for an utterance it is not waiting on', () => {
    // The greeting, a farewell, or a stale attempt's utterance. Committing on
    // any ending would count an item because something ELSE finished.
    const drill = build()
    drill.onUserSaid?.('next', session)
    drill.onUtteranceEnded?.({ id: 99, outcome: 'played' }, session)
    expect(written).toEqual([])
    drill.onUtteranceEnded?.({ id: 1, outcome: 'played' }, session)
    expect(written).toHaveLength(1)
  })

  it('commits nothing when there was no session to ask', () => {
    // `say` answers null when the attempt is gone. Holding a pending against
    // an id that was never issued would commit on the next thing that ended.
    alive = false
    const drill = build()
    drill.onUserSaid?.('next', session)
    drill.onUtteranceEnded?.({ id: 1, outcome: 'played' }, session)
    expect(written).toEqual([])
  })
})

describe('waking', () => {
  it('opens with an item rather than a greeting', () => {
    const drill = build()
    drill.onWake?.(session)
    expect(asked).toHaveLength(1)
    expect(ITEMS.some((item) => asked[0]!.instructions.includes(item))).toBe(true)
  })

  it('does not count the opening item until she has said it', () => {
    // The gap this fix closed. Waking used to return instructions for the
    // lifecycle to speak, so the id belonged to the lifecycle and there was
    // nothing to follow -- the item was committed on the spot and counted
    // whether or not she ever said it.
    const drill = build()
    drill.onWake?.(session)
    expect(written, 'the opening item was counted before she said it').toEqual([])
    drill.onUtteranceEnded?.({ id: 1, outcome: 'played' }, session)
    expect(written).toHaveLength(1)
  })

  it('leaves the opening item unseen when the session dies first', () => {
    alive = false
    const drill = build()
    drill.onWake?.(session)
    drill.onUtteranceEnded?.({ id: 1, outcome: 'played' }, session)
    expect(written).toEqual([])
  })

  it('owns every utterance, so nothing else can answer', () => {
    expect(build().drives).toBe(true)
  })
})
