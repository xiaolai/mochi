import type { MochiApi } from '@shared/ipc'
import { showFace, type Face } from './face'
import { applyAccent } from '../design/apply-accent'
import { EMOTIONS, type Emotion } from '@shared/avatar'
import { STATUS_UNDER } from '@shared/avatar-layout'
import { keepsNewer } from './negotiating'
import { openSession, type Session, type SessionState } from './audio/session'
import { installLogStamp } from '@shared/log'

/*
  A wall clock on every line this window prints, installed before it prints one.

  The two processes interleave on one stream, and this one used to stamp a
  relative offset from the moment the SESSION opened — which resets on every
  reconnect, so two lines forty minutes apart could carry the same number. See
  `shared/log.ts`; the same call is the first statement in main.

  Idempotent by construction, which matters here rather than there: this is the
  kind of module a dev-server reload imports twice, and two installations would
  double-stamp every line.
*/
installLogStamp()

declare global {
  interface Window {
    readonly mochi: MochiApi
  }
}

const canvas = document.querySelector('#face')
const found = document.querySelector('#app')
if (!(canvas instanceof HTMLCanvasElement) || found === null) {
  // Fail loud. Rendering into nothing is indistinguishable from a slow start.
  throw new Error('companion: the document is not the one this expects')
}
// Re-bound so the narrowing survives into the closures below, which are defined
// after the check and cannot see it otherwise.
const status: Element = found

/**
 * Her voice.
 *
 * An `Audio` element rather than a Web Audio graph, because playback is all it
 * does — the analysis that drives her mouth taps the same stream separately in
 * `face.ts`, and routing playback through an `AudioContext` too would mean two
 * things owning the same audio and one of them deciding when it stops.
 */
const speaker = new Audio()
speaker.autoplay = true

const face: Face = showFace(canvas)

function show(text: string): void {
  status.textContent = text
  placeStatus()
}

/**
 * Put the status line under HER, not at the bottom of the window.
 *
 * `#app` was `bottom: 6px`, which is the bottom of a transparent window sized
 * for a speech bubble above her, one below, and a whole one beside — so
 * "opening…" appeared hundreds of pixels below her feet, unattached to anything.
 * `feetY` puts her 340px from the TOP; the window's bottom edge is nowhere near
 * her and never was.
 *
 * Read from `face.box()` rather than from `FEET_FROM_TOP`, because her size is a
 * persona field and the box already accounts for it, for her body height, and
 * for the clamp that applies when the canvas is short.
 */
function placeStatus(): void {
  const her = face.box()
  // Under her, and under whatever the canvas has already drawn under her. The
  // beat sits there too, and these two used to be painted on top of each other.
  const under = Math.round(her.top + her.height * (1 + STATUS_UNDER))
  status.setAttribute('style', `top: ${String(under)}px`)
}

/*
  Placed once at startup, BELOW the declarations it reads.

  The first version of this call sat immediately after `showFace`, which was
  above the local fraction it read — a `const` in its temporal dead zone, so the
  module threw on the first line it ran and the window rendered with no script at
  all. It looked exactly like the bug it was fixing: a status line at the bottom
  of the window. The fraction is `STATUS_UNDER` from `avatar-layout` now, which
  is imported and therefore hoisted, but the ordering is kept: `face` above it
  is still a `const`.
*/
placeStatus()
// She is resized by main repositioning her window, which is a resize here.
window.addEventListener('resize', placeStatus)

function describe(state: SessionState): string {
  /*
    Nothing while she is opening, and nothing once she is up.

    The status line is for states where there is no HER to look at. "listening"
    written under a face that is plainly listening is a label on the obvious, and
    "opening…" is the same thing one step earlier: she is on screen, she is
    breathing, and the only thing the word adds is a caption saying so. Neither
    told anybody anything they could not see.

    What survives is what you CANNOT see: a session that closed, an hour that ran
    out, and a failure with its own text. Those are the reason this line exists.
  */
  if (state === 'opening') return ''
  if (state === 'listening') return ''
  if (state === 'closed') return 'closed'
  if ('expired' in state) return 'the hour is up — reconnecting'
  return state.failed
}

let session: Session | null = null

/**
 * Whether the microphone may be open, which is ONE answer now.
 *
 * It was two: `asleep` — where she was left — and `mayHear`, 5b's standing
 * grant, either one of which alone closed the track. The grant is gone
 * (`@shared/grants` records why it was the one this machine already answered
 * twice), and with it the whole apparatus that kept the two in step: the held
 * revocation, the give-it-back reconnect, and `closeMicrophone`.
 *
 * Still held here rather than derived at each call site. A call site that knew
 * only about its own reason to close the track is exactly what re-opened one
 * the other had just closed.
 */
let asleep = false

/**
 * A grant change that arrived while a session was still opening.
 *
 * Held rather than dropped, and this is a PERMISSION so the direction matters.
 * `openSession` reads the grants once, at the door; a switch flipped between
 * that read and the session being assigned reached `session?.mayDo` while
 * `session` was still null, did nothing, and was then overwritten by the older
 * snapshot — so a capability somebody had just revoked came back for the rest
 * of the session. Kept here, applied the moment there is something to apply it
 * to, and cleared only once it has been.
 */
let held: { instructions: string; tools: readonly unknown[] } | null = null

function applyMicrophone(): void {
  const on = !asleep
  session?.listen(on)
  /*
    Her side of it too, and it asks whether there IS a session.

    With no microphone there is no turn to detect, and a track that is muted or
    ended still produces frames — silence read as "they stopped talking" put her
    into a held beat behind a closed microphone.

    `session !== null` is what gives the halo's third state a producer again.
    `off` used to mean the `microphone` grant was withheld; that grant is gone,
    and without this the state was unreachable while its opposite was a lie —
    awake with a session that failed to negotiate drew a filled ring over a
    window holding no peer and no device. See `haloFor`.
  */
  const live = on && session !== null
  face.hears(live)
  /*
    The SAME boolean to main, which is what puts it in the menu bar.

    Reported here rather than from `session.listen`, and that is the whole point
    of moving it: `listen` is only reached when there IS a session, so the case
    that matters most — no session at all — could not report anything and main
    would hold the last value for ever. One computation, three consumers: the
    track, the ring on her head, and the mark on the tray. They cannot disagree
    because there is nothing for them to disagree about.
  */
  window.mochi.report({ kind: 'state', state: live ? 'listening' : 'muted' })
}

/**
 * Whatever arrived while she was opening, applied now that she is up.
 *
 * It used to return whether a NEW session was needed, because one grant could
 * not be applied to a live peer: a session opened without the microphone grant
 * never asked for the device, so it had no track and could not grow one into an
 * offer already answered. Every grant left is a tool, and a tool list is a
 * `session.update` — so there is nothing here that a running session cannot
 * take, and nothing to report back.
 */
function applyHeldGrants(): void {
  if (session === null || held === null) return
  const change = held
  held = null
  session.mayDo({ instructions: change.instructions, tools: change.tools })
}

/**
 * Which open is current.
 *
 * A reconnect can be asked for while one is still negotiating, and `session` is
 * null for the whole of that window — so two opens both passed the null check
 * and the later assignment overwrote the earlier without closing it, leaving an
 * orphaned peer and a microphone nothing in this process could reach.
 */
let opening = 0

/**
 * How many frames have arrived about each thing `open` also reads a snapshot of.
 *
 * Counted, not compared — see `negotiating.ts` for why, and for the three places
 * this shape was found. Every one of these has a live frame AND a value taken
 * from `voice:config` before two network round trips.
 */
const arrived = { rest: 0, problems: 0, bubbleSide: 0 }

/** The live values those frames set, so a stale snapshot has something to lose to. */
let problems = 0
let bubbleSide = 'auto'

async function open(): Promise<void> {
  const mine = ++opening
  // Taken BEFORE the negotiation, so what arrives during it can be told apart
  // from what was true when it started.
  const before = { ...arrived }
  session?.close()
  session = null

  /*
    EVERY callback from this session, or none of them.

    The `catch` below already states the rule — "Only the current one gets to
    say so. A stale failure would overwrite the state of the session that
    replaced it." — and applied it in one place out of eight. `onState` called
    `show()` before its own guard, so a dying session repainted the status of
    the one that replaced it; `onRemote` reassigned `speaker.srcObject` and
    re-tapped the mouth analyser, so a reconnect could end up playing the OLD
    stream. The rest are the same shape and were simply not reached yet.

    Wrapped once rather than guarded seven times. A rule applied at each site is
    a rule that holds at the sites somebody remembered.
  */
  const current = <A extends unknown[]>(run: (...args: A) => void): ((...args: A) => void) => {
    return (...args: A) => {
      if (mine !== opening) return
      run(...args)
    }
  }

  let next: Session
  try {
    next = await openSession({
      onState: current((state) => {
        show(describe(state))
        /*
          A DEAD SESSION IS RELEASED HERE, not only in the `catch` below.

          The catch covers a negotiation that never completed. This covers one
          that completed and then died -- an ICE failure, the peer dropping,
          the hour running out -- which arrives as a state and nothing else.
          Without it `session` stayed non-null over a connection that no longer
          existed, so `applyMicrophone()` went on calling `listen(true)` into
          it and the halo went on showing a microphone she did not have. The
          ring said she was listening and nothing was.

          Guarded by the generation, for the reason the catch is: a state from
          a session that has already been replaced must not release the one
          that replaced it.
        */
        // `mine === opening` is the wrapper's job now, so this is only about
        // whether the state means the session is gone.
        const dead = state === 'closed' || (typeof state === 'object' && 'failed' in state)
        if (dead) {
          session = null
          applyMicrophone()
        }
      }),
      onRemote: current((stream) => {
        speaker.srcObject = stream
        // The same stream, tapped twice: played, and measured for the mouth.
        // §19 is why the mouth cannot come from her text instead — the words
        // arrive 2.1–7.9s before the audio finishes draining.
        face.hear(stream)
      }),
      onExpiry: () => {
        /* main schedules the reconnect; nothing to do here */
      },
      onSaying: current((delta, responseId) => face.saying(delta, responseId)),
      onMicrophone: current((stream) => face.listen(stream)),
      onSpeaks: current((responseId) => face.speaks(responseId)),
      onFinished: current((id, interrupted) => face.finished(id, interrupted)),
      // NOT guarded, and it is the one that should not be. The others are
      // notifications — a stale one writes over the live session's state. This
      // is a QUESTION the session asks the face, and it has to be answered:
      // guarding it would return nothing to a caller expecting a turn.
      heard: () => face.heard(),
    })
  } catch (error: unknown) {
    // Only the current one gets to say so. A stale failure would overwrite the
    // state of the session that replaced it.
    if (mine === opening) {
      show(String(error))
      // And the ring stops promising a microphone. `session` is null from the
      // top of this function, so this is what turns the halo off rather than
      // leaving it filled over a negotiation that never completed.
      applyMicrophone()
    }
    return
  }

  // Somebody asked for a newer one while this was negotiating. CLOSED rather
  // than dropped: it holds a peer and, if she was allowed one, a microphone.
  if (mine !== opening) {
    next.close()
    return
  }
  session = next

  // Off unless this persona asked for it. The surface is opaque paper rather
  // than her colour: the design settles it as a rule — anything carrying words
  // gets its own opaque surface, because she may sit on anything, a photograph
  // included, and a translucent one has no contrast ratio at all.
  // Her appearance first: `wear` also drops the previous voice's learned
  // speaking rate, and doing it before she can speak means the first utterance
  // is paced against the right voice rather than the last one's.
  /*
    Her colour on the document BEFORE the rig reads it back.

    `face.wear` re-resolves the palette so the halo takes the worn character's
    green; that read is only correct if `applyAccent` has already run. The two
    were the other way round, which would have left the halo one character
    behind on every switch.
  */
  /*
    The load-time contrast guard, in the window she actually lives in.

    `contrastFailures` is the reason a persona cannot ship an unreadable
    interface, and it was running in the two windows somebody opens on purpose
    and not in the one that is on screen all day. It runs here for the same
    reason it runs there — this is the moment a stranger's hue first exists —
    and it is SAID rather than swallowed, because falling back silently leaves
    somebody looking at a green companion wondering why the character they chose
    had no effect.
  */
  const unreadable = applyAccent(document.documentElement, next.face)
  if (unreadable.length > 0) {
    window.mochi.report({
      kind: 'note',
      // PRONOUN-FREE. This reaches the Troubles drawer through `report`, so it
      // is read by a person — and the companion has no pronoun to resolve:
      // `SessionConfig` does not carry one, and adding a field to every session
      // to word two diagnostics is the wrong trade. `says.ts` states the rule.
      text: `the character's colour was refused and the built-in used instead — ${unreadable.join('; ')}`,
    })
  }
  face.wear(next.face)
  face.showWords(next.bubble)
  // Whatever main could not do while assembling all of the above. Usually none;
  // when there are any, the shoulder control says so on its own.
  problems = keepsNewer(next.problems, problems, arrived.problems !== before.problems)
  face.troubled(problems)
  bubbleSide = keepsNewer(next.bubbleSide, bubbleSide, arrived.bubbleSide !== before.bubbleSide)
  face.prefersBubble(bubbleSide as Parameters<typeof face.prefersBubble>[0])
  /*
    How she was left — unless she was told otherwise while this was negotiating.

    `next.asleep` is a snapshot taken when the session was configured, and this
    line applied it unconditionally after two network round trips. Toggle rest in
    that window and the stale answer won, in both directions and neither
    self-correcting: `setAsleep` in main returns early when the value has not
    changed, so main never re-sends a value it believes the renderer already has.
    The two halves stay disagreeing until somebody toggles rest twice.

    Woken during a negotiation, she kept `asleep: true` — eyes held shut by
    `blink: 1` and the microphone closed — while main thought she was up and went
    on driving her voice. That is talking with her eyes closed and not hearing a
    word, which is what this was reported as.

    Put to REST during one, she kept `asleep: false`, and that is the direction
    that matters more: her microphone stayed open after somebody had asked her to
    stop listening.

    Exactly the shape `held` fixes for grants, three lines up.
  */
  asleep = keepsNewer(next.asleep, asleep, arrived.rest !== before.rest)
  face.sleeps(asleep)
  // Nothing from the last session is owed by this one. A beat still held when
  // the hour ran out would otherwise carry into the new session and go overdue
  // there, asking somebody to repeat something they never said to it.
  face.opened()

  /**
   * The held grants BEFORE the microphone is touched, and that order is kept.
   *
   * It mattered absolutely when one of the grants WAS the microphone: a
   * revocation arriving mid-negotiation is newer than the snapshot the session
   * was configured from, and applying it afterwards meant the track was enabled
   * from the stale answer first — she transmitted, briefly, into a permission
   * somebody had already taken away. Nothing here touches the track any more,
   * so the order is no longer load-bearing; it is kept because "the newest
   * answer wins before anything acts on the old one" is the rule, and a rule
   * that is only followed where it is currently provable is not one.
   */
  applyHeldGrants()
  // The microphone opens only once the session is up, so she is never
  // transmitting into a peer that is still being negotiated.
  applyMicrophone()
}

/**
 * Main asks for a reconnect by sending a frame the service would never send.
 *
 * A private type rather than a second channel: `voice:send` already exists and
 * already crosses in the right direction, and the alternative is a channel per
 * lifecycle event — which is the shape v1's 45 message kinds grew out of.
 */
// Deliberately never unsubscribed: this one lives as long as the window does,
// unlike the session's, which comes and goes with each peer.
window.mochi.onSend((frame) => {
  const type = (frame as { type?: unknown }).type
  if (type === '__mochi_reconnect__') void open()
  // A late answer landed. The session decides whether she may speak yet; with
  // no session there is nothing queued to speak, so nothing to do.
  if (type === '__mochi_volunteer__') session?.volunteer()
  /**
   * Close it, and do not open another.
   *
   * Resting used to mute the microphone track and leave everything else up: the
   * peer, the data channel, the remote audio element and the hourly reconnect
   * (§53). So "asleep" was a companion holding a live connection to the service
   * all night, renewing it every hour.
   *
   * `opening` is bumped as well as the session closed, and that is the half
   * that is easy to miss: a reconnect can be in flight when this arrives, and
   * without it that negotiation completes a few seconds later and assigns
   * itself to `session` — reopening the thing that was just closed, with
   * nothing on screen to say why she is listening again.
   */
  if (type === '__mochi_close__') {
    opening += 1
    session?.close()
    session = null
    // Nothing from that session is owed by whatever comes next, and a beat left
    // held would go overdue against a session that no longer exists.
    face.opened()
    face.working(0)
    // And the ring and the menu bar stop saying she can hear you. `session` is
    // null one line up, so this is the transition that turns both off — without
    // it, closing a session left a filled halo over a window holding no peer.
    applyMicrophone()
  }
  if (type === '__mochi_working__') {
    /*
      CHECKED, unlike the bare `Number(...)` this replaces.

      Every other frame on this listener validates -- `when === 'listening' ||
      ...`, `shown !== false` -- and each says why. This one did not, and
      `Number(undefined)` is `NaN`, as is `Number({})`. A `NaN` count is not a
      count: it compares false against every threshold, so the indicator that
      says she is still working on something silently never comes on again for
      the life of the window.

      Failing toward zero rather than toward "something is outstanding": a
      spinner that never stops is worse than one that never starts, and this
      frame is re-sent on every change, so the next good one corrects it.
    */
    const outstanding = (frame as { outstanding?: unknown }).outstanding
    face.working(typeof outstanding === 'number' && Number.isFinite(outstanding) ? outstanding : 0)
  }
  if (type === '__mochi_halo__') {
    /*
      An unreadable answer leaves the ring at `always`.

      It used to be `!== false` for the same reason: everything else about this
      preference is taste, and the direction a wrong guess fails in is not. That
      argument is weaker than it was — the menu bar carries the microphone now,
      so a hidden halo hides nothing anybody needs — and it is kept anyway,
      because failing toward MORE indication costs a ring somebody did not want
      and failing the other way costs the thing this app promises.
    */
    const when = (frame as { when?: unknown }).when
    face.showsHalo(when === 'listening' || when === 'never' ? when : 'always')
  }
  if (type === '__mochi_chip__') {
    // `!== false` again: a frame this side cannot read leaves the control on
    // screen. A missing indicator is a lie about the microphone; a missing
    // button is only a missing button — but it still reads as a broken app, and
    // failing toward the thing existing is the same answer to both.
    face.showsShoulderChip((frame as { shown?: unknown }).shown !== false)
  }
  // Problems keep happening after the session opens — a capability that threw,
  // a reconnect that could not be scheduled. The count on `session.problems` is
  // a snapshot taken at the door; this is how it stays true afterwards.
  if (type === '__mochi_problems__') {
    arrived.problems += 1
    problems = Number((frame as { count?: unknown }).count)
    face.troubled(problems)
  }
  // Somebody picked a side in the menu bar. Straight through, because they are
  // looking at her while they pick it.
  // She was dragged against the top of the display and had to rise inside her
  // own window to get there. See `dragTo`.
  if (type === '__mochi_stance__') {
    face.stands(Number((frame as { feetFromTop?: unknown }).feetFromTop))
  }
  /*
    Where main just put this window.

    Told rather than read: `window.screenX` is a cached rect Chromium refreshes
    on notifications it does not reliably get for a frameless transparent
    window moved by `setPosition`. Measured on 2026-08-28 — a fit moved her 27px
    and the renderer reported the pre-fit value for as long as the window stayed
    open — and a drag makes that error unbounded.

    Checked before it is used, like every other number crossing this bridge: a
    `NaN` origin would put the bubble and the chip somewhere no click lands, and
    it would do it silently.
  */
  if (type === '__mochi_origin__') {
    const x = Number((frame as { x?: unknown }).x)
    const y = Number((frame as { y?: unknown }).y)
    if (Number.isFinite(x) && Number.isFinite(y)) face.movedTo({ x, y })
  }
  /**
   * Asleep, or awake. BOTH halves happen here, and they belong together: the
   * microphone is what makes it true, and her eyes are what makes it legible.
   * Either one alone is a bug somebody would report as the other.
   */
  /*
    She chose a face. Validated HERE as well as in the handler, because this
    process trusts nothing that crosses the bridge — the same rule the grants
    frame states: a value this side cannot read is not one it may act on.
  */
  if (type === '__mochi_cannot__') {
    /*
      A credential that will not work, said before it is tried.

      The status line already carries the reason a session FAILED — `describe`
      puts `state.failed` under her. What it could not do was say so before
      anybody spoke to her, and the borrowed token expires after about ten days
      without warning (`codex/auth.ts`), so the ordinary shape of this fault is
      somebody talking to a companion who was never going to answer.

      Main knows at startup. This is the channel that lets her say it then,
      rather than after the first silence.

      NOT a modal and not a refusal to appear: it is fixed by running `codex`
      once, and a companion that hides in order to tell you about it is a worse
      trade than a sentence under her feet.
    */
    const why = (frame as { why?: unknown }).why
    if (typeof why === 'string' && why !== '') show(why)
    return
  }

  if (type === '__mochi_face__') {
    const chosen = (frame as { face?: unknown }).face
    if (typeof chosen === 'string' && (EMOTIONS as readonly string[]).includes(chosen)) {
      face.wears(chosen as Emotion)
    }
  }
  if (type === '__mochi_asleep__') {
    arrived.rest += 1
    asleep = (frame as { asleep?: unknown }).asleep === true
    face.sleeps(asleep)
    applyMicrophone()
  }
  /**
   * A standing grant changed while she was up — 5b.
   *
   * The whole point of a standing switch is that it works while somebody is
   * looking at it, so this does not wait for the next wake. Two halves, and
   * they go to different places: the microphone is a track only this process
   * holds, and everything else is a `session.update` carrying the new tool list
   * and the instructions that tell her what she may no longer do.
   */
  if (type === '__mochi_grants__') {
    const said = frame as { instructions?: unknown; tools?: unknown }
    /**
     * Checked WHOLE, and it stays that way with one field fewer.
     *
     * These are permissions, so a frame this process cannot read is not one it
     * may act on: a malformed frame changes nothing and says so out loud rather
     * than applying the half it could parse.
     */
    if (typeof said.instructions !== 'string' || !Array.isArray(said.tools)) {
      window.mochi.report({ kind: 'note', text: 'a malformed grants frame was ignored' })
      return
    }
    held = { instructions: said.instructions, tools: said.tools }
    // Applied now if there is a session, and kept for the one that is opening
    // if there is not. Either way the switch is not lost.
    applyHeldGrants()
  }
  if (type === '__mochi_bubble_side__') {
    arrived.bubbleSide += 1
    bubbleSide = String((frame as { side?: unknown }).side)
    face.prefersBubble(bubbleSide as Parameters<typeof face.prefersBubble>[0])
  }
})

/*
  The first session is MAIN's to ask for, and this file no longer opens one.

  It ended in a bare `void open()`, so a session was negotiated on every launch
  before anything had asked for one — including a launch into a stored
  `asleep: true`, where the entire meaning of the state is that she is not
  participating. `session.ts`'s own header says where that decision belongs:
  which capability runs, whether a call has been answered, when to reconnect —
  *"all of it is main's, because all of it is a decision about what this machine
  does on somebody's behalf"*. This process holds the peer and the microphone,
  which makes it the one that should have the least say in when they exist.

  Main sends `__mochi_reconnect__` on `did-finish-load`, which fires after this
  module has run and therefore after the listener above is registered — and
  again on a reload, which is what makes a development refresh reconnect rather
  than sit there mute.
*/

/*
  THE LAST RESORT, and there was none.

  Everything this window knows how to report goes through `say`/`show` -- and
  every one of those is a path somebody thought of. An exception escaping a
  listener, or a promise nobody awaited, reached the devtools console and
  nothing else. In a packaged app nobody has devtools open, so the failures
  with no handler were also the failures with no evidence.

  Routed to main's `problems`, which is where the rest of the app's failures
  already are, so one place answers "what has gone wrong".
*/
window.addEventListener('error', (event) => {
  window.mochi.report({
    kind: 'note',
    text: `[companion] uncaught: ${event.message} (${event.filename}:${String(event.lineno)})`,
  })
})

window.addEventListener('unhandledrejection', (event) => {
  window.mochi.report({
    kind: 'note',
    text: `[companion] unhandled rejection: ${String(event.reason)}`,
  })
})
