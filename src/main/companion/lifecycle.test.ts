/**
 * The attempt number, under test.
 *
 * This file exists because the bug it covers was invisible to everything else.
 * Types were green, 204 tests were green, and the build was green while a
 * superseded voice session could still drive the phase — `lifecycle.ts` simply
 * had no test at all, so the whole module was green by absence.
 *
 * What is asserted here is the ONE property the number is for: an event stamped
 * with an attempt that is no longer current must change nothing.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_SOUND } from '@shared/sound'
import { startLifecycle, type Lifecycle, type LifecycleView } from './lifecycle'
import { DEFAULT_SETTINGS } from '@shared/companion'
import type { VoiceCommand } from '@shared/ipc'
import { DEFAULT_PERSONA } from '@shared/persona'

function harness(greeting: string | null = 'greet'): {
  view: LifecycleView
  sent: VoiceCommand[]
  phases: string[]
} {
  const sent: VoiceCommand[] = []
  const phases: string[] = []
  return {
    sent,
    phases,
    view: {
      command: (command) => sent.push(command),
      persona: () => DEFAULT_PERSONA,
      memory: () => '',
      spokenRules: () => 'be brief',
      sound: () => DEFAULT_SOUND,
      drives: () => false,
      greeting: () => greeting,
      farewell: () => 'bye',
      onChanged: (state) => phases.push(state.phase),
    },
  }
}

/** The attempt the lifecycle stamped on its `open`. */
function openedAttempt(sent: readonly VoiceCommand[]): number {
  const open = sent.find((command) => command.kind === 'open')
  if (open === undefined) throw new Error('no open command was issued')
  return open.attempt
}

describe('settings are read when they are needed, not at startup', () => {
  it('honours a change made between one wake and the next', () => {
    // `startLifecycle` runs ONCE for the process, and the settings used to be
    // a value captured here. So the microphone setting the pane promises
    // "takes effect the next time she wakes" took effect at the next LAUNCH,
    // and the sentence in the window was untrue.
    const { view, sent } = harness()
    let listening: 'auto' | 'speaker' | 'earphones' = 'speaker'
    const life = startLifecycle(view, () => ({ ...DEFAULT_SETTINGS, listening }))

    // On a speaker she stops listening while she is talking.
    life.toggle()
    life.report({ kind: 'sessionReady' }, openedAttempt(sent))
    life.report({ kind: 'voiceStarted' }, openedAttempt(sent))
    expect(life.micOpen).toBe(false)

    // Changed while she is asleep, the way the settings window changes it.
    life.sleepNow()
    sent.length = 0
    listening = 'earphones'

    life.toggle()
    life.report({ kind: 'sessionReady' }, openedAttempt(sent))
    life.report({ kind: 'voiceStarted' }, openedAttempt(sent))

    // On earphones the microphone stays open through her turn -- which it
    // could not do until the settings were read at the wake rather than at
    // startup.
    expect(life.micOpen).toBe(true)
    // And `stop()` is the same defect a second time: it latches `stopped`
    // before delivering, so a throw there left the attempt live and `micOpen`
    // true permanently, because every later stop returns at the guard.
    expect(() => life.stop()).not.toThrow()
  })
})

describe('the opening line', () => {
  it('is spoken for an ordinary companion', () => {
    const { view, sent } = harness()
    const life = startLifecycle(view)
    life.toggle()
    life.report({ kind: 'sessionReady' }, openedAttempt(sent))
    const spoken = sent.filter((one) => one.kind === 'speak')
    expect(spoken).toHaveLength(1)
    life.stop()
  })

  it('is NOT spoken when a capability says its own', () => {
    // A driving capability asks for its first line through `say`, so speaking
    // a greeting as well is two utterances where one was wanted -- and the
    // greeting is the one nobody asked for. Null is how it says so; an empty
    // string would be a response with no instructions, which is the model
    // choosing what to say rather than silence.
    const { view, sent } = harness(null)
    const life = startLifecycle(view)
    life.toggle()
    life.report({ kind: 'sessionReady' }, openedAttempt(sent))
    expect(sent.filter((one) => one.kind === 'speak')).toEqual([])
    // And the microphone still opened: skipping the greeting must not skip
    // the rest of waking.
    expect(sent.some((one) => one.kind === 'mic' && one.open)).toBe(true)
    life.stop()
  })
})

describe('lifecycle attempt identity', () => {
  let live: Lifecycle | null = null

  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    live?.stop()
    live = null
    vi.useRealTimers()
  })

  it('stamps every command with the attempt it belongs to', () => {
    const { view, sent } = harness()
    live = startLifecycle(view)
    live.toggle()

    expect(sent.length).toBeGreaterThan(0)
    const attempt = openedAttempt(sent)
    // Not merely present — the SAME number on all of them. A greeting stamped
    // with a different attempt than its open would be dropped by the renderer.
    for (const command of sent) expect(command.attempt).toBe(attempt)
  })

  it('promotes to awake on a ready from the current attempt', () => {
    const { view, sent, phases } = harness()
    live = startLifecycle(view)
    live.toggle()
    expect(live.phase).toBe('waking')

    live.report({ kind: 'sessionReady' }, openedAttempt(sent))
    expect(live.phase).toBe('awake')
    expect(phases).toContain('awake')
  })

  it('ignores a ready from a superseded attempt', () => {
    const { view, sent } = harness()
    live = startLifecycle(view)
    live.toggle()
    const stale = openedAttempt(sent)

    // Abandon it and start a fresh one, so the lifecycle is waking on attempt
    // B when attempt A finally connects.
    //
    // The overlap is what makes this discriminating. An earlier version of this
    // test asserted from `asleep`, where a `sessionReady` is a no-op whether or
    // not the gate exists -- it passed with the gate deleted, which makes it a
    // reassurance rather than a test.
    live.toggle()
    live.toggle()
    expect(live.phase).toBe('waking')
    expect(sent.filter((c) => c.kind === 'open').at(-1)?.attempt).not.toBe(stale)

    // Attempt A announces itself. Ungated, it would promote attempt B to awake
    // over a session that A owns and B knows nothing about.
    live.report({ kind: 'sessionReady' }, stale)
    expect(live.phase).toBe('waking')
  })

  it('ignores a failure from a superseded attempt', () => {
    const { view, sent } = harness()
    live = startLifecycle(view)
    live.toggle()
    const stale = openedAttempt(sent)
    live.toggle()
    live.toggle() // a fresh open, with a new number

    const fresh = sent.filter((c) => c.kind === 'open').at(-1)?.attempt
    expect(fresh).not.toBe(stale)

    // The loser's failure must not tear down the winner.
    live.report({ kind: 'sessionFailed' }, stale)
    expect(live.phase).toBe('waking')
  })

  it('gives each open a distinct attempt', () => {
    const { view, sent } = harness()
    live = startLifecycle(view)
    live.toggle()
    live.toggle()
    live.toggle()

    const opens = sent.filter((c) => c.kind === 'open').map((c) => c.attempt)
    expect(opens.length).toBe(2)
    expect(new Set(opens).size).toBe(opens.length)
  })

  it('handles a session lost after ready, which a failed report could not', () => {
    const { view, sent } = harness()
    live = startLifecycle(view)
    live.toggle()
    const attempt = openedAttempt(sent)
    live.report({ kind: 'sessionReady' }, attempt)
    expect(live.phase).toBe('awake')

    // The distinction this event exists for. `sessionFailed` is only handled
    // while waking, so before the split this drop was discarded and left the
    // app awake over a session that no longer existed.
    live.report({ kind: 'sessionLost' }, attempt)
    expect(live.phase).toBe('asleep')
    expect(live.micOpen).toBe(false)
  })

  it('stops idempotently and reports a settled state afterwards', () => {
    const { view, sent } = harness()
    live = startLifecycle(view)
    live.toggle()
    live.report({ kind: 'sessionReady' }, openedAttempt(sent))

    live.stop()
    const afterFirst = sent.length
    live.stop()

    // A second stop used to resend `close` and leave `micOpen` reporting a
    // microphone attached to a session that was already gone.
    expect(sent.length).toBe(afterFirst)
    expect(live.micOpen).toBe(false)
    expect(live.phase).toBe('asleep')
    live = null
  })

  it('does not let a report revive a stopped lifecycle', () => {
    const { view, sent } = harness()
    live = startLifecycle(view)
    live.toggle()
    const attempt = openedAttempt(sent)
    live.stop()

    live.report({ kind: 'sessionReady' }, attempt)
    expect(live.phase).toBe('asleep')
    live = null
  })

  it('wakes and then times out without a ready', () => {
    const { view } = harness()
    live = startLifecycle(view)
    live.toggle()
    expect(live.phase).toBe('waking')

    // The window in which a stale attempt is still running. Nothing reports,
    // so the deadline is what ends it.
    vi.advanceTimersByTime(DEFAULT_SETTINGS.wakeMs + 1_000)
    expect(live.phase).toBe('asleep')
  })
})

describe('sleepNow, which a persona switch uses', () => {
  // Every lifecycle here is interval-backed. Left running, its timer outlives
  // the test and can drive state into the next one -- the kind of leak that
  // shows up as a suite that passes alone and fails in a full run.
  const running: Lifecycle[] = []
  const start = (view: LifecycleView): Lifecycle => {
    const lifecycle = startLifecycle(view)
    running.push(lifecycle)
    return lifecycle
  }
  afterEach(() => {
    for (const lifecycle of running) lifecycle.stop()
    running.length = 0
  })

  it('closes the session and returns to asleep', () => {
    const { view, sent, phases } = harness()
    const lifecycle = start(view)
    lifecycle.toggle()
    lifecycle.report({ kind: 'sessionReady' }, lifecycle.attempt)
    expect(lifecycle.phase).toBe('awake')

    lifecycle.sleepNow()

    expect(lifecycle.phase).toBe('asleep')
    expect(lifecycle.micOpen).toBe(false)
    expect(sent.filter((c) => c.kind === 'close')).toHaveLength(1)
    // ANNOUNCED. A phase that changes without telling the views leaves the
    // tray offering "Let her sleep" over a companion already asleep.
    expect(phases.at(-1)).toBe('asleep')
  })

  it('retires the attempt, so the old session cannot wake the new persona', () => {
    const { view } = harness()
    const lifecycle = start(view)
    lifecycle.toggle()
    const stale = lifecycle.attempt

    lifecycle.sleepNow()
    // The report the closed session still had in flight. It carries the old
    // number, so it is dropped -- this is the whole reason the attempt is
    // retired here rather than left alone.
    lifecycle.report({ kind: 'sessionReady' }, stale)

    expect(lifecycle.phase).toBe('asleep')
  })

  it('does nothing when she is already asleep, and leaves her wakeable', () => {
    const { view, sent } = harness()
    const lifecycle = start(view)

    lifecycle.sleepNow()
    expect(sent).toHaveLength(0)

    // NOT `stop()`. That one latches, because it exists for quit -- borrowing
    // it for a switch would leave her unable to wake for the rest of the run.
    lifecycle.toggle()
    expect(lifecycle.phase).toBe('waking')
  })
})

describe('a persona switch is answerable from every phase', () => {
  // The plan asked for this and it was not written: `sleepNow` was exercised
  // from `awake` and `asleep` only. A switch can arrive at any moment -- the
  // tray is always there -- so `waking` and `farewell` are not edge cases,
  // they are two of the four states she is ever in.
  const running: Lifecycle[] = []
  const start = (view: LifecycleView): Lifecycle => {
    const lifecycle = startLifecycle(view)
    running.push(lifecycle)
    return lifecycle
  }
  afterEach(() => {
    for (const lifecycle of running) lifecycle.stop()
    running.length = 0
  })

  it('returns to asleep from waking, before the session ever opened', () => {
    const { view, sent } = harness()
    const lifecycle = start(view)
    lifecycle.toggle()
    expect(lifecycle.phase).toBe('waking')

    lifecycle.sleepNow()

    expect(lifecycle.phase).toBe('asleep')
    // The open is still in flight. Closing it is what stops a `ready` landing
    // afterwards and waking the persona we just switched away from.
    expect(sent.filter((c) => c.kind === 'close')).toHaveLength(1)
  })

  it('drops a ready that arrives after a switch during waking', () => {
    const { view } = harness()
    const lifecycle = start(view)
    lifecycle.toggle()
    const stale = lifecycle.attempt

    lifecycle.sleepNow()
    lifecycle.report({ kind: 'sessionReady' }, stale)

    // The whole point of retiring the attempt: the session that was opening
    // for the PREVIOUS persona cannot mark the new one awake.
    expect(lifecycle.phase).toBe('asleep')
  })

  it('returns to asleep from farewell, cutting the goodbye short', () => {
    const { view } = harness()
    const lifecycle = start(view)
    lifecycle.toggle()
    lifecycle.report({ kind: 'sessionReady' }, lifecycle.attempt)
    lifecycle.toggle()
    expect(lifecycle.phase).toBe('farewell')

    lifecycle.sleepNow()

    // Cut short deliberately. Waiting for one character to finish saying
    // goodbye before another can appear would make the switch feel broken,
    // and the goodbye belongs to the persona being left.
    expect(lifecycle.phase).toBe('asleep')
    expect(lifecycle.micOpen).toBe(false)
  })

  it('leaves her wakeable after a switch from any phase', () => {
    for (const reach of [
      (l: Lifecycle) => l.toggle(),
      (l: Lifecycle) => {
        l.toggle()
        l.report({ kind: 'sessionReady' }, l.attempt)
      },
    ]) {
      const { view } = harness()
      const lifecycle = start(view)
      reach(lifecycle)
      lifecycle.sleepNow()
      // NOT `stop()`. Borrowing that for a switch would leave her unable to
      // wake for the rest of the run.
      lifecycle.toggle()
      expect(lifecycle.phase).toBe('waking')
    }
  })
})

/**
 * What the app asks her to say is never a reply, and must not read the turn it
 * would otherwise continue.
 *
 * Observed on a live session: pressing sleep mid-lesson produced "Great! Let's
 * go with a basic question first… now give that a try, and I'll listen to your
 * pronunciation." She had answered her own last question instead of saying
 * goodbye, and the sleep key read as broken. The comment on `ALONE` in
 * `@shared/utterance` had already described this exact failure for the drill,
 * one feature earlier — which is why this is pinned as a rule rather than
 * fixed once.
 */
describe('an utterance the app asks for', () => {
  function spoken(
    sent: readonly VoiceCommand[],
  ): readonly Extract<VoiceCommand, { kind: 'speak' }>[] {
    return sent.filter((command) => command.kind === 'speak')
  }

  it('never reads the conversation, for the greeting or the goodbye', () => {
    const { view, sent } = harness()
    const life = startLifecycle(view, () => DEFAULT_SETTINGS)
    life.toggle()
    life.report({ kind: 'sessionReady' }, openedAttempt(sent))
    life.toggle()

    const said = spoken(sent)
    expect(said.length, 'expected a greeting and a goodbye').toBe(2)
    for (const command of said) {
      expect(command.isolation.reads, JSON.stringify(command.instructions)).toBe(false)
    }
  })

  it('is still remembered, so the record of what she said is true', () => {
    // `reads` and `writes` are separate dimensions and were once joined by an
    // `&&`. Turning the goodbye's context off must not also throw the goodbye
    // itself out of the conversation.
    const { view, sent } = harness()
    const life = startLifecycle(view, () => DEFAULT_SETTINGS)
    life.toggle()
    life.report({ kind: 'sessionReady' }, openedAttempt(sent))
    life.toggle()

    for (const command of spoken(sent)) expect(command.isolation.writes).toBe(true)
  })
})

/**
 * Teardown must not depend on a window still being there.
 *
 * `view.command` reaches a renderer that may have gone away mid-teardown, and
 * it used to run BEFORE the attempt was retired and the microphone flag
 * cleared. A throw escaped `apply`, so both stayed as they were: a live
 * microphone with no session — the one state this module says is unreachable —
 * and `onChanged` skipped, so the tray went on showing "listening".
 */
describe('closing when the window has gone', () => {
  it('retires the attempt and shuts the microphone even if delivery throws', () => {
    const seen: Array<{ phase: string; micOpen: boolean }> = []
    const life = startLifecycle(
      {
        ...harness().view,
        command: (command) => {
          if (command.kind === 'close') throw new Error('the window is gone')
        },
        onChanged: (state, micOpen) => seen.push({ phase: state.phase, micOpen }),
      },
      () => DEFAULT_SETTINGS,
    )

    life.toggle()
    life.report({ kind: 'sessionReady' }, life.attempt)
    const openAttempt = life.attempt
    expect(life.phase).toBe('awake')

    // Sleep her. The close command throws on the way out.
    expect(() => life.toggle()).not.toThrow()
    life.report({ kind: 'voiceStarted' }, life.attempt)
    life.report({ kind: 'voiceStopped' }, life.attempt)

    expect(life.phase).toBe('asleep')
    expect(life.attempt, 'the attempt was not retired').not.toBe(openAttempt)
    expect(seen.at(-1), 'the observer never heard about it').toEqual({
      phase: 'asleep',
      micOpen: false,
    })
    life.stop()
  })
})

/**
 * The sound pane promises, in so many words, that these apply the next time she
 * wakes. `step` consults `listening` on `voiceStarted`, `voiceStopped` and
 * `loopback`, so reading it live moved the microphone under a turn already in
 * flight — the sentence in the window was untrue in the direction that
 * interrupts her.
 */
describe('a sound setting changed mid-conversation', () => {
  it('waits for the next wake, unlike the idle timeout', () => {
    const { view, sent } = harness()
    let listening: 'auto' | 'speaker' | 'earphones' = 'earphones'
    const life = startLifecycle(view, () => ({ ...DEFAULT_SETTINGS, listening }))

    life.toggle()
    life.report({ kind: 'sessionReady' }, life.attempt)
    // On earphones the microphone stays open while she speaks.
    life.report({ kind: 'voiceStarted' }, life.attempt)
    expect(sent.filter((c) => c.kind === 'mic').length, 'gated on earphones').toBe(1)

    // The user switches to speaker WHILE she is talking.
    listening = 'speaker'
    life.report({ kind: 'voiceStopped' }, life.attempt)
    life.report({ kind: 'voiceStarted' }, life.attempt)
    expect(
      sent.filter((c) => c.kind === 'mic' && !c.open).length,
      'the microphone moved under a turn already in flight',
    ).toBe(0)

    // The next wake picks it up.
    life.sleepNow()
    life.toggle()
    life.report({ kind: 'sessionReady' }, life.attempt)
    life.report({ kind: 'voiceStarted' }, life.attempt)
    expect(sent.filter((c) => c.kind === 'mic' && !c.open).length).toBe(1)
    life.stop()
  })
})
