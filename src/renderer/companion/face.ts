import { MochiAvatar } from './rig/mochi'
import { MOCHI, type FaceSpec } from '@shared/avatar-spec'
import type { Emotion } from '@shared/avatar'
import type { HaloWhen } from '@shared/ipc'
import { advanceEnvelope, rms, DEFAULT_ENVELOPE, SILENT } from './rig/envelope'
import { createRepose, type Ambient } from './repose'
import { createBubble } from './bubble'
import { resolvePalette, whenSchemeChanges, type Palette } from '../design/resolve'
import { fullPad, type Pad } from '@shared/avatar-layout'
import { createUtterance } from './utterance'
import { createAttending, levelOf, type Attention } from './attending'
import { createLoopback } from './loopback'
import { createBeat, type Beat } from './beat'
import { drawChip, hits as chipHits, visible as chipVisible } from './chip'
import { drawHalo, haloFor } from './halo'
import { type SidePreference } from './place'
import { layoutFor, FEET_FROM_TOP } from '@shared/avatar-layout'
import { bodyOf, boxFor, padFor } from './her-geometry'
import { roomOnScreen, sidesFor } from './screen-room'
import { padChange } from './pad-change'

/**
 * Her, on screen.
 *
 * The rig itself was migrated whole from v1 and is not touched here — this is
 * only what connects it to a canvas, a cursor, and her voice. `MochiAvatar`
 * takes a context rather than an element for exactly that reason: the same
 * class renders in this window, in the tuner, and in a test against a headless
 * rasteriser.
 *
 * ## The mouth is driven by her audio, not by her text
 *
 * `EnvelopeMouth` watches the loudness of the stream coming back and opens the
 * mouth to match. Nothing here knows what she is saying, and that is what makes
 * it right: §19 measured her text arriving 2.1–7.9 seconds before her audio
 * finishes draining, so a mouth driven by the transcript would finish talking
 * while she was still speaking.
 *
 * ## Click-through is decided per frame, from the silhouette
 *
 * The window is a square of empty pixels. `hitTest` asks the rig whether a
 * point is inside the shape actually painted — one array, not two pieces of
 * geometry agreeing — and the answer is handed to main, which owns the window.
 * Move the cursor off her and clicks land on whatever is underneath.
 */

export interface Face {
  /**
   * Where she actually is in the canvas, in CSS pixels.
   *
   * Her window is deliberately much larger than she is — wide enough for a whole
   * bubble to stand beside her, tall enough for one above and one below — so
   * "near her" and "near an edge of the window" are hundreds of pixels apart.
   * Anything in the DOM that belongs to HER has to ask for this rather than
   * anchor to the window, and the status line spent this whole build anchored to
   * the window.
   *
   * The same rectangle main is sent for click-through, so there is one answer to
   * where she is rather than two that agree until they do not.
   */
  box(): { left: number; top: number; width: number; height: number }
  /** Her voice, once the peer hands it over. Drives the mouth. */
  hear(stream: MediaStream): void
  /**
   * The microphone, so she can tell they stopped without waiting to be told.
   *
   * §62: the service takes 1026ms at the median to report it, and no setting
   * shortens that. This does not make her faster — it makes the wait legible,
   * which is a different problem with a different fix.
   */
  listen(stream: MediaStream): void
  /** One fragment of what she is saying, with the RESPONSE it belongs to. */
  saying(delta: string, responseId: string): void
  /** Her voice for this item has started. Paces the cursor. */
  speaks(responseId: string): void
  /** And has finished, naturally or by interruption. The two differ; see `pace.ts`. */
  finished(responseId: string, interrupted: boolean): void
  /**
   * Where she is estimated to have got to, for whoever files what was heard.
   *
   * Read at the moment of a barge-in. §60 scored this against transcripts of her
   * own truncated audio: −3% to −22%, always short, against +446% to +513% for
   * filing everything she generated.
   */
  heard(): { text: string; at: number; responseId: string | null }
  /**
   * A different character is being worn: her face, and a new voice.
   *
   * The face arrives as DATA from main, already validated by `parseFaceSpec`.
   * Nothing here reads a file — the renderer is the process with the least
   * authority and user content is read exactly once, upstream.
   */
  wear(face: FaceSpec): void
  /** Which side of her the bubble should sit on, or `auto`. */
  prefersBubble(side: SidePreference): void
  /**
   * Where main just put this window, in screen coordinates.
   *
   * Told rather than read. `window.screenX` is a cached rect Chromium refreshes
   * on notifications it does not reliably get for a frameless transparent
   * window moved by `setPosition` — measured twice in this file's history, most
   * recently on 2026-08-28 when a fit moved her 27px and the renderer reported
   * the pre-fit value for as long as the window stayed open.
   */
  movedTo(origin: { x: number; y: number }): void
  /**
   * Eyes shut and not listening.
   *
   * Only what is drawn and what is clickable. Closing the microphone belongs to
   * whoever holds the session.
   */
  sleeps(asleep: boolean): void
  /**
   * Whether the microphone is open at all.
   *
   * TWO things close it and they are not the same: she is asleep, or the grant
   * was taken away. Either one means there is no turn to detect, so the beat
   * must not open — a disabled or ended track still produces frames, and
   * silence read as "they stopped talking" put her into a held beat behind a
   * microphone that was not listening.
   */
  hears(on: boolean): void
  /**
   * How far into her window she is standing.
   *
   * Main drives it: dragged against the top of the display the window can rise
   * no further, so she rises inside it instead. See `dragTo`.
   */
  stands(feetFromTop: number): void
  /**
   * A new session is up. Nothing the last one was waiting on is owed by it.
   *
   * A wake opens a new session and so does every reconnect (§53: hourly), and
   * this object outlives both — so a beat still held when the hour ran out
   * carried into the next session and went overdue there, asking somebody to
   * repeat something they had never said to it.
   */
  opened(): void
  /** Turn the bubble on for this persona, with the surface it draws on. */
  /**
   * Whether her words appear above her head.
   *
   * A boolean rather than a palette, because the colours are the design
   * system's and never main's: this side already reads them from the sheet for
   * the chip, and a caller handing in `#f4f2ea` is a caller that can hand in the
   * wrong `#f4f2ea` — which is exactly what happened.
   */
  showWords(shown: boolean): void
  /**
   * Wear one of her expressions, until it is replaced or she is asked to rest.
   *
   * ONE caller: the `__mochi_face__` frame, which only the shelf's preview
   * sends. `set_expression` was the other and was removed on 2026-08-26,
   * unused in 275 sessions.
   *
   * `repose.ts` is NOT a caller, and a comment here briefly said it was —
   * repose drives motion clips and contains no expression code. What changes
   * her face without anybody asking is two reactions in this file: neutral
   * when she sleeps, a perk when she wakes.
   *
   * Which is the same story the six unreachable faces always told.
   *
   * Held rather than timed. The rig can expire an emotion on its own clock, and
   * a face that faded after a few seconds would contradict what she is told —
   * the tool's description says it stays until she changes it.
   */
  wears(face: Emotion): void
  /**
   * How many things main could not do, so the shoulder control can say so.
   *
   * A COUNT, not the problems themselves: the renderer that draws her has no
   * business holding the text of a persona that failed to parse, and cannot do
   * anything with it. The window that CAN read them asks main directly.
   */
  troubled(count: number): void
  /**
   * How many things she has said she would come back to and has not yet.
   *
   * The bead on her halo, for the wait `beat.ts` does not cover. The beat is
   * the 1.5–2s before her voice arrives (§64) and it closes the instant she
   * speaks — but a lookup runs about 22 seconds (§8) and she has already said
   * "let me check" by then, so the one wait long enough to need an indicator
   * was the one with nothing on screen.
   *
   * A COUNT, because two lookups in flight are one indicator and the frame
   * settling the first must not turn it off. Main sends the number and the
   * arithmetic is done there; this only has to be greater than zero.
   */
  working(outstanding: number): void
  /**
   * When the halo is drawn: `always`, only while `listening`, or `never`.
   *
   * It was a boolean over the resting hairline alone, and it had to be: while
   * the halo was the only surface saying the microphone was open, a preference
   * that could switch it off was a preference that could switch off the one
   * thing `halo.ts` exists to guarantee. The tray marks itself while the
   * microphone is live now — it cannot be hidden and it is the only way to quit
   * — so this is about her appearance and `never` is an ordinary answer.
   */
  showsHalo(when: HaloWhen): void
  /**
   * Whether the speech-bubble control is offered at her shoulder at all.
   *
   * A plain preference, unlike the one above it. That one had to be narrowed
   * because the halo is the only thing on screen that says the microphone is
   * open; this is a shortcut to a window two other controls also open, so there
   * is nothing here that must survive being switched off. See
   * `readShoulderChip`.
   */
  showsShoulderChip(shown: boolean): void
  /** Stop the loop, release the analyser, drop the canvas. */
  dispose(): void
}

/** Long enough to read as a fade, short enough not to feel like a delay. */
const CHIP_FADE_S = 0.12

/**
 * The perk on waking: how long she looks pleased to see you.
 *
 * `looks.ts` documented this against the catchlight -- "her eyes lit up" is a
 * property of the emotion rather than a timer, so seeing it carries
 * information -- and then nothing ever set it. The glint was reachable only if
 * she chose `happy` or `surprised` herself, which `usage.json` says she has
 * never once done in 275 sessions.
 *
 * Short, and at PARTIAL intensity. A full `surprised` is the face for being
 * startled; six tenths of it is the small lift of somebody coming back to a
 * conversation. Long enough to be seen, short enough that it is over before
 * she has finished her first sentence.
 */
const WAKING_PERK_MS = 1_400
const WAKING_PERK_INTENSITY = 0.6

/**
 * Its own surface, like the bubble's and for the same reason: she may be sitting
 * on anything, so a control tinted by the desktop behind it has no contrast
 * guarantee at all.
 *
 * It used to be a literal pair here — `#f4f2ea` / `#2b2c25` — which was one
 * digit off `--paper` and a different colour from `--ink`, and had no dark half
 * at all. Read from the sheet now, so it cannot drift, and re-read when the
 * scheme flips rather than only at startup: somebody switching macOS to dark at
 * dusk should not leave her painted for daylight.
 *
 * Still not themed per persona, which was the original note's real point and is
 * unchanged: her colour says who she is, and a control is something you operate.
 */
let palette: Palette = resolvePalette(document.documentElement)
whenSchemeChanges(document.documentElement, (next) => {
  palette = next
  // The render loop reads this every frame, so nothing else has to happen.
})

export function showFace(canvas: HTMLCanvasElement): Face {
  const found = canvas.getContext('2d')
  if (found === null) throw new Error('companion: the canvas has no 2d context')
  // Re-bound so the narrowing survives into the render loop below.
  const ctx: CanvasRenderingContext2D = found

  /**
   * A SIZE, not `fit-canvas`.
   *
   * `mochi.ts` warns about exactly this: the companion window "forgot to pass a
   * percentage and fell through to the canvas fit", which looked right because
   * main had sized the canvas — so the renderer was re-deriving main's answer
   * from main's own number and she grew to whatever the window happened to be.
   *
   * 100% is the spec's own default and puts her `bodyW` of 100 units at
   * `BASE_UNIT_SCALE` 0.94 — about **94 CSS pixels** wide. The window stays
   * larger than her on purpose: the bubble draws above her head and needs the
   * width to be readable, and the chip needs the corner.
   */
  /**
   * She starts at the built-in's size and is re-sized the moment a face is
   * worn. `MOCHI.size` rather than a literal, so there is one answer to "how
   * big is she by default" and it lives in the format.
   */
  let worn: FaceSpec = MOCHI
  const avatar = new MochiAvatar(ctx, { size: worn.size, face: worn })

  /*
    Ask the system whether she should be moving, and keep asking.

    She is the ONLY surface in this app with motion. The stylesheets have no
    transitions and no keyframes at all — `tokens.css` carries a
    `prefers-reduced-motion` block that zeroes two duration tokens, and it is
    honest that it is a placeholder for motion the shelf does not yet have. So
    the preference was declared and never once consulted where anything moves:
    the breath, the drift, the blink schedule and the ambient loops all ran
    regardless.

    A LISTENER rather than one read at startup. This is a preference somebody
    changes because something on screen is making them ill, and an app that only
    checks it at launch asks them to quit and reopen at the exact moment they
    least want to look at it. `matchMedia` fires on change and Electron passes
    the OS setting through.
  */
  const stillness = window.matchMedia('(prefers-reduced-motion: reduce)')
  avatar.setReducedMotion(stillness.matches)
  const onStillness = (event: MediaQueryListEvent): void => {
    avatar.setReducedMotion(event.matches)
  }
  stillness.addEventListener('change', onStillness)

  /** Her rectangle inside her own window. See `boxFor`. */
  function herBox(): { left: number; top: number; width: number; height: number } {
    return boxFor(worn, pad, feet, roomy)
  }

  /** The room she needs right now. See `padFor`. */
  function padNeeded(): Pad {
    return padFor(worn, showingWords, bubble.opacity())
  }

  /**
   * Ask for a window that fits, and only when the answer has changed.
   *
   * Every frame computes the pad; almost every frame it is identical, and a
   * `setBounds` per frame would be sixty window resizes a second. The comparison
   * is what makes this cheap enough to live in the render loop, which is in turn
   * what makes it track what is drawn rather than track a list of events
   * somebody remembered to hook.
   */
  function fitToContent(): void {
    const wanted = padNeeded()
    const settled = padChange(pad, wanted, shrinkWantedSince, performance.now())
    shrinkWantedSince = settled.shrinkWantedSince
    if (!settled.apply) return
    const was = herBox()
    pad = wanted
    /*
      Tell the RIG where the pad puts her, or it keeps standing her where the
      canvas alone suggests.

      `feetY` places her at `min(FEET_FROM_TOP, canvasHeight - clearance)`, which
      answered 132 in a 140px window while the pad said 100 — so `herBox()` and
      the painted pixels were 32px apart vertically as well as 12 horizontally.
      `setFeet` is the seam the drag already uses for exactly this.
    */
    /*
      BOTH copies of her standing height, from one number.

      Her position is held twice — `feet` here, which `herBox()` measures from,
      and `MochiAvatar.feetFromTop`, which she is PAINTED from — and this line
      used to set only the second. `stands()` sets both, so the two agreed
      whenever main last sent a stance and drifted the moment a pad change came
      between two stances.

      What that looks like: `herBox()` said her top was `pad.top` (26 for the
      small pad) while the rig painted her at `FEET_FROM_TOP - bodyHeight`
      (267). Everything that MEASURES her — the halo over her head, the bubble's
      anchor, the shoulder chip, the click-through rectangle — was 241px above
      the pixels she was drawn as. Nothing looked broken; it looked absurd.

      Nothing is lost by assigning both. The rig's copy was already being
      overwritten here, so a stance did not survive a pad change either way;
      this only stops the other copy pretending it did.
    */
    feet = wanted.top + layoutFor(worn, worn.size).bodyHeight
    avatar.setFeet(feet)
    roomy = showingWords && bubble.opacity() > 0
    /*
      Her OFFSET under the pad still on screen — not her position on it.

      Main used to derive her position by adding the last offset it was told to
      the window's current bounds: two facts from different messages, and
      `companion:body` writes that offset too, so an offset computed for one
      window size could be paired with another. Measured once at 443px from a
      corner she had been 4px from.

      The answer to that was `window.screenX + was.left`, on the grounds that
      both halves are read here, in this frame, so neither can be stale. The
      second half is true. The first is not: a renderer's screen coordinates are
      a cached rect Chromium refreshes on notifications it does not reliably get
      for a frameless transparent window moved by `setPosition`. It reported `0`
      for a window main had placed at 1957,1058 — including after the window was
      shown — so main moved her to the pad's own offsets from an origin of zero
      and she stopped coming back to where she had been left.

      So the renderer sends the half it genuinely knows. `was` is the layout it
      is drawing, and main pairs it with `getBounds()` inside the same handler:
      one moment, two facts, neither of them a coordinate this process has to
      guess at.
    */
    window.mochi.fit({
      pad: wanted,
      body: herBox(),
      was: { left: was.left, top: was.top },
    })
  }
  /** The sides a bubble would fit on, for the tray menu. See `sidesFor`. */
  function sidesForTheMenu(): ReturnType<typeof sidesFor> {
    return sidesFor(herBox(), bubbleSide, windowOrigin)
  }

  /**
   * Where main last put this window, or null before it has said.
   *
   * The renderer cannot read it: `window.screenX` is a cached rect Chromium
   * refreshes on notifications it does not reliably get for this window type —
   * the same measurement recorded above, confirmed again on 2026-08-28 when a
   * fit moved her 27px and the renderer went on reporting the old value for as
   * long as the window was open.
   */
  let windowOrigin: { x: number; y: number } | null = null

  /**
   * Which side of her somebody asked the bubble to sit on.
   *
   * Owned by main — it is in `preferences.json` beside the worn persona — and
   * pushed here on change. `auto` until main says otherwise, which is also what
   * it means when nobody has chosen.
   */
  let bubbleSide: SidePreference = 'auto'
  /** Asleep. Held here because it changes what a click on her means. */
  let resting = false
  /** Whether the microphone is open. See `hears` — sleep is not the only cause. */
  let hearing = true
  /** How far into the canvas she is standing. See `stands`. */
  let feet = FEET_FROM_TOP
  /**
   * The room reserved around her right now, and therefore where she sits in her
   * own window. Starts at the full layout so the first frame — drawn before any
   * fit round-trip completes — is the window main actually created.
   */
  /*
    Seeded from her LAID OUT size, not from the raw spec.

    `MOCHI.bodyW/bodyH` are design units; what is drawn is those times
    `BASE_UNIT_SCALE` — 100x78 becomes 94x73.32. Seeding from the raw numbers put
    the first frame's answer 3px left and 5px high of where she actually stands,
    and that answer is what main is told her body is, so the first resize moved
    her by the difference.
  */
  let pad: Pad = fullPad(bodyOf(layoutFor(MOCHI, MOCHI.size)))
  /**
   * Which of the halo's three states she is in.
   *
   * `hearing` is one boolean and conflates two causes — main computes it as
   * `!asleep && session !== null` — so "she is resting" is told apart from
   * "there is no session" using `resting`, which this file already holds. They
   * look identical to the microphone and must not look identical to a person.
   */
  /**
   * How many deferred capability calls are still owed an answer.
   *
   * Main's count, not one kept here: a renderer that tracked its own would be a
   * second record of the ledger's state, and the two would disagree exactly
   * when one of them was wrong.
   */
  let outstanding = 0
  /**
   * When the current run of outstanding work began, on the render clock.
   *
   * Set when the count goes from none to some and cleared when it goes back,
   * NOT reset per call: a second lookup starting while the first is running is
   * the same wait continuing, and restarting the clock would jump the bead back
   * to the top of the ring for a reason nobody watching could see.
   */
  let workingSince: number | null = null
  /** When the ring over her head is drawn at all. See `showsHalo`. */
  let haloWhen: HaloWhen = 'always'

  /**
   * How long she has been waiting on something, in seconds, or null.
   *
   * ONE clock for two waits, and they do not overlap in practice: the beat
   * closes when her voice arrives (§64) and a lookup only becomes outstanding
   * after she has spoken about it. Written as one function anyway, because
   * `drawHalo` takes one number and two sources feeding it separately is how a
   * bead comes to be drawn at two angles on alternate frames.
   *
   * The beat wins when both are live. It is the shorter and the more urgent of
   * the two, and it is the one somebody is actively waiting through.
   */
  function waitedFor(now: number): number | null {
    if (beat.state() !== 'none') return beat.heldFor()
    if (workingSince === null) return null
    return Math.max(0, (now - workingSince) / 1000)
  }
  /** Whether the window is currently the big one. See `herBox`. */
  let roomy = true
  /** When a smaller window first became the right answer. See `fitToContent`. */
  let shrinkWantedSince: number | null = null
  /** The last answer sent up, so an unchanged one is not sent again. */
  let lastOffered = ''

  const bubble = createBubble()
  /**
   * What she is saying, owned HERE rather than inside the bubble.
   *
   * The bubble is one consumer of it; the archive is the other, and the archive
   * must work for a persona with no bubble — which is the default. Every feed
   * below is therefore unconditional, and only the DRAWING is gated on colours.
   */
  const utterance = createUtterance()
  const attending = createAttending()
  /**
   * The pause before she answers, held locally. See `beat.ts` for §64's
   * measurement and for why nothing about it may come from the service.
   */
  const beat = createBeat()
  const repose = createRepose()
  /** The ambient loop actually playing, so a rung is started once and not per frame. */
  let ambient: Ambient = 'none'

  /**
   * How much of her own voice is coming back in. An INSTRUMENT, not a fix.
   *
   * §17 named the one thing nobody has measured — post-AEC residual on real
   * hardware — and said in terms that it is a measurement rather than a
   * threshold to nudge. See `loopback.ts`; nothing here acts on what it reports.
   */
  const loopback = createLoopback()

  /** The microphone's own analyser. Hers drives the mouth; this drives nothing
   *  she says — only whether she looks like she is waiting on somebody. */
  let mic: AnalyserNode | null = null
  let micSamples: Float32Array<ArrayBuffer> | null = null
  /** So the reaction fires on the CHANGE, not on every frame of the state. */
  let attention: Attention = 'idle'
  /** The same, for the beat. See `beat.ts`. */
  let waiting: Beat = 'none'

  /**
   * ONE envelope, driving both the mouth and the bubble.
   *
   * `EnvelopeMouth` wraps this and keeps the state private, which is right when
   * the mouth is the only consumer. It is not any more: the bubble's fade rule
   * is `quietFor`, from the same measurement. Running a second envelope beside
   * it would be two mechanisms deciding "is she talking" — and they would
   * disagree, silently, exactly at the boundary where it matters.
   */
  let envelope = SILENT

  let audio: AudioContext | null = null
  let analyser: AnalyserNode | null = null
  // `Float32Array<ArrayBuffer>`, not the bare alias: `getFloatTimeDomainData`
  // wants a view over a plain ArrayBuffer, and the default parameter is
  // `ArrayBufferLike`, which also admits a SharedArrayBuffer it cannot take.
  let samples: Float32Array<ArrayBuffer> | null = null
  /*
    The source nodes, held so the NEXT session can disconnect them.

    `hear` already reasons about not making a second `AudioContext` per
    reconnect — "they are not garbage collected while running, and this happens
    every hour (§53)" — and then connected a fresh `MediaStreamAudioSourceNode`
    into that one context on exactly that schedule, without letting go of the
    previous one. Same leak, one level down, in the function whose comment
    describes it.

    It is not only memory. A source left connected keeps feeding the analyser,
    so the mouth and the level meter read the sum of every stream she has ever
    had — a dead one from an hour ago mixed into the live one.
  */
  let micSource: MediaStreamAudioSourceNode | null = null
  let remoteSource: MediaStreamAudioSourceNode | null = null
  let frame = 0
  let lastAt: number | null = null
  /** What main was last told, so the IPC is not a per-frame message. */
  let solid: boolean | null = null
  /**
   * Whether a drag is running, and why this window has to know.
   *
   * ## The bug it fixes: she forgot where she had been put
   *
   * Her place on the desktop is written on `companion:drop`, which this window
   * sends from a `mouseup` listener — and the listener's own comment said *"the
   * cursor is routinely off her by the time the button comes up: that is what
   * dragging is."* Both halves are true and together they are the defect:
   * `setIgnoreMouseEvents(true, { forward: true })` forwards MOVES and lets
   * CLICKS through, so a release that happens off her silhouette is delivered
   * to the desktop and this listener never runs.
   *
   * That is not a rare corner. `dragTo` clamps her into the work area, so the
   * last inch of any drag toward an edge — which is where somebody puts her —
   * moves the cursor while she stands still, and the pointer ends up off her.
   * The drag then ran to its deadline, nothing was written, and quitting put
   * her back wherever she had last been dropped somewhere harmless.
   *
   * ## The fix, and its backstop
   *
   * While a drag is running the window is SOLID, whatever the pointer is over,
   * so the release lands here. That is correct on its own terms as well: during
   * a drag the pointer belongs to the drag.
   *
   * The backstop is in `mousemove` — a forwarded move carrying no buttons means
   * the release happened somewhere this window never saw. Without it, a flag
   * that is only cleared by an event that can be missed would leave a 320px
   * invisible brick over somebody's desktop, which is the failure the whole
   * click-through arrangement exists to prevent.
   */
  let dragging = false
  /** Null until a persona with `bubble: true` is worn. Off is the default. */
  let showingWords = false
  /**
   * How far the hover control has faded in. Not a boolean, so it does not
   * snap into existence under a cursor that was only passing over her.
   */
  let chip = 0
  /**
   * Whether that control is offered at all. A preference — see `readShoulderChip`.
   *
   * It gates `wanted` below rather than the drawing, and that is the whole
   * implementation: everything else about the chip already keys off the fade.
   * At zero it is not painted, its rectangle stops taking the mouse, and the
   * click handler returns early — so one gate turns the control off in every
   * sense rather than hiding a button that is still there.
   */
  let shoulderChip = true

  /**
   * Things main could not do. Zero, almost always.
   *
   * While it is not zero the control shows itself unbidden — see `chip.ts`,
   * which explains why a badge that waits to be hovered is not a way of telling
   * anybody anything.
   */
  let troubles = 0

  function fit(): void {
    const ratio = window.devicePixelRatio
    const { clientWidth: width, clientHeight: height } = canvas
    canvas.width = Math.round(width * ratio)
    canvas.height = Math.round(height * ratio)
    avatar.resize(width, height, ratio)
  }

  fit()
  window.addEventListener('resize', fit)

  // The pointer, in the rig's normalised space. `forward: true` on the window's
  // ignore-mouse flag is what keeps these arriving while clicks pass through.
  let pointer: { x: number; y: number } | null = null
  /** She is waiting on an answer, so her gaze is not the cursor's to move. */
  let thinking = false

  /**
   * Put her eyes back where the cursor is, or forward if it is not here.
   *
   * Called on EVERY exit from the beat, and that is the point. Clearing
   * `thinking` only stops the render loop ignoring the pointer — it does not
   * move her — and `lookAt` is driven by `mousemove`, which never arrives while
   * the cursor is somewhere else on the desktop. Left out of one of the two
   * exits, she went on staring off at the thinking coordinates through a whole
   * new session.
   */
  function lookAtPointer(): void {
    const here = pointerOnWindow()
    if (here === null) return avatar.lookAt(0, 0)
    avatar.lookAt((here.x / canvas.clientWidth) * 2 - 1, (here.y / canvas.clientHeight) * 2 - 1)
  }

  window.addEventListener('mousemove', (event) => {
    pointer = { x: event.clientX, y: event.clientY }
    /*
      A release this window never saw — see `dragging`.

      `event.buttons` is a bitmask of what is held down NOW, and moves are
      forwarded even while the window is click-through, so this is the one
      signal that arrives whether or not the release did. Cheap, and it is what
      stops a missed `mouseup` leaving her solid over the whole desktop.
    */
    if (dragging && event.buttons === 0) {
      dragging = false
      window.mochi.drop()
    }
    if (thinking) return
    avatar.lookAt(
      (event.clientX / canvas.clientWidth) * 2 - 1,
      (event.clientY / canvas.clientHeight) * 2 - 1,
    )
  })
  window.addEventListener('mouseleave', () => {
    pointer = null
    avatar.lookAt(0, 0)
  })

  /**
   * The pointer, or null if it is not actually over this window.
   *
   * `mouseleave` is not enough on its own. A cursor that JUMPS out — warped by
   * a script, or moved fast across the edge — can leave without the event
   * arriving, and the last known position then sits there for ever. The visible
   * symptom is hover state that never lets go: the bubble's controls stayed on
   * screen with the pointer on the other side of the display.
   *
   * Checked against the canvas every frame instead, because that is a fact
   * rather than an event that may or may not come.
   */
  function pointerOnWindow(): { x: number; y: number } | null {
    if (pointer === null) return null
    const inside =
      pointer.x >= 0 &&
      pointer.y >= 0 &&
      pointer.x <= canvas.clientWidth &&
      pointer.y <= canvas.clientHeight
    return inside ? pointer : null
  }

  // `click` rather than `mousedown`, so a drag that happens to start on the chip
  // and end elsewhere does not open a window nobody asked for. Guarded on the
  // chip being visible: its rectangle is only solid while it is, and acting on
  // a click there when it is not would be a button hidden in empty desktop.
  /** Which control a point is on, if any. */
  function hitsControls(x: number, y: number): 'copy' | 'close' | 'history' | null {
    const found = bubble.controls()
    if (found === null || !showingWords) return null
    const inside = (r: { x: number; y: number; w: number; h: number }): boolean =>
      x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h
    if (inside(found.copy)) return 'copy'
    if (inside(found.close)) return 'close'
    if (inside(found.history)) return 'history'
    return null
  }

  /**
   * Right-clicking her asks main for the menu — the same one the menu bar item
   * shows, because it is the same `NSMenu`.
   *
   * Gated on her SILHOUETTE, per-pixel, exactly as the left click is. Her
   * window is 320 square and she occupies a fraction of it: a context menu on
   * the empty part would be a 320-pixel invisible target sitting on somebody's
   * desktop, and right-clicking the desktop is supposed to reach the desktop.
   *
   * `preventDefault` because Chromium would otherwise offer its own menu —
   * reload, inspect, and the vocabulary of a web page, on a character.
   */
  /**
   * Press on her and she comes with you.
   *
   * `mousedown` rather than a drag threshold, and main stops on `mouseup` — a
   * press that does not move simply moves her by nothing, which costs nothing.
   * The `click` handler below still fires afterwards, so the controls keep
   * working: the bubble's buttons and the chip are checked there and are not
   * part of her silhouette, so they are never a grab.
   *
   * Her SILHOUETTE only, per pixel, exactly as everything else here. Her window
   * is 320 square and mostly empty; a press on the empty part belongs to the
   * desktop.
   */
  window.addEventListener('mousedown', (event) => {
    if (event.button !== 0) return
    if (!avatar.hitTest(event.clientX, event.clientY)) return
    // Before the grab, so the frame that follows is already solid — see
    // `dragging`. The release is what writes where she was left, and it can
    // only be received by a window that is taking the mouse.
    dragging = true
    window.mochi.grab(event.clientX, event.clientY)
  })

  /**
   * Let go — on `mouseup` ANYWHERE IN THIS WINDOW, not only on her.
   *
   * The cursor is routinely off her by the time the button comes up: that is
   * what dragging is, and listening on her silhouette would leave the drag
   * running whenever somebody released the button anywhere else.
   *
   * "Anywhere in this window" is a promise `dragging` is what keeps. Off her
   * silhouette this window is click-through, so the release used to be
   * delivered to the desktop and never reached here at all — see `dragging` for
   * what that cost.
   */
  window.addEventListener('mouseup', () => {
    /*
      ONLY WHEN A DRAG WAS RUNNING, which the backstop above already checks and
      this did not.

      Every release over this window came through here — a click on a bubble
      control, the copy button, her chip — and each one sent `companion:drop`.
      That is a read-merge-atomic-write of `preferences.json` per click, and it
      records a PLACEMENT: whatever position she happens to be at when somebody
      pressed a button that has nothing to do with moving her.

      The `mousemove` backstop thirty lines up guards on `dragging` for exactly
      this reason. Two listeners ending one drag, and only one of them asked
      whether a drag was happening.
    */
    if (!dragging) return
    dragging = false
    window.mochi.drop()
  })

  /**
   * Wheeling over the bubble moves the reader's place in what she said.
   *
   * `passive: false` because this is prevented: without it a scroll over her
   * window scrolls the page behind, and the page behind is a 320-square canvas
   * with nothing to scroll — so the gesture would visibly do nothing at all.
   */
  window.addEventListener(
    'wheel',
    (event) => {
      if (!showingWords) return
      if (!bubble.covers(event.clientX, event.clientY)) return
      event.preventDefault()
      // A line per notch, in the direction the content moves under the eye.
      bubble.scrollBy(event.deltaY > 0 ? 1 : -1)
    },
    { passive: false },
  )

  window.addEventListener('contextmenu', (event) => {
    event.preventDefault()
    if (!avatar.hitTest(event.clientX, event.clientY)) return
    window.mochi.menu()
  })

  window.addEventListener('click', (event) => {
    /**
     * Asleep, a click on her wakes her — and nothing else here runs.
     *
     * Waking has to be a gesture she cannot miss, and the obvious one, saying
     * so, is exactly what she cannot hear. It is guarded on her silhouette like
     * everything else, so clicking the empty part of her window still belongs
     * to the desktop.
     */
    if (resting) {
      if (avatar.hitTest(event.clientX, event.clientY)) window.mochi.wake()
      return
    }
    const control = hitsControls(event.clientX, event.clientY)
    if (control === 'close') {
      bubble.dismiss()
      return
    }
    if (control === 'history') {
      window.mochi.history()
      return
    }
    if (control === 'copy') {
      // The WHOLE utterance, not the page on screen. There is no selecting text
      // in a canvas, so this button is the only way her words leave the window
      // — copying a fragment of them would be a worse answer than none.
      window.mochi.copy(utterance.text())
      bubble.copied()
      return
    }
    if (chip <= 0) return
    if (!chipHits(event.clientX, event.clientY, herBox(), roomOnScreen(canvas, windowOrigin)))
      return
    window.mochi.history()
  })

  function tick(now: number): void {
    fitToContent()
    frame = requestAnimationFrame(tick)

    const seconds = lastAt === null ? 1 / 60 : Math.min(0.1, (now - lastAt) / 1000)
    /*
      Her RAW level this frame, kept rather than passed straight through.

      `EnvelopeState` carries `mouthOpen`, which is normalised against her own
      running peak — the right thing for a mouth and the wrong thing for a
      comparison, because it has had the very amplitude removed that the
      loopback measurement is about. The microphone side is `rms` too, so the
      two are in one unit.
    */
    let herLevel = 0
    if (analyser !== null && samples !== null) {
      analyser.getFloatTimeDomainData(samples)
      herLevel = rms(samples)
      envelope = advanceEnvelope(herLevel, envelope, seconds, DEFAULT_ENVELOPE)
      avatar.setMouthOpen(envelope.mouthOpen)
      // Her eyes, from the same measurement as her mouth. The rig holds a
      // blink shut for the whole of `asleep`, and a mouth moving under closed
      // lids is a picture no path may produce — see `setSpeaking`.
      avatar.setSpeaking(envelope.speaking)
    }
    // Unconditionally, including before the analyser exists — `SILENT.quietFor`
    // is `Infinity` and `step` handles it. This used to be guarded here with
    // `analyser !== null`, which fixed one call site of a rule that has two:
    // "quietFor means nothing until there has been sound" is also violated in
    // the window between an utterance's first delta and its first audio, where
    // the analyser very much exists. The rule belongs to the fade, so it lives
    // in `step`.
    /**
     * What the microphone knows, a second before the service says it.
     *
     * NOT WHILE SHE IS ASLEEP, and that guard is load-bearing rather than
     * tidy. A disabled `MediaStreamTrack` still produces frames — zeros — so
     * without it a nap taken mid-sentence read as the user going quiet: the
     * silence accumulated past `QUIET_S`, `attending` reported `considering`,
     * and the beat opened behind her closed eyes and went overdue three
     * seconds later, asking somebody to repeat themselves to a companion who
     * had stopped listening. `sleeps()` resets both, and this is what stops
     * them coming back.
     */
    if (mic !== null && micSamples !== null && !resting && hearing) {
      mic.getFloatTimeDomainData(micSamples)
      const heardLevel = levelOf(micSamples)
      /*
        Both levels, same frame, and only while she is audible.

        This is the exact condition §17 is about: her voice is playing and the
        microphone is open, which on speakers is when the residue gets in. The
        gate is the envelope's own `speaking` rather than a threshold invented
        here — the mouth already answers "is she making sound", and §17's
        addendum is a whole paragraph about what happens when that window is
        counted in time instead of in evidence.
      */
      const summary = loopback.observe(herLevel, heardLevel, envelope.speaking)
      if (summary !== null) {
        const { correlation: c, residual: r } = summary
        window.mochi.report({
          kind: 'note',
          text:
            `loopback over ${String(summary.windows)} windows — ` +
            `correlation ${c.min.toFixed(2)}/${c.median.toFixed(2)}/${c.max.toFixed(2)} ` +
            `residual ${r.min.toFixed(3)}/${r.median.toFixed(3)}/${r.max.toFixed(3)} ` +
            '(min/median/max; §17 wants this on speakers AND on earphones)',
        })
      }
      const now = attending.step(heardLevel, seconds)
      if (now !== attention) {
        attention = now
        // Their turn ended. What she DOES about it is the beat's, including how
        // long it may go on before it stops being a wait and starts being
        // silence — see `beat.ts`.
        if (now === 'considering') beat.turnEnded()
        // Talking again, so there is nothing outstanding to hold.
        if (now === 'hearing') beat.reset()
      }
    }

    /**
     * The beat, stepped whether or not there is a microphone yet.
     *
     * `envelope.speaking` is the analyser's own adaptive answer about HER
     * voice, and it is the ONLY thing that closes this. Not
     * `output_audio_buffer.started`: §64 measured that frame arriving followed
     * by no audio at all, on the same two utterances in every arm of the sweep.
     * The started frame is a promise of audio; the envelope is audio.
     */
    const phase = beat.step(seconds, envelope.speaking)
    if (phase !== waiting) {
      waiting = phase
      if (phase === 'held') {
        /**
         * She reacts to the silence while the service is still deciding what
         * it means. Her own body rather than a spinner: a companion that
         * shows a progress indicator has stopped being a companion, and the
         * rig already has the vocabulary — a small sway, and her gaze coming
         * off the cursor the way anybody's does when they start thinking.
         */
        avatar.playMotion('sway')
        avatar.lookAt(0.35, -0.5)
        thinking = true
      } else {
        // Back with whoever she is talking to, and that is the same move
        // whether her voice arrived or whether it is not going to. The second
        // case is §64's one turn in four, and leaving her staring into the
        // middle distance for it is the open-ended silence this beat ends.
        thinking = false
        // Her gaze, put back on the same frame. See `lookAtPointer`.
        lookAtPointer()
        // The sway is a LOOP, so leaving the beat has to stop it. Without this
        // it played from the first turn to the end of the session and the state
        // it stands for stopped meaning anything. `nod` replaces it and clears
        // itself, which is why only the other branch needs the stop.
        if (phase === 'overdue') avatar.playMotion('nod')
        else avatar.stopMotion()
      }
    }

    utterance.step(envelope.quietFor, seconds)
    bubble.step(envelope.quietFor, seconds, utterance.begun())
    lastAt = now

    avatar.render(now)
    // AFTER her, so it sits above rather than behind. It is asked nothing about
    // the mouse: `hitTest` below is the avatar's alone, which is what keeps the
    // design's promise that a bubble cannot enlarge her hit region.
    if (showingWords) {
      // Hover is read BEFORE drawing, so the controls appear on the same frame
      // the pointer arrives rather than one behind it.
      const here = pointerOnWindow()
      const overBubble = here !== null && bubble.covers(here.x, here.y)
      bubble.draw(
        ctx,
        canvas.clientWidth,
        palette,
        utterance.text(),
        utterance.at(),
        herBox(),
        roomOnScreen(canvas, windowOrigin),
        bubbleSide,
        overBubble,
        troubles,
      )
    }

    /*
      OUTSIDE `showingWords`, and that is the whole of this fix.

      This sat inside the branch that draws her words, so a character with the
      bubble switched off never reported anything — and main kept the value it
      had invented at startup, `['above']`. The tray menu has been offering one
      fabricated side, on every launch, to anybody wearing the built-in.

      The list is not about whether THIS character shows a bubble. `bubbleSide`
      is an app-level preference in `preferences.json`, shared by every persona,
      so the question is "where could her words go" and it has an answer whether
      or not this one has any. Asked every frame now, for anybody worn.
    */
    // Only when it CHANGES. The menu is rebuilt from this, and rebuilding it
    // sixty times a second would be sixty IPC messages for an answer that
    // moves when she is dragged across a screen edge.
    const sides = sidesForTheMenu()
    if (sides !== null) {
      const key = `${sides.available.join(',')}|${sides.using}`
      if (key !== lastOffered) {
        lastOffered = key
        window.mochi.sides(sides.available, sides.using)
        /*
            Said out loud, WITH what it was decided from.

            This list is the whole of what the tray menu may offer, and it
            crossed to main with nothing to check it against — so a menu showing
            one side where two were expected looked exactly like a menu showing
            the right thing. Reconstructing it by hand needs her box, the
            measured bubble and the room in canvas coordinates at the instant of
            the call; getting any one of them wrong yields a confident wrong
            answer, which it has done twice.

            Only when it CHANGES, which is what this branch already is.
          */
        window.mochi.report({
          kind: 'note',
          text:
            `[bubble] sides ${sides.available.join(',') || 'none'} · using ${sides.using} · ` +
            `body ${sides.from.body} · box ${sides.from.box} · room ${sides.from.room}`,
        })
      }
    }

    const at = pointerOnWindow()
    const onHer = at !== null && avatar.hitTest(at.x, at.y)

    /**
     * ONE way into her conversations at a time, never two.
     *
     * While the bubble is up the control is inside it, beside copy and close —
     * a chip floating at her shoulder as well would be a second speech-bubble
     * glyph next to an actual speech bubble, pointing at the same window. The
     * chip is what remains when there is no bubble: a persona with the bubble
     * turned off, or one the reader has dismissed.
     */
    const inBubble = bubble.controls() !== null
    const wanted =
      shoulderChip &&
      !inBubble &&
      chipVisible(at, onHer, herBox(), roomOnScreen(canvas, windowOrigin))
        ? 1
        : 0
    chip =
      wanted > chip
        ? Math.min(1, chip + seconds / CHIP_FADE_S)
        : Math.max(0, chip - seconds / CHIP_FADE_S)
    /*
      The halo, drawn AFTER her and before the chip.

      After her, because it sits over her head and a ring behind her scalp is not
      a halo. Before the chip, because the chip is a control and controls belong
      on top of readouts when they overlap — which they can, at her shoulder.

      The bead's clock is null unless she is actually waiting on something, so
      the ordinary frame draws a ring and nothing else.

      TWO waits feed it, and they do not overlap. The beat is the pause before
      her voice arrives and closes the moment it does (§64); `working` is a
      lookup she has already spoken about and which runs for twenty seconds
      after that (§8). `waitedFor` is the one clock, so a lookup that starts
      while a beat is still open does not restart the bead half way round.

      The RESTING hairline is a preference; `open` never is. `haloFor` answers
      the state and this only suppresses the one it is allowed to.
    */
    const halo = haloFor(hearing, resting)
    /*
      Three answers, and `off` is nothing in every one of them.

      `always` draws whatever `haloFor` decided; `listening` keeps only the
      filled ring, which is the state that means the microphone is open; `never`
      draws nothing. `drawHalo` already treats `off` as nothing, so the first
      branch does not special-case it.
    */
    const ringed = haloWhen === 'never' ? false : haloWhen === 'listening' ? halo === 'open' : true
    if (ringed) {
      drawHalo(
        ctx,
        herBox(),
        {
          her: palette.her,
          veil: palette.herVeil,
          quiet: palette.quiet,
          // Hers, deep enough to be seen against the ring it travels on — see
          // `HaloColours.bead`, and `resolve.ts` for why these are read from
          // the sheet rather than written here.
          bead: palette.herDeep,
          beadEdge: palette.herDeepInk,
        },
        halo,
        resting ? 0.45 : 1,
        waitedFor(now),
      )
    }

    drawChip(ctx, herBox(), palette, chip, troubles, roomOnScreen(canvas, windowOrigin))

    // Only when it CHANGES. Asking main to toggle the window flag sixty times a
    // second would be sixty IPC messages a second for an answer that changes
    // when the cursor crosses an edge.
    //
    // The chip's rectangle counts as solid WHILE IT IS SHOWING, which is the
    // one deliberate exception to "only painted pixels take the mouse" — a
    // control nobody can click is not a control. It is exactly the size of the
    // control and disappears with it.
    const onChip =
      chip > 0 && at !== null && chipHits(at.x, at.y, herBox(), roomOnScreen(canvas, windowOrigin))
    // Only the bubble's CONTROLS, never its text. The design's rule is that
    // only painted pixels of HERS take the mouse; two small buttons are the
    // same deliberate exception the chip already makes, and the paragraph
    // beside them stays click-through so she does not become a solid slab over
    // somebody's desktop.
    /**
     * The WHOLE bubble takes the mouse now, not only its buttons.
     *
     * This widens the one deliberate exception to "only painted pixels take the
     * mouse", and it is worth saying what it buys and what it costs.
     *
     * It buys the only thing that made the bubble's own "there is more above"
     * mark honest: **the wheel does not reach a click-through window at all**.
     * `setIgnoreMouseEvents(true, { forward: true })` forwards mouse MOVES and
     * nothing else — measured, by wheeling over her body (arrives) and over the
     * bubble (does not). So a scrollable bubble and a click-through bubble are
     * mutually exclusive, and a paged panel nobody can page is worse than
     * either.
     *
     * It costs the ability to click through the bubble to whatever is behind
     * it. That is the smaller loss: the bubble is opaque paper with words on
     * it, and clicking THROUGH an opaque panel is the surprising behaviour, not
     * the other way round. Her silhouette rule is untouched — the paragraph is
     * only solid while the pointer is inside it, and the × dismisses it.
     */
    const onControls = at !== null && bubble.covers(at.x, at.y)
    // `dragging` first, and it overrides the rest: a drag that has left her
    // silhouette still owns the pointer, and the release is what remembers
    // where she was put.
    /**
     * Ambient motion, and the one place every reason to have none is collected.
     *
     * `busy` is asserted for all of it: she is speaking, they are speaking, a
     * beat is outstanding, she is resting, or the pointer is on her. There is
     * ONE motion slot, and `beat.ts` uses it to say something real — she is
     * waiting on a slow answer — so an ambient loop that could overwrite it
     * would replace a signal with decoration. Hence `waiting !== 'none'` is
     * part of being busy rather than a special case afterwards.
     *
     * Stepped here, at the end of the frame, because `onHer` is computed a few
     * lines up and this is the first point where the whole answer is known.
     */
    const busy =
      resting ||
      onHer ||
      dragging ||
      envelope.speaking ||
      attention !== 'idle' ||
      waiting !== 'none'
    const next = repose.step(seconds, busy)
    // The glance is an EVENT and goes first: it is a one-shot, so it plays over
    // whatever loop is running and the rig clears it when it finishes.
    if (next.look) avatar.playMotion('turn')
    if (next.loop !== ambient) {
      ambient = next.loop
      // `stopMotion` rather than playing nothing: `sway` and `wander` loop, and
      // a loop left running is the defect §19's addendum describes in another
      // form -- a state that stopped meaning anything because it never ended.
      if (ambient === 'none') avatar.stopMotion()
      else avatar.playMotion(ambient)
    }

    const on = dragging || onHer || onChip || onControls
    if (on !== solid) {
      solid = on
      window.mochi.report({ kind: 'pointer', onHer: on })
    }
  }
  frame = requestAnimationFrame(tick)

  return {
    // Unconditional, all three. Gating these on the bubble is what made the
    // estimate not exist for the default persona.
    saying: (delta: string, responseId: string) => utterance.add(delta, responseId),
    speaks: (responseId: string) => {
      // She has an answer, so the microphone's own wait is spent. Her GAZE is
      // not moved here: that belongs to the beat, which waits for audio rather
      // than for the frame promising it — §64 measured the two disagreeing.
      attending.answered()
      utterance.speaks(responseId)
    },
    finished: (responseId: string, interrupted: boolean) =>
      utterance.finished(responseId, interrupted),
    heard: () => ({
      text: utterance.text(),
      at: utterance.at(),
      // Carried WITH the cursor, so a caller cannot read one without the other.
      responseId: utterance.respondingTo(),
    }),
    prefersBubble: (side: SidePreference) => {
      bubbleSide = side
    },
    movedTo: (origin: { x: number; y: number }) => {
      windowOrigin = origin
    },
    hears: (on: boolean) => {
      if (hearing === on) return
      hearing = on
      // Nothing is outstanding once she cannot hear, and nothing accumulates
      // either — the loop above stops stepping `attending` while this is false.
      if (!on) {
        beat.reset()
        attending.reset()
        attention = 'idle'
        waiting = 'none'
        thinking = false
        /*
          AND HER GAZE, which this left where the beat had put it.

          The thinking beat aims her off the cursor — `lookAt(0.35, -0.5)`, the
          way anybody's eyes go when they start thinking — and the beat's own
          exit path puts it back with `lookAtPointer` on the same frame.

          A session dying while the beat is held does not take that path. It
          comes through here, which cleared every other piece of the state and
          not this one, so she was left staring into the middle distance until
          some later reconnect happened to call `opened()`. The one moment she
          looks least present is the moment her connection has just gone.
        */
        lookAtPointer()
      }
    },
    sleeps: (asleep: boolean) => {
      /*
        A TRANSITION, read before the flag moves, and not merely this being
        called with `false`.

        `companion/main.ts` calls this on every session open as well as on the
        rest frame — and a session is re-opened every hour (§53). So "was told
        she is awake" happens hourly with nobody having woken her, and anything
        hung off it would fire into the middle of a conversation. The reconnect
        is supposed to be invisible; that is the entire feature.
      */
      const woke = resting && !asleep
      resting = asleep
      // A half-filled window spans a silence nobody was in. Same argument as
      // `attending`'s reset one guard up: state measured across a nap is not a
      // measurement of anything.
      loopback.reset()
      avatar.setAsleep(asleep)
      /*
        WHATEVER FACE SHE WAS WEARING ends here.

        The rule arrived with `set_expression`, whose manifest promised "the
        expression stays until you change it or until you are asked to rest",
        and nothing cleared it — so a character told to look `angry`, then asked
        to rest, woke up angry into a new session that had never heard of it.

        The tool went on 2026-08-26 and the clearing stays, because it was never
        really about the tool: her face is time-driven now, and an expression
        held across a sleep is a measurement of a mood nobody is in. A rule that
        describes a lifetime it does not have
        is a rule she keeps and the app breaks.

        Only on the way DOWN. Waking must not stamp neutral over an expression
        set in the same breath as the greeting.
      */
      if (asleep) avatar.setEmotion({ emotion: 'neutral', intensity: 0 })
      /*
        And on the way UP she perks.

        This is the caller `holdMs` never had. The mechanism was built, tested
        against two real bugs -- a hold set before the first frame, and one set
        while the window was throttled -- and then never used by anything, so
        an expression could only ever be changed by her asking for one.

        It cannot stamp over a face she sets in the same breath as the
        greeting, which is what the comment above was guarding: `setEmotion`
        supersedes any pending reset, so her choice both wins and is not cut
        short by this timer.

        It CLEARS rather than fades. Only `squash` runs through a spring; the
        rest of a look is applied on the frame it is set, so the perk ends the
        way a raised eyebrow does rather than dissolving. Said here because the
        word "decaying" invited the opposite reading.
      */
      if (woke) {
        avatar.setEmotion({
          emotion: 'surprised',
          intensity: WAKING_PERK_INTENSITY,
          holdMs: WAKING_PERK_MS,
        })
        // And she moves, not only changes face. A perk with no motion under it
        // is an expression appearing on a body that did not react, which reads
        // as a texture swap rather than as somebody waking up.
        avatar.playMotion('hop')
      }
      // Either direction: the quiet starts again. Without this she would be
      // put to rest mid-wander and wake straight back into it, having counted
      // the whole sleep as time nobody spoke to her.
      repose.reset()
      ambient = 'none'
      /**
       * Nothing to say while her eyes are shut, so the bubble closes.
       *
       * `dismiss`, not `clear`. Clearing only zeroes the opacity, and the very
       * next frame fades it straight back in — `step` knows nothing about
       * sleep. `dismiss` is the same path the × takes: it remembers WHICH text
       * was closed, so it stays closed and the next thing she says still
       * appears.
       */
      if (asleep) bubble.dismiss()
      // Nothing is outstanding while her eyes are shut, and nothing accumulates
      // either — the render loop stops stepping `attending` while she rests, so
      // both of these are cleared once rather than fought every frame. Without
      // it a beat opened just before she was told to rest would sit there and go
      // overdue, asking somebody to repeat themselves to a sleeping companion.
      if (asleep) {
        beat.reset()
        attending.reset()
        attention = 'idle'
      }
    },
    stands: (feetFromTop: number) => {
      if (!Number.isFinite(feetFromTop) || feetFromTop <= 0) return
      feet = feetFromTop
      avatar.setFeet(feetFromTop)
      // Her box moved, and the drag clamp in main is expressed against it.
      window.mochi.body(herBox())
    },
    troubled: (count: number) => {
      // `Math.max(0, NaN)` is `NaN`, so a non-count arriving here would sit in
      // `troubles` for the life of the window and compare false against every
      // threshold. The caller checks too; this is the end that holds the state,
      // and a guard at one door is not a guard.
      troubles = Number.isFinite(count) ? Math.max(0, count) : troubles
    },
    working: (count: number) => {
      // Checked rather than trusted: it crosses the bridge, and a NaN would
      // make `> 0` false and quietly turn the indicator off for ever.
      const now = Number.isFinite(count) ? Math.max(0, Math.trunc(count)) : 0
      if (now === outstanding) return
      outstanding = now
      // Started on the transition into work and cleared on the transition out.
      // A lookup beginning while another is running is the same wait carrying
      // on, so the clock is not restarted — see `workingSince`.
      if (outstanding > 0) workingSince ??= performance.now()
      else workingSince = null
    },
    showsHalo: (when: HaloWhen) => {
      haloWhen = when
    },
    showsShoulderChip: (shown: boolean) => {
      shoulderChip = shown
    },
    opened: () => {
      beat.reset()
      attending.reset()
      attention = 'idle'
      waiting = 'none'
      thinking = false
      avatar.stopMotion()
      // `stopMotion` above kills whatever was playing, so the record of what is
      // playing has to agree or the next rung would be skipped: `ambient` would
      // still say `wander` while nothing was running, and the comparison that
      // starts a loop only fires on a change.
      repose.reset()
      ambient = 'none'
      // The OTHER exit from the beat, and it needs the same restore. A session
      // that ended mid-beat left her eyes at the thinking coordinates, and
      // clearing the flag above does not move them — so the new session opened
      // with her already staring off into the corner.
      lookAtPointer()
    },
    box: () => herBox(),
    wears: (face: Emotion) => {
      // Intensity 1: she picked this face on purpose, and a half-worn expression
      // is the blend the rig uses for a signal it inferred rather than one she
      // asked for.
      avatar.setEmotion({ emotion: face, intensity: 1 })
    },
    showWords: (shown: boolean) => {
      showingWords = shown
      if (!shown) bubble.clear()
    },
    wear: (face: FaceSpec) => {
      worn = face
      /*
        Re-read HER colours, because `applyAccent` has just written them.

        `--her` and `--her-veil` are per persona and live on the document, so the
        palette resolved at startup belongs to whoever was worn then. Without
        this the halo keeps the previous character's green — the exact drift
        `resolve.ts` exists to make impossible, reintroduced by a value that
        changes at runtime rather than at build.

        `main.ts` calls `applyAccent` BEFORE this for the same reason: the
        document has to carry her colour before the rig reads it back.
      */
      palette = resolvePalette(document.documentElement)
      avatar.setSizePercent(face.size)
      // Main clamps HER to the display during a drag, not the window, and only
      // this side knows how big she is. Sent on every wear because that is
      // exactly when it changes.
      window.mochi.body(herBox())
      // Her appearance, and the rate. A different character means a different
      // VOICE, and the learned speaking rate belongs to the voice —
      // `Pacer.restart()` keeps it on purpose, which is right between two
      // utterances of one voice and wrong between two voices.
      avatar.setFace(face)
      utterance.wear()
      bubble.clear()
    },
    listen(stream: MediaStream) {
      audio ??= new AudioContext()
      mic ??= audio.createAnalyser()
      mic.fftSize = 1024
      micSamples ??= new Float32Array(new ArrayBuffer(mic.fftSize * 4))
      // The previous one first. A reconnect replaces the stream, and leaving
      // the old node connected leaves it feeding the same analyser.
      micSource?.disconnect()
      micSource = audio.createMediaStreamSource(stream)
      micSource.connect(mic)
    },
    hear(stream: MediaStream) {
      // One context, reused. A second `AudioContext` per reconnect is a real
      // leak: they are not garbage collected while running, and this happens
      // every hour (§53).
      audio ??= new AudioContext()
      analyser ??= audio.createAnalyser()
      analyser.fftSize = 1024
      samples ??= new Float32Array(new ArrayBuffer(analyser.fftSize * 4))
      remoteSource?.disconnect()
      remoteSource = audio.createMediaStreamSource(stream)
      remoteSource.connect(analyser)
    },
    dispose() {
      cancelAnimationFrame(frame)
      window.removeEventListener('resize', fit)
      // Let go of both before the context goes, so a teardown that fails to
      // close the context still leaves nothing feeding an analyser.
      micSource?.disconnect()
      micSource = null
      remoteSource?.disconnect()
      remoteSource = null
      // `close()` returns a promise and CAN reject -- a context already closed,
      // or one the browser tore down first. `void` discarded that, so a
      // rejection surfaced as an unhandled one with no route back to here.
      // Nothing to recover: this is teardown, and the context is going away
      // either way.
      audio?.close().catch(() => undefined)
      audio = null
      analyser = null
      samples = null
      // Taken off, like the media sources above it. A `MediaQueryList` outlives
      // this face, so a listener left on it keeps the whole closure — and the
      // disposed avatar it calls into — alive for the life of the window.
      stillness.removeEventListener('change', onStillness)
      avatar.dispose()
    },
  }
}
