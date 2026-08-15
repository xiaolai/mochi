import { describe, expect, it } from 'vitest'
import {
  DEFAULT_IDLE_MS,
  DEFAULT_SETTINGS,
  initial,
  step,
  type CompanionEvent,
  type CompanionState,
  type Effect,
  type Phase,
} from './companion'

/** Drive a sequence of [event, time] pairs and keep every effect emitted. */
function run(
  events: ReadonlyArray<readonly [Exclude<CompanionEvent['kind'], 'loopback' | 'working'>, number]>,
  from: CompanionState = initial(0),
): { state: CompanionState; effects: Effect[] } {
  let state = from
  const effects: Effect[] = []
  for (const [kind, at] of events) {
    const result = step(state, { kind }, at)
    state = result.state
    effects.push(...result.effects)
  }
  return { state, effects }
}

const kinds = (effects: readonly Effect[]): string[] =>
  effects.map((e) => (e.kind === 'mic' ? `mic:${e.open ? 'open' : 'shut'}` : e.kind))

/** Wake her and get to a live session at t=1000. */
const awake = (): CompanionState =>
  run([
    ['toggle', 0],
    ['sessionReady', 1000],
  ]).state

describe('waking', () => {
  it('opens a session on the shortcut', () => {
    const { state, effects } = run([['toggle', 0]])
    expect(state.phase).toBe('waking')
    expect(kinds(effects)).toEqual(['openSession'])
  })

  it('opens the microphone before greeting', () => {
    // Order matters: barge-in is the server's job and it needs the audio to
    // judge it, so she must be interruptible from her first word.
    const { state, effects } = run([
      ['toggle', 0],
      ['sessionReady', 900],
    ])
    expect(state.phase).toBe('awake')
    expect(kinds(effects)).toEqual(['openSession', 'mic:open', 'greet'])
  })

  it('a second press during the wake means never mind', () => {
    const { state, effects } = run([
      ['toggle', 0],
      ['toggle', 200],
    ])
    expect(state.phase).toBe('asleep')
    expect(kinds(effects)).toEqual(['openSession', 'closeSession'])
  })

  it('gives up if the session never opens', () => {
    const { state } = run([
      ['toggle', 0],
      ['tick', DEFAULT_SETTINGS.wakeMs - 1],
    ])
    expect(state.phase).toBe('waking')
    const { state: after } = run([
      ['toggle', 0],
      ['tick', DEFAULT_SETTINGS.wakeMs],
    ])
    expect(after.phase).toBe('asleep')
  })

  it('goes back to sleep if the session fails', () => {
    const { state, effects } = run([
      ['toggle', 0],
      ['sessionFailed', 500],
    ])
    expect(state.phase).toBe('asleep')
    expect(kinds(effects)).toContain('closeSession')
  })
})

describe('the farewell', () => {
  it('shuts the microphone BEFORE asking for the goodbye', () => {
    // She is signing off, not inviting a reply, and "already stopped
    // listening" is the honest signal — the tray shows it immediately.
    const { state, effects } = step(awake(), { kind: 'toggle' }, 2000)
    expect(state.phase).toBe('farewell')
    expect(kinds(effects)).toEqual(['mic:shut', 'farewell'])
  })

  it('waits for the audio to finish, not for the request to complete', () => {
    // The bug this whole module exists to prevent. `response.done` fires ~2.1s
    // before her audio stops playing, so teardown keyed to the wire event cuts
    // her off mid-word every single time.
    let state = step(awake(), { kind: 'toggle' }, 2000).state
    state = step(state, { kind: 'voiceStarted' }, 2900).state
    expect(state.phase).toBe('farewell')

    const done = step(state, { kind: 'voiceStopped' }, 4500)
    expect(done.state.phase).toBe('asleep')
    expect(kinds(done.effects)).toEqual(['closeSession'])
  })

  it('does not close on the sentence she was interrupted in', () => {
    // Toggled mid-sentence: that utterance ending is not the goodbye. Without
    // `farewellBegun` she is cut off by the very mechanism meant to let her
    // finish — and only in the case where she happened to be talking.
    let state = awake()
    state = step(state, { kind: 'voiceStarted' }, 1500).state
    state = step(state, { kind: 'toggle' }, 2000).state
    expect(state.phase).toBe('farewell')

    // The interrupted sentence stops. Still farewell.
    state = step(state, { kind: 'voiceStopped' }, 2100).state
    expect(state.phase).toBe('farewell')

    // Now the actual goodbye.
    state = step(state, { kind: 'voiceStarted' }, 3000).state
    state = step(state, { kind: 'voiceStopped' }, 4200).state
    expect(state.phase).toBe('asleep')
  })

  it('closes anyway if the goodbye never finishes', () => {
    // A companion you cannot turn off is worse than an abrupt goodbye.
    let state = step(awake(), { kind: 'toggle' }, 2000).state
    state = step(state, { kind: 'voiceStarted' }, 2500).state
    const stuck = step(state, { kind: 'tick' }, 2000 + DEFAULT_SETTINGS.farewellMs)
    expect(stuck.state.phase).toBe('asleep')
    expect(kinds(stuck.effects)).toEqual(['closeSession'])
  })

  it('closes anyway if the goodbye never even starts', () => {
    const state = step(awake(), { kind: 'toggle' }, 2000).state
    const stuck = step(state, { kind: 'tick' }, 2000 + DEFAULT_SETTINGS.farewellMs)
    expect(stuck.state.phase).toBe('asleep')
  })

  it('the shortcut cancels it and reopens the microphone', () => {
    // "Wait, come back."
    const state = step(awake(), { kind: 'toggle' }, 2000).state
    const back = step(state, { kind: 'toggle' }, 2400)
    expect(back.state.phase).toBe('awake')
    expect(kinds(back.effects)).toEqual(['mic:open'])
  })

  it('a cancelled farewell can be started again cleanly', () => {
    // `farewellBegun` must not survive the round trip, or the second goodbye
    // closes on the first stop it sees.
    let state = step(awake(), { kind: 'toggle' }, 2000).state
    state = step(state, { kind: 'voiceStarted' }, 2500).state
    state = step(state, { kind: 'toggle' }, 2600).state
    expect(state.phase).toBe('awake')
    state = step(state, { kind: 'toggle' }, 3000).state
    expect(state.farewellBegun).toBe(false)
    state = step(state, { kind: 'voiceStopped' }, 3100).state
    expect(state.phase, 'closed on a stale stop').toBe('farewell')
  })
})

describe('the microphone while she is talking', () => {
  const speaks = (settings: typeof DEFAULT_SETTINGS) => {
    const started = step(awake(), { kind: 'voiceStarted' }, 1100, settings)
    const stopped = step(started.state, { kind: 'voiceStopped' }, 3000, settings)
    return { started: kinds(started.effects), stopped: kinds(stopped.effects) }
  }

  it('closes it while she speaks and opens it again when she stops', () => {
    // On a laptop speaker her own voice reaches the microphone, echo
    // cancellation removes most of it rather than all of it, and what survives
    // is speech-shaped enough for the server to score as a turn. She stops
    // mid-sentence to listen to herself.
    const { started, stopped } = speaks({ ...DEFAULT_SETTINGS, listening: 'speaker' })
    expect(started).toEqual(['mic:shut'])
    expect(stopped).toEqual(['mic:open'])
  })

  it('leaves it open when somebody has said they are on earphones', () => {
    // Through earphones the loop does not exist, and an open microphone is the
    // better conversation -- she can be interrupted mid-sentence.
    const { started, stopped } = speaks({ ...DEFAULT_SETTINGS, listening: 'earphones' })
    expect(started).toEqual([])
    expect(stopped).toEqual([])
  })

  it('assumes echo until it has listened, so the greeting is safe', () => {
    // `auto` with no verdict yet. The measurement needs her to have SPOKEN, so
    // the first utterance is judged with no evidence -- and the greeting is
    // the first thing anybody hears. Guessing "keep listening" there costs
    // exactly the failure this exists to prevent; guessing the other way costs
    // one uninterruptible sentence.
    const { started } = speaks({ ...DEFAULT_SETTINGS, listening: 'auto' })
    expect(started).toEqual(['mic:shut'])
  })

  it('opens up once it has heard that there is no echo', () => {
    const settings = { ...DEFAULT_SETTINGS, listening: 'auto' } as const
    const heard = step(awake(), { kind: 'loopback', present: false }, 1050, settings)
    expect(heard.state.loopback).toBe(false)
    const started = step(heard.state, { kind: 'voiceStarted' }, 1100, settings)
    expect(kinds(started.effects)).toEqual([])
  })

  it('closes up again when the earphones come out mid-conversation', () => {
    // The reason the verdict is an EVENT rather than a setting read once:
    // plugging and unplugging happens during a conversation, and the answer
    // has to be allowed to change under it.
    const settings = { ...DEFAULT_SETTINGS, listening: 'auto' } as const
    let state = step(awake(), { kind: 'loopback', present: false }, 1050, settings).state
    state = step(state, { kind: 'loopback', present: true }, 2000, settings).state
    expect(kinds(step(state, { kind: 'voiceStarted' }, 2100, settings).effects)).toEqual([
      'mic:shut',
    ])
  })

  it('opens the microphone when the verdict lands WHILE she is speaking', () => {
    // The only way the first verdict can ever arrive. Measuring correlation
    // needs her to be audible, so the answer cannot exist until she has
    // started -- which means the greeting always closes the microphone on
    // "assume echo" and always learns better half-way through.
    //
    // Observed live on 2026-08-14: mic closed at +7719ms, verdict "no echo" at
    // +8623ms, her audio draining at +16568ms. The state carried the new
    // verdict, `voiceStopped` consulted it, found gating unwanted, and emitted
    // nothing -- so the close was never undone and she could not be spoken to
    // for the rest of the session.
    const settings = { ...DEFAULT_SETTINGS, listening: 'auto' } as const
    const started = step(awake(), { kind: 'voiceStarted' }, 1100, settings)
    expect(kinds(started.effects), 'unknown means assume echo').toEqual(['mic:shut'])

    const verdict = step(started.state, { kind: 'loopback', present: false }, 1200, settings)
    expect(kinds(verdict.effects), 'the close was never undone').toEqual(['mic:open'])

    // And the ordinary path still holds afterwards: no double-open when she
    // stops, because gating is no longer wanted at all.
    const stopped = step(verdict.state, { kind: 'voiceStopped' }, 1300, settings)
    expect(kinds(stopped.effects)).toEqual([])
  })

  it('closes it when the verdict turns against her mid-sentence', () => {
    // The same transition the other way: earphones pulled out while she talks.
    const settings = { ...DEFAULT_SETTINGS, listening: 'auto' } as const
    let state = step(awake(), { kind: 'loopback', present: false }, 1050, settings).state
    state = step(state, { kind: 'voiceStarted' }, 1100, settings).state
    const verdict = step(state, { kind: 'loopback', present: true }, 1200, settings)
    expect(kinds(verdict.effects)).toEqual(['mic:shut'])
  })

  it('says nothing when the verdict repeats itself', () => {
    // Same decision, no effect. Otherwise every repeated measurement would
    // toggle the microphone while she is mid-word.
    const settings = { ...DEFAULT_SETTINGS, listening: 'auto' } as const
    let state = step(awake(), { kind: 'loopback', present: false }, 1050, settings).state
    state = step(state, { kind: 'voiceStarted' }, 1100, settings).state
    expect(
      kinds(step(state, { kind: 'loopback', present: false }, 1200, settings).effects),
    ).toEqual([])
  })

  it('lets a person overrule the measurement in both directions', () => {
    // A measurement can be wrong, and the person in the room is the authority.
    const measured = { kind: 'loopback', present: true } as const
    const onEarphones = { ...DEFAULT_SETTINGS, listening: 'earphones' } as const
    const state = step(awake(), measured, 1050, onEarphones).state
    expect(kinds(step(state, { kind: 'voiceStarted' }, 1100, onEarphones).effects)).toEqual([])

    const onSpeakers = { ...DEFAULT_SETTINGS, listening: 'speaker' } as const
    const quiet = step(awake(), { kind: 'loopback', present: false }, 1050, onSpeakers).state
    expect(kinds(step(quiet, { kind: 'voiceStarted' }, 1100, onSpeakers).effects)).toEqual([
      'mic:shut',
    ])
  })

  it('does not reopen it during the farewell', () => {
    // The goodbye closes the microphone on purpose -- she is signing off, not
    // inviting a reply. A `voiceStopped` arriving there must not undo that,
    // which is why the gate lives in `awake` alone.
    const goodbye = step(awake(), { kind: 'toggle' }, 2000)
    expect(kinds(goodbye.effects)).toEqual(['mic:shut', 'farewell'])
    const started = step(goodbye.state, { kind: 'voiceStarted' }, 2100)
    const stopped = step(started.state, { kind: 'voiceStopped' }, 4000)
    expect(kinds([...started.effects, ...stopped.effects])).not.toContain('mic:open')
  })
})

/**
 * Saying goodbye while she is already talking.
 *
 * The session refuses a `speak` while one is sounding, so asking for the
 * goodbye mid-sentence does not arrive early — it comes back `failed` and the
 * goodbye is gone. The machine then waited out `farewellMs` and slept in
 * silence, which reads as her ignoring the shortcut.
 */
describe('a goodbye asked for mid-sentence', () => {
  const speaking = (): CompanionState => step(awake(), { kind: 'voiceStarted' }, 1100).state

  it('is held until she stops, rather than lost', () => {
    const begun = step(speaking(), { kind: 'toggle' }, 1200)
    expect(begun.state.phase).toBe('farewell')
    // The microphone shuts immediately — she is signing off either way.
    expect(kinds(begun.effects)).toEqual(['mic:shut'])

    const stopped = step(begun.state, { kind: 'voiceStopped' }, 4000)
    expect(kinds(stopped.effects), 'the goodbye was never asked for').toEqual(['farewell'])
    expect(stopped.state.phase, 'slept before saying it').toBe('farewell')
  })

  /**
   * The deadline that was running measured her PREVIOUS sentence. Leaving it
   * would give the goodbye whatever was left of it — often nothing.
   */
  it('restarts the deadline when the goodbye is finally asked for', () => {
    const begun = step(speaking(), { kind: 'toggle' }, 1200)
    const stopped = step(begun.state, { kind: 'voiceStopped' }, 1200 + DEFAULT_SETTINGS.farewellMs)
    expect(stopped.state.phase).toBe('farewell')

    // A tick just after would have slept had `since` not moved.
    const soon = step(stopped.state, { kind: 'tick' }, 1200 + DEFAULT_SETTINGS.farewellMs + 10)
    expect(soon.state.phase).toBe('farewell')
  })

  /**
   * Audio already in flight when the toggle landed is NOT the goodbye. Treating
   * it as proof would sleep on the wrong utterance ending, with the goodbye
   * never spoken at all.
   */
  it('does not mistake the sentence she was already saying for the goodbye', () => {
    const begun = step(speaking(), { kind: 'toggle' }, 1200)
    // Late audio from the response that was already generating.
    const late = step(begun.state, { kind: 'voiceStarted' }, 1250)
    expect(late.state.farewellBegun, 'credited the wrong utterance').toBe(false)

    const stopped = step(late.state, { kind: 'voiceStopped' }, 2000)
    expect(stopped.state.phase, 'slept without saying goodbye').toBe('farewell')
    expect(kinds(stopped.effects)).toEqual(['farewell'])
  })

  /** And once it IS the goodbye, her finishing ends the session. */
  it('sleeps when the goodbye itself finishes', () => {
    const begun = step(speaking(), { kind: 'toggle' }, 1200)
    const asked = step(begun.state, { kind: 'voiceStopped' }, 2000).state
    const said = step(asked, { kind: 'voiceStarted' }, 2100)
    expect(said.state.farewellBegun).toBe(true)
    expect(step(said.state, { kind: 'voiceStopped' }, 3000).state.phase).toBe('asleep')
  })

  /**
   * A companion you cannot turn off is worse than an abrupt goodbye. A sentence
   * that never ends must still end the session.
   */
  it('still sleeps on the deadline when she never stops talking', () => {
    const begun = step(speaking(), { kind: 'toggle' }, 1200)
    const late = step(begun.state, { kind: 'tick' }, 1200 + DEFAULT_SETTINGS.farewellMs)
    expect(late.state.phase).toBe('asleep')
    expect(kinds(late.effects)).toEqual(['closeSession'])
  })
})

describe('the idle timeout', () => {
  it('sleeps after silence', () => {
    const state = step(awake(), { kind: 'tick' }, 1000 + DEFAULT_IDLE_MS)
    expect(state.state.phase).toBe('farewell')
    expect(kinds(state.effects)).toEqual(['mic:shut', 'farewell'])
  })

  it('never fires while she is mid-sentence', () => {
    let state = step(awake(), { kind: 'voiceStarted' }, 1200).state
    const late = step(state, { kind: 'tick' }, 1200 + DEFAULT_IDLE_MS * 5)
    expect(late.state.phase, 'interrupted her').toBe('awake')

    // And it does fire once she stops.
    state = step(state, { kind: 'voiceStopped' }, 5000).state
    const after = step(state, { kind: 'tick' }, 5000 + DEFAULT_IDLE_MS)
    expect(after.state.phase).toBe('farewell')
  })

  /**
   * `null` is the setting's "never", and it has to mean never rather than
   * "much later". A finite stand-in -- `Infinity`, or some very large number --
   * would read as correct at the comparison and eventually elapse anyway, so
   * the case worth asserting is a long way past any plausible substitute.
   */
  it('never sleeps when the choice is never', () => {
    const settings = { ...DEFAULT_SETTINGS, idleMs: null } as const
    const state = step(awake(), { kind: 'tick' }, 1000 + DEFAULT_IDLE_MS * 10_000, settings)
    expect(state.state.phase).toBe('awake')
    expect(state.effects).toEqual([])
  })

  /** The longer choices are the reason this is a setting, so one is driven. */
  it('waits the chosen duration rather than the default', () => {
    const settings = { ...DEFAULT_SETTINGS, idleMs: 1_800_000 } as const
    const early = step(awake(), { kind: 'tick' }, 1000 + DEFAULT_IDLE_MS + 1, settings)
    expect(early.state.phase, 'left at the default while set to thirty minutes').toBe('awake')

    const due = step(awake(), { kind: 'tick' }, 1000 + 1_800_000, settings)
    expect(due.state.phase).toBe('farewell')
  })

  it('is postponed by the user talking', () => {
    // The user has no "still talking" signal we can see — only that the server
    // heard them start — so that is what has to hold the timer off.
    let state = awake()
    for (let at = 1000; at < 1000 + DEFAULT_IDLE_MS * 3; at += 10_000) {
      state = step(state, { kind: 'userSpoke' }, at).state
      state = step(state, { kind: 'tick' }, at + 1).state
    }
    expect(state.phase).toBe('awake')
  })
})

describe('a session that goes away on its own', () => {
  it('drops her to asleep from any live phase', () => {
    for (const reach of [
      () => run([['toggle', 0]]).state,
      awake,
      () => step(awake(), { kind: 'toggle' }, 2000).state,
    ]) {
      const state = reach()
      const lost = step(state, { kind: 'sessionLost' }, 9000)
      expect(lost.state.phase, state.phase).toBe('asleep')
      expect(kinds(lost.effects)).toEqual(['closeSession'])
    }
  })

  it('is ignored when there was nothing to lose', () => {
    const lost = step(initial(0), { kind: 'sessionLost' }, 100)
    expect(lost.state.phase).toBe('asleep')
    expect(lost.effects).toEqual([])
  })
})

describe('the machine as a whole', () => {
  it('starts asleep and emits nothing', () => {
    const state = initial(0)
    expect(state.phase).toBe('asleep')
    expect(step(state, { kind: 'tick' }, 1e9).effects).toEqual([])
  })

  it('ignores every event that does not belong to its phase', () => {
    // Total over phase x event. A stray `voiceStopped` while asleep, or a
    // `sessionReady` for a session nobody opened, must do nothing rather than
    // something surprising.
    // Whole EVENTS, not kinds: one of them carries a payload, and a list of
    // kinds cannot hold it -- so the day an event grew one, the totality test
    // would have quietly stopped being total.
    const all: CompanionEvent[] = [
      { kind: 'toggle' },
      { kind: 'sessionReady' },
      { kind: 'sessionFailed' },
      { kind: 'sessionLost' },
      { kind: 'voiceStarted' },
      { kind: 'voiceStopped' },
      { kind: 'userSpoke' },
      { kind: 'tick' },
      { kind: 'loopback', present: true },
    ]
    for (const event of all) {
      expect(() => step(initial(0), event, 50), event.kind).not.toThrow()
    }
    // Only the shortcut can start anything from asleep.
    const woke = all
      .filter((event) => step(initial(0), event, 50).state.phase !== 'asleep')
      .map((event) => event.kind)
    expect(woke).toEqual(['toggle'])
  })

  it('never emits an effect without changing anything', () => {
    // An effect is a side effect. Emitting one from a no-op transition means
    // the caller opens or closes something for no reason.
    let state = initial(0)
    const seen: Phase[] = []
    for (const [kind, at] of [
      ['toggle', 0],
      ['sessionReady', 900],
      ['voiceStarted', 1000],
      ['voiceStopped', 3000],
      ['toggle', 4000],
      ['voiceStarted', 4800],
      ['voiceStopped', 6000],
    ] as const) {
      const result = step(state, { kind }, at)
      if (result.effects.length > 0) expect(result.state).not.toEqual(state)
      state = result.state
      seen.push(state.phase)
    }
    expect(seen).toEqual(['waking', 'awake', 'awake', 'awake', 'farewell', 'farewell', 'asleep'])
  })

  it('survives the shortcut being hammered', () => {
    let state = initial(0)
    for (let at = 0; at < 40; at++) state = step(state, { kind: 'toggle' }, at * 10).state
    expect(['asleep', 'waking', 'awake', 'farewell']).toContain(state.phase)
  })
})

/**
 * The idle timeout versus an errand that outlives it.
 *
 * A delegation takes 20-56 seconds and is allowed three minutes,
 * while the idle window is ninety seconds -- and during the wait nobody is
 * talking, precisely because they are waiting. So the timeout fires on silence
 * the errand itself caused, she says goodbye, and the answer arrives into a
 * session that no longer exists. The user, who pressed a key and asked a
 * question, is simply never told.
 */
describe('while something is being looked up', () => {
  const awake = (): CompanionState =>
    run([
      ['toggle', 0],
      ['sessionReady', 100],
    ]).state

  it('does not begin the farewell, however long it takes', () => {
    let state = awake()
    state = step(state, { kind: 'working', busy: true }, 200).state
    // Well past the ninety-second window, with nobody speaking.
    state = step(state, { kind: 'tick' }, 200 + DEFAULT_IDLE_MS + 60_000).state
    expect(state.phase).toBe('awake')
  })

  it('goes back to sleeping normally once the answer has arrived', () => {
    let state = awake()
    state = step(state, { kind: 'working', busy: true }, 200).state
    state = step(state, { kind: 'tick' }, 200 + DEFAULT_IDLE_MS + 1).state
    expect(state.phase).toBe('awake')

    // Finishing is activity: she is given a normal idle window to actually say
    // the answer. This assertion used to be the opposite, and it encoded the
    // bug -- the result is queued and spoken on her NEXT turn, so a farewell
    // one tick after the hold lifts means she goes quiet still holding it.
    state = step(state, { kind: 'working', busy: false }, 300_000).state
    state = step(state, { kind: 'tick' }, 300_100).state
    expect(state.phase).toBe('awake')

    // And then she leaves on the ordinary schedule, measured from the answer.
    state = step(state, { kind: 'tick' }, 300_000 + DEFAULT_IDLE_MS + 1).state
    expect(state.phase).toBe('farewell')
  })

  /**
   * Cleared in every phase, because a run outlives the phase it began in: Codex
   * can finish after a reconnect, or after she has already been sent to sleep.
   * A flag that only clears in `awake` is one that sticks on forever.
   */
  it('can be cleared from any phase', () => {
    for (const phase of ['asleep', 'waking', 'awake'] as const) {
      const base =
        phase === 'asleep' ? initial(0) : phase === 'waking' ? run([['toggle', 0]]).state : awake()
      const busy = step(base, { kind: 'working', busy: true }, 10).state
      expect(busy.working, phase).toBe(1)
      const done = step(busy, { kind: 'working', busy: false }, 20).state
      expect(done.working, phase).toBe(0)
      // And it changes no phase on its own.
      expect(done.phase, phase).toBe(base.phase)
    }
  })

  it('still lets her finish a sentence before any of this applies', () => {
    // `speaking` and `working` are independent holds; neither replaces the other.
    let state = awake()
    state = step(state, { kind: 'voiceStarted' }, 200).state
    state = step(state, { kind: 'tick' }, 200 + DEFAULT_IDLE_MS + 1).state
    expect(state.phase).toBe('awake')
  })
})

/**
 * Two errands can hold the idle timeout open at once, and the first to finish
 * must not release the hold the second still needs — she would say goodbye and
 * sleep with an answer still on its way, which is precisely what the hold
 * exists to prevent.
 */
describe('overlapping work', () => {
  const busy = (state: CompanionState, at: number, on: boolean): CompanionState =>
    step(state, { kind: 'working', busy: on }, at).state

  it('stays held until the last errand finishes', () => {
    let state = busy(busy(awake(), 1100, true), 1200, true)
    state = busy(state, 1300, false)
    expect(state.working, 'one finishing released both').toBe(1)

    const early = step(state, { kind: 'tick' }, 1300 + DEFAULT_IDLE_MS * 2)
    expect(early.state.phase, 'slept with an errand still running').toBe('awake')

    state = busy(state, 1400, false)
    expect(state.working).toBe(0)
    expect(step(state, { kind: 'tick' }, 1400 + DEFAULT_IDLE_MS).state.phase).toBe('farewell')
  })

  /**
   * An unmatched release — a teardown clearing twice, a late report from a
   * finished attempt — must not drive the count below zero and wedge the
   * timeout open forever. That failure is worse: she would never sleep, with
   * nothing on screen saying why.
   */
  it('cannot be driven negative by an unmatched release', () => {
    let state = busy(awake(), 1100, false)
    expect(state.working).toBe(0)
    state = busy(state, 1200, true)
    state = busy(state, 1300, false)
    expect(state.working).toBe(0)
    expect(step(state, { kind: 'tick' }, 1300 + DEFAULT_IDLE_MS).state.phase).toBe('farewell')
  })
})
