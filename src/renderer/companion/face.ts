import { MochiAvatar } from './rig/mochi'
import { MOCHI, type FaceSpec } from '@shared/avatar-spec'
import { advanceEnvelope, rms, DEFAULT_ENVELOPE, SILENT } from './rig/envelope'
import { createBubble, type BubbleColours } from './bubble'
import { createUtterance } from './utterance'
import { createAttending, levelOf, type Attention } from './attending'
import { drawChip, hits as chipHits, visible as chipVisible } from './chip'
import { roomFor, type Room, type SidePreference } from './place'
import { layoutFor, feetY, BREATHING_UNITS, FEET_FROM_TOP } from '@shared/avatar-layout'

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
  /** One fragment of what she is saying, with the ITEM it belongs to. */
  saying(delta: string, itemId: string): void
  /** Her voice for this item has started. Paces the cursor. */
  speaks(itemId: string): void
  /** And has finished, naturally or by interruption. The two differ; see `pace.ts`. */
  finished(itemId: string, interrupted: boolean): void
  /**
   * Where she is estimated to have got to, for whoever files what was heard.
   *
   * Read at the moment of a barge-in. §60 scored this against transcripts of her
   * own truncated audio: −3% to −22%, always short, against +446% to +513% for
   * filing everything she generated.
   */
  heard(): { text: string; at: number; itemId: string | null }
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
   * How far into her window she is standing.
   *
   * Main drives it: dragged against the top of the display the window can rise
   * no further, so she rises inside it instead. See `dragTo`.
   */
  stands(feetFromTop: number): void
  /** Turn the bubble on for this persona, with the surface it draws on. */
  showWords(colours: BubbleColours | null): void
  /**
   * How many things main could not do, so the shoulder control can say so.
   *
   * A COUNT, not the problems themselves: the renderer that draws her has no
   * business holding the text of a persona that failed to parse, and cannot do
   * anything with it. The window that CAN read them asks main directly.
   */
  troubled(count: number): void
  /** Stop the loop, release the analyser, drop the canvas. */
  dispose(): void
}

/** How close to the edge of the display a bubble may sit. */
const SCREEN_INSET = 8

/** Long enough to read as a fade, short enough not to feel like a delay. */
const CHIP_FADE_S = 0.12

/**
 * Its own surface, like the bubble's and for the same reason: she may be sitting
 * on anything, so a control tinted by the desktop behind it has no contrast
 * guarantee at all. Fixed rather than themed for now — it is one control, and a
 * per-persona palette for it is a decision the appearance loader should make
 * once, not something to guess at here.
 */
const CHIP_COLOURS = { paper: '#f4f2ea', ink: '#2b2c25' }

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

  /**
   * Where she actually is on the canvas, from the module that decides it.
   *
   * She is horizontally centred and rests one clearance above the bottom, so
   * her corner follows from the layout rather than from a guess. Recomputed on
   * resize rather than cached at construction, because `fit()` changes the
   * canvas and a stale corner would leave the chip behind.
   */
  function herCorner(): { right: number; top: number } {
    const layout = layoutFor(worn, worn.size)
    return {
      right: canvas.clientWidth / 2 + layout.bodyWidth / 2,
      top: feetY(canvas.clientHeight, BREATHING_UNITS * layout.scale, feet) - layout.bodyHeight,
    }
  }

  /**
   * Her whole body in the canvas, which is what the bubble is placed AROUND.
   *
   * This used to be `herHead` — her centre and the top of her head — which is
   * everything a bubble above her needs and not enough for one anywhere else.
   */
  function herBox(): { left: number; top: number; width: number; height: number } {
    const layout = layoutFor(worn, worn.size)
    return {
      left: canvas.clientWidth / 2 - layout.bodyWidth / 2,
      top: feetY(canvas.clientHeight, BREATHING_UNITS * layout.scale, feet) - layout.bodyHeight,
      width: layout.bodyWidth,
      height: layout.bodyHeight,
    }
  }
  /**
   * Where the bubble may go, in canvas pixels — read from the DOM, not from main.
   *
   * `screenX`/`screenY` and `screen.avail*` are standard and available here, so
   * the renderer already knows where its window sits and where the usable
   * screen is. Asking main for it would be a message, a cache and a staleness
   * question, for an answer the page can read directly on the frame it needs it.
   *
   * Read every frame rather than on a move event: she is dragged by main
   * repositioning the window, so there is no event here to hang it on, and the
   * read is two properties.
   */
  function roomOnScreen(): Room {
    return roomFor(
      { width: canvas.clientWidth, height: canvas.clientHeight },
      { x: window.screenX, y: window.screenY },
      {
        // `availLeft`/`availTop` are real and implemented, and are missing from
        // the DOM lib's `Screen` — they are in the CSSOM View spec's appendix
        // rather than its interface. Read through a narrow cast rather than
        // widening `Screen` globally, which would let a typo elsewhere compile.
        x: (window.screen as unknown as { availLeft?: number }).availLeft ?? 0,
        y: (window.screen as unknown as { availTop?: number }).availTop ?? 0,
        width: window.screen.availWidth,
        height: window.screen.availHeight,
      },
      SCREEN_INSET,
    )
  }

  /**
   * Which side of her somebody asked the bubble to sit on.
   *
   * Owned by main — it is in `preferences.json` beside the worn persona — and
   * pushed here on change. `auto` until main says otherwise, which is also what
   * it means when nobody has chosen.
   */
  let bubbleSide: SidePreference = 'auto'
  /** How far into the canvas she is standing. See `stands`. */
  let feet = FEET_FROM_TOP
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

  /** The microphone's own analyser. Hers drives the mouth; this drives nothing
   *  she says — only whether she looks like she is waiting on somebody. */
  let mic: AnalyserNode | null = null
  let micSamples: Float32Array<ArrayBuffer> | null = null
  /** So the reaction fires on the CHANGE, not on every frame of the state. */
  let attention: Attention = 'idle'

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
  let frame = 0
  let lastAt: number | null = null
  /** What main was last told, so the IPC is not a per-frame message. */
  let solid: boolean | null = null
  /** Null until a persona with `bubble: true` is worn. Off is the default. */
  let colours: BubbleColours | null = null
  /**
   * How far the hover control has faded in. Not a boolean, so it does not
   * snap into existence under a cursor that was only passing over her.
   */
  let chip = 0

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

  window.addEventListener('mousemove', (event) => {
    pointer = { x: event.clientX, y: event.clientY }
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
    if (found === null || colours === null) return null
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
    window.mochi.grab(event.clientX, event.clientY)
  })

  /**
   * Let go — on `mouseup` ANYWHERE, not only on her.
   *
   * The cursor is routinely off her by the time the button comes up: that is
   * what dragging is. Listening on her silhouette would leave the drag running
   * whenever somebody released the button anywhere else, which is most of the
   * time.
   */
  window.addEventListener('mouseup', () => {
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
      if (colours === null) return
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
    if (!chipHits(event.clientX, event.clientY, herCorner())) return
    window.mochi.history()
  })

  function tick(now: number): void {
    frame = requestAnimationFrame(tick)

    const seconds = lastAt === null ? 1 / 60 : Math.min(0.1, (now - lastAt) / 1000)
    if (analyser !== null && samples !== null) {
      analyser.getFloatTimeDomainData(samples)
      envelope = advanceEnvelope(rms(samples), envelope, seconds, DEFAULT_ENVELOPE)
      avatar.setMouthOpen(envelope.mouthOpen)
    }
    // Unconditionally, including before the analyser exists — `SILENT.quietFor`
    // is `Infinity` and `step` handles it. This used to be guarded here with
    // `analyser !== null`, which fixed one call site of a rule that has two:
    // "quietFor means nothing until there has been sound" is also violated in
    // the window between an utterance's first delta and its first audio, where
    // the analyser very much exists. The rule belongs to the fade, so it lives
    // in `step`.
    // What the microphone knows, a second before the service says it.
    if (mic !== null && micSamples !== null) {
      mic.getFloatTimeDomainData(micSamples)
      const now = attending.step(levelOf(micSamples), seconds)
      if (now !== attention) {
        attention = now
        if (now === 'considering') {
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
        }
        if (now === 'hearing') {
          // Attention back on whoever is talking.
          thinking = false
        }
      }
    }

    utterance.step(envelope.quietFor, seconds)
    bubble.step(envelope.quietFor, seconds, utterance.begun())
    lastAt = now

    avatar.render(now)
    // AFTER her, so it sits above rather than behind. It is asked nothing about
    // the mouse: `hitTest` below is the avatar's alone, which is what keeps the
    // design's promise that a bubble cannot enlarge her hit region.
    if (colours !== null) {
      // Hover is read BEFORE drawing, so the controls appear on the same frame
      // the pointer arrives rather than one behind it.
      const here = pointerOnWindow()
      const overBubble = here !== null && bubble.covers(here.x, here.y)
      bubble.draw(
        ctx,
        canvas.clientWidth,
        colours,
        utterance.text(),
        utterance.at(),
        herBox(),
        roomOnScreen(),
        bubbleSide,
        overBubble,
        troubles,
      )
      // Only when it CHANGES. The menu is rebuilt from this, and rebuilding it
      // sixty times a second would be sixty IPC messages for an answer that
      // moves when she is dragged across a screen edge.
      const now = bubble.offered()
      if (now !== null) {
        const key = `${now.available.join(',')}|${now.using}`
        if (key !== lastOffered) {
          lastOffered = key
          window.mochi.sides(now.available, now.using)
        }
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
    const wanted = !inBubble && chipVisible(at, onHer, herCorner()) ? 1 : 0
    chip =
      wanted > chip
        ? Math.min(1, chip + seconds / CHIP_FADE_S)
        : Math.max(0, chip - seconds / CHIP_FADE_S)
    drawChip(ctx, herCorner(), CHIP_COLOURS, chip, troubles)

    // Only when it CHANGES. Asking main to toggle the window flag sixty times a
    // second would be sixty IPC messages a second for an answer that changes
    // when the cursor crosses an edge.
    //
    // The chip's rectangle counts as solid WHILE IT IS SHOWING, which is the
    // one deliberate exception to "only painted pixels take the mouse" — a
    // control nobody can click is not a control. It is exactly the size of the
    // control and disappears with it.
    const onChip = chip > 0 && at !== null && chipHits(at.x, at.y, herCorner())
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
    const on = onHer || onChip || onControls
    if (on !== solid) {
      solid = on
      window.mochi.report({ kind: 'pointer', onHer: on })
    }
  }
  frame = requestAnimationFrame(tick)

  return {
    // Unconditional, all three. Gating these on the bubble is what made the
    // estimate not exist for the default persona.
    saying: (delta: string, itemId: string) => utterance.add(delta, itemId),
    speaks: (itemId: string) => {
      // She has an answer, so the waiting is over whatever the microphone
      // thinks — and her gaze returns to whoever she is talking to.
      attending.answered()
      thinking = false
      utterance.speaks(itemId)
    },
    finished: (itemId: string, interrupted: boolean) => utterance.finished(itemId, interrupted),
    heard: () => ({ text: utterance.text(), at: utterance.at(), itemId: utterance.itemId() }),
    prefersBubble: (side: SidePreference) => {
      bubbleSide = side
    },
    stands: (feetFromTop: number) => {
      if (!Number.isFinite(feetFromTop) || feetFromTop <= 0) return
      feet = feetFromTop
      avatar.setFeet(feetFromTop)
      // Her box moved, and the drag clamp in main is expressed against it.
      window.mochi.body(herBox())
    },
    troubled: (count: number) => {
      troubles = Math.max(0, count)
    },
    showWords: (next: BubbleColours | null) => {
      colours = next
      if (next === null) bubble.clear()
    },
    wear: (face: FaceSpec) => {
      worn = face
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
      audio.createMediaStreamSource(stream).connect(mic)
    },
    hear(stream: MediaStream) {
      // One context, reused. A second `AudioContext` per reconnect is a real
      // leak: they are not garbage collected while running, and this happens
      // every hour (§53).
      audio ??= new AudioContext()
      analyser ??= audio.createAnalyser()
      analyser.fftSize = 1024
      samples ??= new Float32Array(new ArrayBuffer(analyser.fftSize * 4))
      audio.createMediaStreamSource(stream).connect(analyser)
    },
    dispose() {
      cancelAnimationFrame(frame)
      window.removeEventListener('resize', fit)
      void audio?.close()
      audio = null
      analyser = null
      samples = null
      avatar.dispose()
    },
  }
}
