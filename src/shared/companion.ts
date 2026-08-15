/**
 * When she is awake, and how she goes back to sleep.
 *
 * She is not always on. A shortcut wakes her, she greets you, you talk, and she
 * says goodbye — so "which of those is happening right now" is a real thing
 * with real transitions, and it is the part where every awkward case is a
 * question about TIMING rather than about audio.
 *
 * Pure, therefore: events and a clock in, a phase and a list of effects out.
 * Nothing here opens a session, moves a microphone or draws anything; the
 * caller does that, and can be told to do it by a test instead. The cases that
 * matter cannot be produced on demand against a live session — a farewell
 * deadline expiring while audio still plays, the shortcut pressed twice in
 * 50ms, a session dying mid-wake — but they are all trivial on a number line.
 *
 * ## The one that would have been a bug
 *
 * `response.done` fires long before her audio finishes playing, and the gap
 * GROWS with the utterance -- 2.1s on a greeting, 7.9s on an eight-second
 * drill item (2026-08-14). The model generates far faster than real time, so
 * the gap is roughly the utterance's length minus however long it took to
 * generate. Citing one number made it look like a constant offset:
 * the model generates faster than real time and the client plays at 1x
 * (measured 2026-08-11). So "she has said goodbye" is not a data-channel event.
 * Teardown waits for `voiceStopped`, which comes from the analyser watching
 * what is actually sounding. Closing on the server event would cut her off
 * mid-word, every time, on the one interaction meant to feel like a clean end.
 */

import type { Listening } from './sound'
import type { MonotonicMs } from './avatar'

export type Phase =
  /** No session. She is visibly dozing, not hidden. */
  | 'asleep'
  /** Session opening. She reacts instantly here — that is what hides the dial. */
  | 'waking'
  /** Session live, microphone open. */
  | 'awake'
  /** Microphone already shut, goodbye playing, session closing after it. */
  | 'farewell'

export type CompanionEvent =
  /** The shortcut. Means something different in every phase, which is the point. */
  | { readonly kind: 'toggle' }
  | { readonly kind: 'sessionReady' }
  | { readonly kind: 'sessionFailed' }
  /** The session went away without being asked to. */
  | { readonly kind: 'sessionLost' }
  /** Her audio began sounding. From the analyser, not from the wire. */
  | { readonly kind: 'voiceStarted' }
  /** Her audio finished sounding. From the analyser, NOT from `response.done`. */
  | { readonly kind: 'voiceStopped' }
  /** What the renderer measured about this room. See `audio/loopback.ts`. */
  | { readonly kind: 'loopback'; readonly present: boolean }
  /** The server's turn detector heard the user. */
  | { readonly kind: 'userSpoke' }
  /** Time passing. The only thing that can fire a timeout. */
  | { readonly kind: 'tick' }
  /**
   * A delegation started or finished.
   *
   * It exists for one reason: a Codex run takes 20-56 seconds and is allowed
   * three minutes, while the idle timeout is ninety seconds and
   * nobody is talking during the wait. So she would say goodbye and sleep with
   * the answer still coming, and it would arrive into a session that no longer
   * exists. The user, who pressed a key and asked a question, would simply
   * never be told.
   */
  | { readonly kind: 'working'; readonly busy: boolean }

export type Effect =
  | { readonly kind: 'openSession' }
  | { readonly kind: 'closeSession' }
  /** Ask her to greet. Carries the persona's opening line at the call site. */
  | { readonly kind: 'greet' }
  | { readonly kind: 'farewell' }
  | { readonly kind: 'mic'; readonly open: boolean }

/**
 * How long she waits before sleeping, as the values the pane offers.
 *
 * A FIXED SET rather than a number, and the reason is not the validation it
 * saves. The useful values are not evenly spread -- they bunch at the short end
 * and then jump -- so a free field's extra reach is reach into values nobody
 * wants, bought at the price of a bound to defend and a unit to argue about.
 * The current default is ninety seconds, which is not a whole number of minutes
 * either; a minutes field would have moved the default to suit the widget.
 *
 * `null` is "never", and it is the expensive one: an open Realtime session
 * bills for what it listens to, so a companion that never sleeps is a meter
 * that never stops. It is offered rather than withheld -- the same stance the
 * `anytime` delegation trigger takes -- and the pane states the
 * price beside it.
 */
export const IDLE_CHOICES = [90_000, 180_000, 600_000, 1_800_000, null] as const

/**
 * The default, as a NUMBER rather than as an `IdleChoice`.
 *
 * Named separately because `IdleChoice` includes `null`, so anything that wants
 * to do arithmetic with the default -- "advance the clock past it" -- would
 * otherwise have to assert it non-null at every site. The assertion would be
 * true and it would be a claim; this is the same fact stated once, where the
 * type checker can hold it.
 *
 * DERIVED from the tuple rather than repeating `90_000`. The first version
 * wrote the literal twice while this very comment claimed the fact was stated
 * once -- two values that must agree, with nothing that fails when they stop
 * agreeing. Reading position 0 keeps the claim true, and the tuple's `as const`
 * makes the type the literal rather than `number`.
 */
export const DEFAULT_IDLE_MS = IDLE_CHOICES[0]
export type IdleChoice = (typeof IDLE_CHOICES)[number]

/**
 * The same choices as `<select>` values, DERIVED rather than written out.
 *
 * `select` keys by `string`, and these are numbers and a `null`. The obvious
 * fix -- a second tuple of ids beside `IDLE_CHOICES` -- is the parallel array
 * this project keeps finding in its own bugs: two lists that must agree, with
 * nothing that fails when they stop agreeing. A template literal over the value
 * type gives exactly the keys the values produce, so adding a duration to
 * `IDLE_CHOICES` widens this and breaks the i18n record until it is translated.
 */
export type IdleKey = `${NonNullable<IdleChoice>}` | 'never'

export function idleKey(choice: IdleChoice): IdleKey {
  // No cast: the template literal over the narrowed numeric union IS `IdleKey`,
  // which is the whole reason the type is written that way rather than as a
  // hand-kept list of strings.
  return choice === null ? 'never' : `${choice}`
}

/**
 * Back again. Total, because the caller has a key from `idleKey`.
 *
 * `findIndex`, NOT `find() ?? default`. The first version was the latter, and
 * it was wrong on exactly one input: `null` is a MEMBER here rather than a
 * miss, so `??` replaced the found value with the default and "never" silently
 * became ninety seconds. That is the single worst way this could fail -- the
 * user picks never, the pane shows never, and she leaves after a minute and a
 * half -- and it survived review; the round-trip test is what caught it.
 *
 * The fallback is unreachable through the pane, since a `<select>` only reports
 * one of the options it was built from. It exists because the alternative is a
 * non-null assertion, which would be a claim rather than a behaviour, and main
 * validates independently with `isIdleChoice` anyway.
 */
export function idleFromKey(key: string): IdleChoice {
  // A loop rather than `find` or `findIndex`. `find` has the `??` trap above;
  // `findIndex` then needs `IDLE_CHOICES[at]`, which `noUncheckedIndexedAccess`
  // correctly types as possibly `undefined` and which would need the assertion
  // this is avoiding. Returning from inside the loop needs neither.
  for (const choice of IDLE_CHOICES) {
    if (idleKey(choice) === key) return choice
  }
  return DEFAULT_IDLE_MS
}

/**
 * The allowed values as a list, for a refusal message.
 *
 * Derived from the tuple rather than written out, so adding a choice cannot
 * leave the refusal describing the old set. Not user-facing prose -- it reaches
 * a `SaveProblem`, which only a crafted message can provoke -- so it is not in
 * `i18n/`.
 */
export function describeIdleChoices(): string {
  return IDLE_CHOICES.map((choice) => (choice === null ? 'null' : String(choice))).join(', ')
}

export function isIdleChoice(value: unknown): value is IdleChoice {
  if (value === null) return true
  // `includes` on the tuple would need a cast that also admits any number.
  // Checked against the members instead, so a stored `120000` -- a plausible
  // hand-edit -- is rejected rather than silently accepted as a choice the pane
  // cannot display.
  return typeof value === 'number' && (IDLE_CHOICES as readonly (number | null)[]).includes(value)
}

export interface CompanionSettings {
  /** Sleep after this long with neither of them talking. `null` never sleeps. */
  readonly idleMs: IdleChoice
  /**
   * Give up on the goodbye after this and close anyway.
   *
   * A companion you cannot turn off is worse than an abrupt goodbye. If the
   * farewell never arrives, or never finishes, she still goes.
   */
  readonly farewellMs: number
  /** Give up on the session opening after this. */
  readonly wakeMs: number
  /**
   * Which answer to use for keeping the microphone open while SHE is talking.
   *
   * Open is the better conversation and the wrong default on a laptop. Barge-in
   * is the server's job and it needs the audio to judge it -- but on speakers
   * her own voice reaches the microphone, and echo cancellation removes most
   * of it rather than all of it. What survives is speech-shaped, so
   * `semantic_vad` scores it as a turn and she stops to listen to herself.
   * Through earphones the loop does not exist and none of this happens, which
   * is exactly why the choice belongs to the machine rather than to her: the
   * same character on a headset and on a laptop speaker wants opposite answers.
   *
   * Closing the microphone while she speaks costs interrupting her. It is a
   * cost the person can see and choose; interrupting HERSELF is not.
   */
  readonly listening: Listening
}

export const DEFAULT_SETTINGS: CompanionSettings = {
  idleMs: DEFAULT_IDLE_MS,
  // Generous against a ~900ms dial plus generation plus the utterance itself.
  farewellMs: 8_000,
  wakeMs: 15_000,
  // Measured rather than asked. See `audio/loopback.ts`.
  listening: 'auto',
}

export interface CompanionState {
  readonly phase: Phase
  /** When this phase began. Drives the wake and farewell deadlines. */
  readonly since: MonotonicMs
  /** Last moment either of them was talking. Drives the idle timeout. */
  readonly lastActivity: MonotonicMs
  /** Whether her audio is sounding right now. */
  readonly speaking: boolean
  /**
   * Whether her own voice has been heard coming back into the microphone.
   *
   * `null` until the renderer has heard enough of her to say. Deliberately
   * three-valued: "no echo" and "nobody has measured yet" lead to different
   * answers on the very first utterance, and collapsing them is how a session
   * greets you confidently through a speaker it has never listened to.
   */
  readonly loopback: boolean | null
  /**
   * Whether she has begun the goodbye yet.
   *
   * Without this, a toggle pressed WHILE she is mid-sentence closes on that
   * sentence ending rather than on the farewell — she gets cut off by the very
   * mechanism meant to let her finish.
   */
  readonly farewellBegun: boolean
  /**
   * The goodbye has been decided on but not yet ASKED FOR.
   *
   * She was mid-sentence when the farewell began. Asking then is not merely
   * early, it LOSES the goodbye: the session refuses a `speak` while one is
   * sounding, so the request came back `failed`, no farewell audio ever
   * arrived, and the machine sat waiting for a deadline it would then meet by
   * sleeping in silence.
   *
   * It also keeps `voiceStarted` honest. While this is true, audio reaching us
   * belongs to the sentence she was already saying -- so treating it as proof
   * the goodbye had begun would end the session on the wrong utterance
   * finishing, with the actual goodbye never spoken.
   */
  readonly farewellOwed: boolean
  /**
   * Whether something is being looked up for her right now.
   *
   * Holds the idle timeout open, exactly as `speaking` does -- and for a
   * stricter version of the same reason. `speaking` says "do not cut her off
   * mid-sentence"; this says "do not end the conversation the answer is
   * addressed to".
   */
  /**
   * How many errands are holding the idle timeout open.
   *
   * A COUNT, not a flag. Two overlapping operations both said `busy: true` and
   * the first to finish said `busy: false`, clearing a hold the other one still
   * needed -- so she could say goodbye and sleep with an answer still coming,
   * which is the exact failure this field exists to prevent. Today only the
   * delegation raises it and `runDelegation` refuses a second, so the count is
   * always 0 or 1; it is a count so that the next thing to hold it open cannot
   * reintroduce the bug by simply existing.
   */
  readonly working: number
}

export function initial(now: MonotonicMs = 0): CompanionState {
  return {
    phase: 'asleep',
    since: now,
    lastActivity: now,
    speaking: false,
    farewellBegun: false,
    farewellOwed: false,
    working: 0,
    // Unknown, not false. Nothing has listened yet.
    loopback: null,
  }
}

export interface Step {
  readonly state: CompanionState
  readonly effects: readonly Effect[]
}

const enter = (
  state: CompanionState,
  phase: Phase,
  now: MonotonicMs,
  patch: Partial<CompanionState> = {},
): CompanionState => ({
  ...state,
  phase,
  since: now,
  farewellBegun: false,
  farewellOwed: false,
  ...patch,
})

/** Nothing happened. Returned by name so "ignored" is visible in the code. */
const stay = (state: CompanionState): Step => ({ state, effects: [] })

const sleep = (state: CompanionState, now: MonotonicMs): Step => ({
  state: enter(state, 'asleep', now, { speaking: false }),
  effects: [{ kind: 'closeSession' }],
})

/**
 * One event. Total over every phase, so a new phase cannot be added without
 * deciding what each event means in it.
 */
/**
 * Whether to stop listening while she talks.
 *
 * `auto` before any verdict answers TRUE, which is the cautious half: the
 * measurement needs her to have spoken, so the very first utterance is judged
 * with no evidence. Guessing "keep listening" there costs the exact failure
 * this exists to prevent, on the greeting, which is the first thing anybody
 * hears. Guessing "stop listening" costs not being able to interrupt one
 * sentence -- and on earphones the verdict arrives during it and opens the
 * microphone for the next.
 */
function deaf(settings: CompanionSettings, state: CompanionState): boolean {
  if (settings.listening === 'earphones') return false
  if (settings.listening === 'speaker') return true
  return state.loopback !== false
}

export function step(
  state: CompanionState,
  event: CompanionEvent,
  now: MonotonicMs,
  settings: CompanionSettings = DEFAULT_SETTINGS,
): Step {
  // A session vanishing means the same thing everywhere except asleep, where
  // there was nothing to lose.
  if (event.kind === 'sessionLost') {
    return state.phase === 'asleep' ? stay(state) : sleep(state, now)
  }

  // Recorded in EVERY phase, before the switch, and it changes no phase.
  //
  // Before the switch because a run outlives the phase it began in: she can be
  // mid-farewell, or already asleep, when Codex finishes. Handling it per phase
  // would mean the flag stuck on in whichever phase forgot to clear it -- and a
  // `working` that never goes false is the "sometimes she just does not sleep,
  // and nobody knows why" failure this repository avoids everywhere else.
  //
  // It does not itself keep her awake; it stops the idle timeout from firing
  // while an answer is on its way, which is a narrower claim.
  if (event.kind === 'working') {
    // Finishing counts as ACTIVITY, and that is the point rather than a detail.
    // The answer is queued as a `function_call_output` she speaks on her next
    // turn -- so lifting the hold without moving the idle clock
    // means the very next tick can begin the farewell in the gap between the
    // result arriving and her opening her mouth. She would go quiet holding the
    // answer, which is the failure the hold exists to prevent, arriving one
    // tick later.
    // BALANCED, not assigned. `Math.max` floors it at zero so an unmatched
    // `false` -- a teardown clearing a hold twice, a report from an attempt
    // that already finished -- cannot drive the count negative and wedge the
    // timeout open forever, which would be the opposite failure and a worse
    // one: she would never sleep, with nothing on screen saying why.
    const working = Math.max(0, state.working + (event.busy ? 1 : -1))
    return stay({
      ...state,
      working,
      // Only when the LAST one finishes. Nudging the clock while another errand
      // is still running is harmless, but reading it as "everything is done"
      // is what the count exists to prevent.
      lastActivity: working === 0 && !event.busy ? now : state.lastActivity,
    })
  }

  // Delegated per phase, but the switch stays EXHAUSTIVE here: adding a phase
  // must still be a compile error that names every place deciding what an
  // event means in it. What moved out is the bodies, which had grown to 143
  // lines of four unrelated transition tables sharing one scroll position.
  switch (state.phase) {
    case 'asleep':
      return inAsleep(state, event, now)
    case 'waking':
      return inWaking(state, event, now, settings)
    case 'awake':
      return inAwake(state, event, now, settings)
    case 'farewell':
      return inFarewell(state, event, now, settings)
  }
}

/** What every event means while she is asleep. */
function inAsleep(state: CompanionState, event: CompanionEvent, now: MonotonicMs): Step {
  if (event.kind === 'toggle') {
    return { state: enter(state, 'waking', now), effects: [{ kind: 'openSession' }] }
  }
  return stay(state)
}

/** What every event means while she is waking. */
function inWaking(
  state: CompanionState,
  event: CompanionEvent,
  now: MonotonicMs,
  settings: CompanionSettings,
): Step {
  if (event.kind === 'sessionReady') {
    return {
      // `loopback: null` -- UNKNOWN AGAIN for a new session.
      //
      // The renderer measures per session because the answer is about this
      // room and these devices, and both can have changed while she was
      // asleep: earphones unplugged, a display with speakers connected.
      // Carrying the previous verdict across meant the new greeting was
      // decided on evidence gathered from a setup that no longer exists,
      // and `deaf()` reads `null` as "assume echo", which is the cautious
      // half -- so the stale value could only ever be the less careful
      // answer than the one it replaced.
      state: enter(state, 'awake', now, { lastActivity: now, loopback: null }),
      // Mic before greeting, so she can be interrupted from her first word.
      // Barge-in is the server's job and it needs the audio to judge it.
      effects: [{ kind: 'mic', open: true }, { kind: 'greet' }],
    }
  }
  // A second press while she is still coming up means "never mind".
  if (event.kind === 'toggle' || event.kind === 'sessionFailed') return sleep(state, now)
  if (event.kind === 'tick' && now - state.since >= settings.wakeMs) return sleep(state, now)
  return stay(state)
}

/** What every event means while she is awake. */
function inAwake(
  state: CompanionState,
  event: CompanionEvent,
  now: MonotonicMs,
  settings: CompanionSettings,
): Step {
  if (event.kind === 'toggle') return beginFarewell(state, now)
  // What the renderer has measured about this room. Arrives whenever the
  // answer changes, including part-way through a conversation -- earphones
  // going in is exactly that.
  if (event.kind === 'loopback') {
    const next = { ...state, loopback: event.present }
    // The verdict lands MID-UTTERANCE, always. It needs her to be audible
    // before it can measure anything, so the first one necessarily arrives
    // while she is speaking -- during the greeting, on every session.
    //
    // Recording it and emitting nothing left the microphone wherever the
    // OLD decision had put it. Closed, in the case that matters: the
    // greeting starts with the answer unknown, so it gates; the verdict
    // then says the room has no echo; and `voiceStopped` consults the NEW
    // decision, finds gating is not wanted, and emits nothing to undo the
    // close. One flipped verdict and she could not be spoken to again for
    // the rest of the session. The comment above `deaf` claimed this case
    // worked.
    if (!state.speaking) return stay(next)
    const wasDeaf = deaf(settings, state)
    const isDeaf = deaf(settings, next)
    if (wasDeaf === isDeaf) return stay(next)
    return { state: next, effects: [{ kind: 'mic', open: !isDeaf }] }
  }
  if (event.kind === 'voiceStarted') {
    const next = { ...state, speaking: true, lastActivity: now }
    // Half duplex: stop listening for as long as she is the one talking.
    return deaf(settings, state)
      ? { state: next, effects: [{ kind: 'mic', open: false }] }
      : stay(next)
  }
  if (event.kind === 'voiceStopped') {
    const next = { ...state, speaking: false, lastActivity: now }
    // And open it again the moment she stops. Not on a timer: a tail would
    // be a guess at how long the room rings for, and getting it wrong
    // either clips the first word of the reply or lets the last of hers
    // back in.
    return deaf(settings, state)
      ? { state: next, effects: [{ kind: 'mic', open: true }] }
      : stay(next)
  }
  if (event.kind === 'userSpoke') return stay({ ...state, lastActivity: now })
  if (event.kind === 'tick') {
    // Never mid-sentence, and never mid-errand. `speaking` is hers;
    // `lastActivity` covers the user, who has no "still talking" signal we
    // can see -- only that the server heard them start; `working` covers
    // the case where NOBODY is talking precisely because they are waiting
    // for an answer that is on its way.
    //
    // `null` means never, and it is checked HERE rather than turned into a
    // large number at the boundary. A sentinel like `Infinity` would make
    // the comparison below silently correct and the intent invisible; worse,
    // any finite stand-in is a duration that eventually elapses, so "never"
    // would become "in 24 days" for a session nobody restarted.
    const idle = settings.idleMs !== null && now - state.lastActivity >= settings.idleMs
    if (idle && !state.speaking && state.working === 0) return beginFarewell(state, now)
  }
  return stay(state)
}

/** What every event means while she is farewell. */
function inFarewell(
  state: CompanionState,
  event: CompanionEvent,
  now: MonotonicMs,
  settings: CompanionSettings,
): Step {
  // "Wait, come back." Cheaper and clearer than leaving the microphone open
  // through a goodbye and guessing whether an interruption was one.
  if (event.kind === 'toggle') {
    return {
      state: enter(state, 'awake', now, { lastActivity: now }),
      effects: [{ kind: 'mic', open: true }],
    }
  }
  if (event.kind === 'voiceStarted') {
    // Only counts as the goodbye once the goodbye has been ASKED FOR.
    // While it is still owed, audio reaching us is the sentence she was
    // already saying, and crediting it would sleep on the wrong utterance
    // ending -- with the actual goodbye never spoken.
    return stay({ ...state, speaking: true, farewellBegun: !state.farewellOwed })
  }
  if (event.kind === 'voiceStopped') {
    if (state.farewellOwed) {
      // NOW. She has stopped, so the session will accept it -- and the
      // deadline restarts from here, because the one that was running
      // measured her previous sentence rather than the goodbye.
      return {
        state: { ...state, speaking: false, farewellOwed: false, since: now },
        effects: [{ kind: 'farewell' }],
      }
    }
    // Only once the GOODBYE has been heard. A stop arriving before it is
    // the sentence she was interrupted in the middle of.
    return state.farewellBegun ? sleep(state, now) : stay({ ...state, speaking: false })
  }
  if (event.kind === 'tick' && now - state.since >= settings.farewellMs) {
    // The bound holds even for a goodbye that was never asked for. A
    // companion you cannot turn off is worse than an abrupt one, so a
    // sentence that never ends still ends the session.
    return sleep(state, now)
  }
  return stay(state)
}

function beginFarewell(state: CompanionState, now: MonotonicMs): Step {
  // ASKED FOR ONLY IF SHE IS QUIET. The session refuses a `speak` while one is
  // sounding, so requesting it mid-sentence does not merely arrive early -- it
  // comes back `failed` and the goodbye is gone. Held instead, and asked for on
  // `voiceStopped`.
  const owed = state.speaking
  return {
    state: enter(state, 'farewell', now, { farewellOwed: owed }),
    // Microphone FIRST, and before she has said anything. She is signing off,
    // not inviting a reply, and "already stopped listening" is the honest
    // signal -- the tray shows it the moment it happens.
    effects: owed
      ? [{ kind: 'mic', open: false }]
      : [{ kind: 'mic', open: false }, { kind: 'farewell' }],
  }
}
