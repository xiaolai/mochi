/**
 * The half of the lifecycle that has side effects.
 *
 * `shared/companion.ts` decides WHAT should happen and is pure. This does it:
 * opens a session, moves the microphone, and tells every view what phase she is
 * in. Keeping the two apart is what lets the awkward timing cases be tested on
 * a number line, and it means this file has no decisions in it worth arguing
 * with — only wiring.
 *
 * This file also owns ATTEMPT IDENTITY. Every command it sends carries the
 * number of the open it belongs to, and `report()` drops anything stamped with
 * a superseded one. Opening takes two network calls bounded at 30s each while
 * the wake timeout is 15s, so an attempt that has been given up on is routinely
 * still running when its replacement starts -- and without a number on each
 * message, the loser's `ready` promotes the winner's phase and the loser's
 * `openFailed` tears it down.
 */

import type { Listening, Sound } from '@shared/sound'
import { UNPROMPTED, type UtteranceId } from '@shared/utterance'
import {
  DEFAULT_SETTINGS,
  initial,
  step,
  type CompanionEvent,
  type CompanionSettings,
  type CompanionState,
  type Effect,
  type Phase,
} from '@shared/companion'
import type { Persona } from '@shared/persona'
import type { AttemptId, VoiceCommand } from '@shared/ipc'

/**
 * How often the machine is asked whether a deadline has passed.
 *
 * Coarse on purpose. Every timeout here is seconds long, and a timer that fires
 * sixty times a second to check a 90-second idle window is a busy loop wearing
 * a clock.
 */
const TICK_MS = 250

export interface LifecycleView {
  /** Called whenever the phase or the microphone changes. Never on a no-op. */
  readonly onChanged: (state: CompanionState, micOpen: boolean) => void
  /** Hand an effect to whoever owns the session. */
  readonly command: (command: VoiceCommand) => void
  readonly persona: () => Persona
  /**
   * What she remembers, read at the moment of opening.
   *
   * A function, like `persona`, and for the same reason: captured once, a
   * session opened after a persona switch would carry the previous
   * character's notes.
   */
  readonly memory: () => string
  /**
   * The rules every persona is given, read at the moment of opening.
   *
   * Beside `memory` and read the same way, because the instructions are built
   * once per session: a change made mid-conversation belongs to the next wake.
   */
  readonly spokenRules: () => string
  /**
   * What this computer does with the microphone, read at the moment of opening.
   *
   * A function like `persona` and `memory` beside it, and for the same reason:
   * the value is whatever is stored WHEN a session opens, not whatever was
   * stored when the lifecycle started.
   */
  readonly sound: () => Sound
  /**
   * Whether the app owns every utterance for the worn persona.
   *
   * Read per open, like `sound` beside it: a behaviour belongs to a persona,
   * and switching persona must not leave the previous one's turn-taking in
   * force.
   */
  readonly drives: () => boolean
  /**
   * Her opening line, or null when a capability speaks its own.
   *
   * Null rather than an empty string: a response asked for with no
   * instructions is not silence, it is the model choosing what to say.
   */
  readonly greeting: () => string | null
  readonly farewell: () => string
}

export interface Lifecycle {
  /** The shortcut, or the tray. Means something different in every phase. */
  toggle(): void
  readonly phase: Phase
  readonly micOpen: boolean
  /** Mint a name for an utterance a capability is about to request. */
  nextUtterance(): UtteranceId
  /** Whether her own voice has been heard coming back. `null` until measured. */
  readonly loopback: boolean | null
  /** The open currently in force. Anything reported against another is stale. */
  readonly attempt: AttemptId
  /**
   * Feed the machine something the session reported.
   *
   * `attempt` is the open the report belongs to. A mismatch is dropped, which
   * is the entire defence against a superseded session driving the phase.
   */
  report(event: CompanionEvent, attempt: AttemptId): void
  /**
   * Whether a delegation is running, so the idle timeout does not end the
   * conversation its answer is addressed to. See `CompanionEvent.working`.
   */
  setWorking(busy: boolean): void
  /**
   * End the session and return to asleep, without retiring the lifecycle.
   *
   * `stop()` is terminal -- it latches `stopped` and clears the tick, because
   * it exists for quit. A persona switch needs the same teardown and then has
   * to keep working, so it cannot borrow it: calling `stop()` for a switch
   * would leave her unable to wake again for the rest of the run.
   *
   * The attempt is retired here, which is the part that matters. Anything the
   * old session reports afterwards carries the previous number and is dropped,
   * so a `ready` still in flight cannot mark the NEW persona as awake.
   */
  sleepNow(): void
  stop(): void
}

export function startLifecycle(
  view: LifecycleView,
  /**
   * Read on every step, not captured once.
   *
   * A value here was read at startup and never again -- and this function runs
   * ONCE for the process, not once per wake. So the microphone setting the
   * pane says "takes effect the next time she wakes" took effect at the next
   * LAUNCH, and the sentence in the window was simply untrue. A getter keeps
   * the promise: the value is read when the wake happens.
   */
  settings: () => CompanionSettings = () => DEFAULT_SETTINGS,
): Lifecycle {
  let state = initial(now())
  let micOpen = false
  /**
   * Names for the things she is asked to say.
   *
   * Minted HERE because this is what already owns `attempt`, and an id that
   * outlived its attempt would let a stale outcome commit work for a session
   * that is gone. Monotonic across the process rather than reset per attempt:
   * uniqueness is all that is needed and a reused number is a bug that only
   * shows up under reconnection.
   */
  let utterance = 0
  let stopped = false
  /**
   * Bumped on every open and on every close.
   *
   * Incremented on close as well as open, so a session torn down while still
   * connecting cannot be revived by its own late `ready` -- there is no live
   * attempt with that number any more, and nothing to match.
   */
  let attempt: AttemptId = 0

  function now(): number {
    // Monotonic, so an NTP correction or a timezone change cannot make a
    // deadline fire early or never.
    return performance.now()
  }

  function apply(effects: readonly Effect[]): void {
    for (const effect of effects) {
      switch (effect.kind) {
        case 'openSession':
          attempt += 1
          // Frozen for the life of this session, so a change made while she is
          // talking reaches the NEXT wake rather than this turn.
          sessionSound = settings().listening
          view.command({
            kind: 'open',
            attempt,
            persona: view.persona(),
            memory: view.memory(),
            spokenRules: view.spokenRules(),
            sound: view.sound(),
            driven: view.drives(),
          })
          break
        case 'closeSession': {
          // LOCAL STATE FIRST, delivery second.
          //
          // `view.command` can throw -- it reaches a window that may have gone
          // away mid-teardown -- and it used to run before these two lines. The
          // throw escaped `apply`, so the attempt was never retired and
          // `micOpen` stayed true: a live microphone with no session, which is
          // the one state this file says must be unreachable. `onChanged` was
          // skipped too, so the tray went on showing "listening".
          //
          // Retiring first is safe in a way the other order is not: a close
          // command that fails to arrive leaves a session the app has already
          // stopped listening to, while a microphone flag that never clears
          // leaves the user believing they are being recorded when they are.
          const closing = attempt
          // Retire the number as well as the session. Anything the old attempt
          // says from here on refers to an attempt that no longer exists.
          attempt += 1
          // Belt and braces: the machine shuts the microphone on the way into a
          // farewell, but a session lost mid-conversation goes straight to
          // asleep without passing through it.
          micOpen = false
          // Released with the session, so the next open reads the current
          // choice rather than inheriting the one before it.
          sessionSound = null
          try {
            view.command({ kind: 'close', attempt: closing })
          } catch (error: unknown) {
            // Logged, not rethrown. The session is gone from this process's
            // point of view either way, and letting it escape would abort the
            // remaining effects of a teardown.
            console.error('[lifecycle] the close command could not be delivered:', error)
          }
          break
        }
        case 'greet': {
          const opening = view.greeting()
          // A capability that drives speaks its own first line through `say`,
          // and this must not also speak one.
          if (opening === null) break
          lifecycleSpeaks(opening)
          break
        }
        case 'farewell':
          lifecycleSpeaks(view.farewell())
          break
        case 'mic':
          micOpen = effect.open
          view.command({ kind: 'mic', attempt, open: effect.open })
          break
      }
    }
  }

  /**
   * An utterance the LIFECYCLE asked for: the greeting and the goodbye.
   *
   * One function because the two were byte-for-byte the same but for the text
   * -- mint a name, send a `speak`, choose an isolation -- and the isolation is
   * exactly the field that had drifted between them. Two maintenance sites for
   * one rule is how the goodbye ended up filed differently from the greeting
   * for a driven persona, and neither comment mentioned the other.
   */
  function lifecycleSpeaks(instructions: string): void {
    utterance += 1
    view.command({
      kind: 'speak',
      attempt,
      utterance,
      instructions,
      // `UNPROMPTED` for both, and for one reason: an utterance the app
      // initiates is never a reply. It reads nothing, so it cannot continue
      // the conversation -- which is what stopped her answering the last
      // unanswered question instead of saying goodbye -- and it WRITES,
      // because she said it and the record should be true.
      //
      // `ALONE` used to be used here for a driven persona. That constant is
      // for DRILL ITEMS, where a word must not be burned by an unanswered
      // question; a greeting and a goodbye are not drill items, and borrowing
      // it made the record untrue for one kind of persona and not the other.
      isolation: UNPROMPTED,
    })
  }

  /**
   * The sound settings THIS session opened with.
   *
   * `settings()` is read live so a change reaches the machine without a
   * restart, and for `idleMs` that is exactly right -- lengthening it while she
   * is awake should postpone the goodbye. `listening` is not like that: `step`
   * consults it on `voiceStarted`, `voiceStopped` and `loopback`, so a change
   * made mid-conversation moved the microphone under a turn already in flight
   * -- while the pane promised, in so many words, that these apply the next
   * time she wakes.
   *
   * Captured at the open, therefore, and merged over the live values below.
   * `null` before the first session, which cannot be observed: nothing reads
   * `listening` while asleep.
   */
  let sessionSound: Listening | null = null

  function emit(event: CompanionEvent): void {
    if (stopped) return
    const before = state
    const beforeMic = micOpen
    const live = settings()
    const result = step(state, event, now(), {
      ...live,
      // The captured one wins while a session is open. Everything else in the
      // block stays live -- see `sessionSound`.
      listening: sessionSound ?? live.listening,
    })
    state = result.state
    apply(result.effects)
    // Only on a real change. A tick that decided nothing must not repaint the
    // tray four times a second.
    if (state !== before || micOpen !== beforeMic) view.onChanged(state, micOpen)
  }

  const ticking = setInterval(() => emit({ kind: 'tick' }), TICK_MS)
  // A pending tick is not a reason for the process to stay alive.
  ticking.unref()

  return {
    toggle: () => emit({ kind: 'toggle' }),
    setWorking(busy: boolean): void {
      // NOT gated on the attempt, unlike `report`. A delegation belongs to the
      // machine rather than to one open: it can be started in one session and
      // finish after a reconnect, and dropping the `false` because the attempt
      // moved on is exactly how the flag would stick on forever.
      emit({ kind: 'working', busy })
    },
    report(event: CompanionEvent, reported: AttemptId): void {
      // The whole point of the number. A late report from an attempt that has
      // been superseded or closed describes a session nobody is waiting on.
      if (reported !== attempt) {
        console.warn(`[lifecycle] ignoring ${event.kind} from attempt ${reported} (now ${attempt})`)
        return
      }
      emit(event)
    },
    get phase() {
      return state.phase
    },
    /** Mint a name for something a capability is about to ask for. */
    nextUtterance() {
      utterance += 1
      return utterance
    },
    get micOpen() {
      return micOpen
    },
    /**
     * What the room has been measured to do, or `null` while unknown.
     *
     * Exposed so the settings window can SHOW it. An automatic decision the
     * user cannot see is one they cannot tell from a malfunction -- and this
     * one decides whether they are able to interrupt her, which is exactly the
     * kind of thing somebody notices and has no way to explain.
     */
    get loopback() {
      return state.loopback
    },
    get attempt() {
      return attempt
    },
    sleepNow(): void {
      if (stopped || state.phase === 'asleep') return
      // LOCAL STATE FIRST, delivery second. `command` crosses to a renderer
      // and can throw -- and with the retirement after it, a throw left the
      // old attempt live and the phase awake. The caller switching persona has
      // already adopted the new character by then, so the new one would
      // inherit the previous one's session: precisely the boundary this method
      // exists to draw.
      const closing = attempt
      attempt += 1
      micOpen = false
      state = initial(now())
      try {
        view.command({ kind: 'close', attempt: closing })
      } catch (error: unknown) {
        // Said, not swallowed. The session is already disowned locally -- any
        // report it sends carries `closing` and is dropped -- but a renderer
        // that never heard `close` may still hold a live microphone, and that
        // is worth a line in the log.
        console.error('[lifecycle] the close command could not be delivered:', error)
      }
      // Announced, like every other transition. A phase that changes without
      // telling the views leaves the tray saying "Let her sleep" over a
      // companion who is already asleep.
      view.onChanged(state, micOpen)
    },

    stop(): void {
      // Idempotent. A second stop used to resend `close` and leave `phase` and
      // `micOpen` reporting a session that was already gone.
      if (stopped) return
      stopped = true
      clearInterval(ticking)
      // LOCAL TEARDOWN FIRST, exactly as `closeSession` does it above, and for
      // the same reason -- this is the second instance of one defect rather
      // than two. `stopped` latches before the command, so a throw here left
      // the attempt live, `micOpen` true and `state` unreset FOREVER: every
      // later `stop()` returns at the guard, and this runs on quit, when a
      // window going away first is the ordinary case rather than the exotic
      // one.
      const closing = attempt
      attempt += 1
      micOpen = false
      state = initial(now())
      try {
        view.command({ kind: 'close', attempt: closing })
      } catch (error: unknown) {
        console.error('[lifecycle] the close command could not be delivered on stop:', error)
      }
    },
  }
}
