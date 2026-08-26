import { readVoiceReport } from '@shared/voice-report'
import { whatToFile } from '../heard'
import type { Conversation } from '../store/conversation'

/**
 * What main does when the renderer reports something about the live session.
 *
 * A router, and it is worth its own module for two reasons that are really one.
 *
 * It is the app's **only inbound path from the least trusted process** that
 * reaches SQLite, the idle clock and the reconnect schedule at once — so the
 * validation at the top of it is load-bearing in a way no other handler's is.
 * And it reads twelve things from the composition root and **writes none of
 * them**, which is what makes it liftable at all: a router over read-only
 * dependencies is a function, not a piece of a wiring diagram.
 *
 * `index.ts` keeps the registration, which is one line, and this holds the
 * decision.
 */

/** Everything the router reads. All of it read-only — see the header. */
export interface ReportedDeps {
  /**
   * The live conversation, opened if it is not already.
   *
   * The real `Conversation`, not a hand-written shape of the part used here.
   * A re-declared signature is a second place the contract lives, and the two
   * drift silently -- this one already had, on the very first attempt.
   */
  readonly conversation: () => Conversation
  /** Every turn this session owed has arrived; the conversation may end. */
  readonly conversationFlushed: () => void
  /** She said or heard something, so the silence being counted starts again. */
  readonly stirred: () => void
  /** When the next session should open. */
  readonly nextSession: { announced: (expiresAt: number) => void }
  /**
   * Let clicks pass through her window, or not.
   *
   * The window is a square of empty pixels with a mochi somewhere in it, so
   * the corners swallow clicks unless this is set — and the failure is silent:
   * nothing looks wrong, the click just goes nowhere.
   */
  readonly clickThrough: (through: boolean) => void
  /** Whether she is listening, for the tray and the halo. */
  readonly setListening: (listening: boolean) => void
  readonly note: (why: string) => void
  readonly log: (line: string) => void
}

/**
 * Handle one report.
 *
 * Exported rather than registered here so it can be called directly by a test:
 * `index.ts` cannot be imported outside Electron, which is why the guards this
 * router contains had to be asserted on its source text before.
 */
export function reported(report: unknown, deps: ReportedDeps): void {
  /*
    CHECKED, not cast.

    This was `report as VoiceReport`, which is a claim about what the author
    believed rather than a check on what arrived -- and every field went
    straight to the idle clock, the reconnect timer and SQLite. `at` is the one
    that bit: `node:sqlite` throws when READING BACK an INTEGER outside +/-2^53,
    for the whole result set rather than the row, so one turn filed at 1e17
    makes the conversation list throw on every launch. That list is the pane
    holding the delete buttons, so there is no way back from inside the app.

    Dropped silently at the boundary would be its own defect, so it is noted.
  */
  const event = readVoiceReport(report)
  if (event === null) {
    deps.note('the renderer reported something unreadable; it was ignored')
    return
  }
  if (event.kind === 'flushed') {
    deps.conversationFlushed()
    return
  }
  if (event.kind === 'expiry') {
    // The good path: the service said when this session ends, so the blind
    // floor armed at `voice:open` is replaced by the real schedule.
    deps.nextSession.announced(event.expiresAt)
    return
  }
  if (event.kind === 'heard') {
    deps.log(`[voice] heard: ${event.transcript}`)
    deps.conversation().file('you', event.transcript)
    // Somebody is talking to her, so the silence being counted starts again.
    // Filed turns rather than frames: a reconnect produces plenty of frames
    // with nobody in the room, which is the case the timeout exists for.
    deps.stirred()
    return
  }
  if (event.kind === 'said') {
    // HER turns count too, and this is the line that stops a long answer being
    // timed out from underneath: `heard` arrives when they finish speaking and
    // this arrives when she does, which on a lookup can be half a minute later.
    deps.stirred()
    /*
      The whole decision is `whatToFile`, and it is BELOW `deps.stirred()` on
      purpose.

      A preamble is still her speaking, so the idle clock has to see it even
      though the archive must not. Getting that order backwards would let a
      conversation full of lookups time out from underneath her.
    */
    const filing = whatToFile(event)
    if (filing.kind === 'preamble') {
      // Logged, never filed. A preamble vanishing with no trace at all is how
      // somebody comes to believe the transcript is lossy.
      deps.log(`[voice] preamble, not filed: ${filing.text}`)
      return
    }
    if (filing.kind === 'whole') {
      deps.log(`[voice] said: ${filing.text}`)
      // The transcript's own instant, not this one. A finished turn is settled
      // by `output_audio_buffer.stopped`, which §19 puts 2.1–7.9s after
      // generation — and one whose verdict never came is settled at session
      // close, which can be an hour later.
      deps.conversation().file('her', filing.text, { cut: false, at: filing.at })
      return
    }
    deps.log(
      `[voice] said (cut): ${filing.text.length} of ${event.transcript.length} chars — "${filing.text.slice(-48)}"`,
    )
    deps.conversation().file('her', filing.text, { cut: true, at: filing.at })
    return
  }
  if (event.kind === 'pointer') {
    // The window is a square of empty pixels with a mochi somewhere in it.
    // Without this the invisible corners swallow clicks, and the failure is
    // silent — nothing looks wrong, the click just goes nowhere.
    //
    // `forward: true` on the ignore case so `mousemove` keeps arriving; without
    // it she becomes blind the moment she becomes click-through, and can never
    // report that the cursor came back.
    deps.clickThrough(!event.onHer)
    return
  }
  if (event.kind === 'state') {
    deps.log(`[voice] ${event.state}`)
    /*
      The one fact the TRAY carries, from the one place that knows it.

      Her window computes `!asleep && session !== null` for the halo and reports
      the same boolean here, so the ring on her head and the mark in the menu bar
      cannot disagree — which they would the moment main tried to infer this from
      `resting.asleep`, because that says nothing about whether a session
      actually negotiated.

      This is what makes the halo a preference rather than a promise. It is also
      what makes `setHidden` honest: hiding her window leaves the session open on
      purpose, so until the menu bar said so, one click from the tray produced a
      live microphone with nothing on screen at all.
    */
    deps.setListening(event.state === 'listening')
  }
  if (event.kind === 'note') deps.log(`[voice] ${event.text}`)
}
