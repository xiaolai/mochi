import type { MochiApi } from '@shared/ipc'
import { showFace, type Face } from './face'
import { applyAccent } from '../design/apply-accent'
import { openSession, type Session, type SessionState } from './audio/session'

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

/**
 * How far under her the status line sits, as a fraction of her own height.
 *
 * A fraction rather than a pixel count, because `size` is a persona field: a
 * fixed 8px touches her at 150% and floats at 50%, which is the same class of
 * mistake as anchoring to the window.
 *
 * 0.22 rather than something smaller because `box()` returns her SILHOUETTE —
 * that is what main uses for click-through, so it must not grow — and her drop
 * shadow is drawn below it. At 8px the pill sat under her feet and over her
 * shadow, which reads as touching her.
 */
const UNDER_HER = 0.22

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
  // One meaning for one constant: the clearance this line keeps from whatever
  // is directly above it, which is her when nothing else is drawn and the beat
  // when there is one. `max` here would leave them touching at zero.
  const clear = face.occupiedBelow() + her.height * UNDER_HER
  status.setAttribute('style', `top: ${String(Math.round(her.top + her.height + clear))}px`)
}

/*
  Placed once at startup, BELOW the declarations it reads.

  The first version of this call sat immediately after `showFace`, which is above
  `UNDER_HER` — a `const` in its temporal dead zone, so the module threw on the
  first line it ran and the window rendered with no script at all. It looked
  exactly like the bug it was fixing: a status line at the bottom of the window.
*/
placeStatus()
/*
  Re-placed on a rhythm, because what it has to clear is drawn on a canvas.

  The beat fades in over 0.12s and away again, so how much room is taken under
  her changes on frames rather than on events — there is nothing to subscribe to.
  Four times a second is far below the cost of noticing and far above the rate a
  person can see the difference; the alternative is threading a callback out of
  the render loop for a line that is empty most of the time.
*/
setInterval(placeStatus, 250)
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
 * Whether the microphone may be open, which is TWO answers rather than one.
 *
 * `asleep` is where she was left; `mayHear` is 5b's standing grant. They change
 * from different places — the tray, a key and a click for the first, the
 * settings window for the second — and either one alone closes the microphone.
 * Held here rather than derived at each call site, because a call site that
 * knew only its own half would re-open the track the other half had closed.
 */
let asleep = false
let mayHear = true

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
let held: { microphone: boolean; instructions: string; tools: readonly unknown[] } | null = null

function applyMicrophone(): void {
  const on = !asleep && mayHear
  session?.listen(on)
  // Her side of it too. With no microphone there is no turn to detect, and a
  // track that is muted or ended still produces frames — silence read as "they
  // stopped talking" put her into a held beat behind a closed microphone.
  face.hears(on)
}

/**
 * Whatever arrived while she was opening, applied now that she is up.
 *
 * Returns whether a NEW session is needed. A session opened while the
 * microphone grant was off never asked for the device, so it has no track and
 * cannot grow one — the offer is already negotiated. Turning the grant back on
 * is therefore a reconnect rather than a flag, and this is where that is known.
 */
function applyHeldGrants(): boolean {
  if (session === null || held === null) return false
  const change = held
  held = null
  mayHear = change.microphone
  // GIVEN BACK, not merely muted. `listen(false)` leaves the device open and
  // the indicator lit, which is the one thing somebody can see from outside the
  // app — and it is the thing a switch marked "Hear you" promises.
  if (!mayHear) session.closeMicrophone()
  session.mayDo({ instructions: change.instructions, tools: change.tools })
  applyMicrophone()
  return mayHear && !session.hasMicrophone()
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

async function open(): Promise<void> {
  const mine = ++opening
  session?.close()
  session = null

  let next: Session
  try {
    next = await openSession({
      onState: (state) => show(describe(state)),
      onRemote: (stream) => {
        speaker.srcObject = stream
        // The same stream, tapped twice: played, and measured for the mouth.
        // §19 is why the mouth cannot come from her text instead — the words
        // arrive 2.1–7.9s before the audio finishes draining.
        face.hear(stream)
      },
      onExpiry: () => {
        /* main schedules the reconnect; nothing to do here */
      },
      onSaying: (delta, responseId) => face.saying(delta, responseId),
      onMicrophone: (stream) => face.listen(stream),
      onSpeaks: (responseId) => face.speaks(responseId),
      onFinished: (id, interrupted) => face.finished(id, interrupted),
      heard: () => face.heard(),
    })
  } catch (error: unknown) {
    // Only the current one gets to say so. A stale failure would overwrite the
    // state of the session that replaced it.
    if (mine === opening) show(String(error))
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
  face.wear(next.face)
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
      text: `her colour was refused and the built-in used instead — ${unreadable.join('; ')}`,
    })
  }
  face.showWords(next.bubble)
  // Whatever main could not do while assembling all of the above. Usually none;
  // when there are any, the shoulder control says so on its own.
  face.troubled(next.problems)
  face.prefersBubble(next.bubbleSide as Parameters<typeof face.prefersBubble>[0])
  // How she was left, and what she is allowed.
  asleep = next.asleep
  mayHear = next.microphone
  face.sleeps(asleep)
  // Nothing from the last session is owed by this one. A beat still held when
  // the hour ran out would otherwise carry into the new session and go overdue
  // there, asking somebody to repeat something they never said to it.
  face.opened()

  /**
   * The held grant BEFORE the microphone is touched, and that order is the
   * point.
   *
   * `next.microphone` is a snapshot taken when this session was configured. A
   * revocation that arrived while it was negotiating is newer, and applying it
   * afterwards meant the track was enabled from the stale answer first — she
   * transmitted, briefly, into a permission somebody had already taken away.
   */
  const needsAnother = applyHeldGrants()
  // The microphone opens only once the session is up, so she is never
  // transmitting into a peer that is still being negotiated.
  applyMicrophone()

  /**
   * And the other direction: a grant GIVEN BACK while this was opening.
   *
   * This session never asked for the device, so it has no track and cannot grow
   * one — the offer is already answered. Honouring the answer rather than
   * ignoring it is what stops her staying deaf until an unrelated reconnect an
   * hour later.
   */
  if (needsAnother) {
    window.mochi.report({ kind: 'note', text: 'the microphone was allowed while opening' })
    void open()
  }
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
  // Problems keep happening after the session opens — a capability that threw,
  // a reconnect that could not be scheduled. The count on `session.problems` is
  // a snapshot taken at the door; this is how it stays true afterwards.
  if (type === '__mochi_problems__') face.troubled(Number((frame as { count?: unknown }).count))
  // Somebody picked a side in the menu bar. Straight through, because they are
  // looking at her while they pick it.
  // She was dragged against the top of the display and had to rise inside her
  // own window to get there. See `dragTo`.
  if (type === '__mochi_stance__') {
    face.stands(Number((frame as { feetFromTop?: unknown }).feetFromTop))
  }
  /**
   * Asleep, or awake. BOTH halves happen here, and they belong together: the
   * microphone is what makes it true, and her eyes are what makes it legible.
   * Either one alone is a bug somebody would report as the other.
   */
  if (type === '__mochi_asleep__') {
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
    const said = frame as { microphone?: unknown; instructions?: unknown; tools?: unknown }
    /**
     * Checked WHOLE, and an explicit boolean.
     *
     * `!== false` was the first version and it fails in the wrong direction: a
     * frame missing the field, or carrying a value from a build that spelt it
     * differently, opened the microphone. A permission this process cannot read
     * is not a permission it may act on, so a malformed frame changes nothing
     * and says so out loud instead.
     */
    if (
      typeof said.microphone !== 'boolean' ||
      typeof said.instructions !== 'string' ||
      !Array.isArray(said.tools)
    ) {
      window.mochi.report({ kind: 'note', text: 'a malformed grants frame was ignored' })
      return
    }
    held = { microphone: said.microphone, instructions: said.instructions, tools: said.tools }
    // Applied now if there is a session, and kept for the one that is opening
    // if there is not. Either way the switch is not lost.
    //
    // A microphone GIVEN BACK needs a new session: this one never opened the
    // device, so there is no track to enable and no way to add one to an offer
    // that has already been answered. Taking it away needs no reconnect — the
    // track is stopped where it stands.
    if (applyHeldGrants()) {
      window.mochi.report({ kind: 'note', text: 'the microphone was allowed; reconnecting' })
      void open()
    }
  }
  if (type === '__mochi_bubble_side__') {
    face.prefersBubble(
      String((frame as { side?: unknown }).side) as Parameters<typeof face.prefersBubble>[0],
    )
  }
})

void open()
