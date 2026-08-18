import { MochiAvatar } from './rig/mochi'
import type { FaceSpec } from '@shared/avatar-spec'
import { advanceEnvelope, rms, DEFAULT_ENVELOPE, SILENT } from './rig/envelope'
import { createBubble, type BubbleColours } from './bubble'
import { createUtterance } from './utterance'
import { drawChip, hits as chipHits, visible as chipVisible } from './chip'
import { layoutFor, BREATHING_UNITS } from '@shared/avatar-layout'
import { MOCHI } from '@shared/avatar-spec'

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
  /** Turn the bubble on for this persona, with the surface it draws on. */
  showWords(colours: BubbleColours | null): void
  /** Stop the loop, release the analyser, drop the canvas. */
  dispose(): void
}

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
  const SIZE_PERCENT = 100
  const avatar = new MochiAvatar(ctx, { size: SIZE_PERCENT })

  /**
   * Where she actually is on the canvas, from the module that decides it.
   *
   * She is horizontally centred and rests one clearance above the bottom, so
   * her corner follows from the layout rather than from a guess. Recomputed on
   * resize rather than cached at construction, because `fit()` changes the
   * canvas and a stale corner would leave the chip behind.
   */
  function herCorner(): { right: number; top: number } {
    const layout = layoutFor(MOCHI, SIZE_PERCENT)
    const clearance = BREATHING_UNITS * layout.scale
    return {
      right: canvas.clientWidth / 2 + layout.bodyWidth / 2,
      top: canvas.clientHeight - clearance - layout.bodyHeight,
    }
  }
  const bubble = createBubble()
  /**
   * What she is saying, owned HERE rather than inside the bubble.
   *
   * The bubble is one consumer of it; the archive is the other, and the archive
   * must work for a persona with no bubble — which is the default. Every feed
   * below is therefore unconditional, and only the DRAWING is gated on colours.
   */
  const utterance = createUtterance()

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
  window.addEventListener('mousemove', (event) => {
    pointer = { x: event.clientX, y: event.clientY }
    avatar.lookAt(
      (event.clientX / canvas.clientWidth) * 2 - 1,
      (event.clientY / canvas.clientHeight) * 2 - 1,
    )
  })
  window.addEventListener('mouseleave', () => {
    pointer = null
    avatar.lookAt(0, 0)
  })

  // `click` rather than `mousedown`, so a drag that happens to start on the chip
  // and end elsewhere does not open a window nobody asked for. Guarded on the
  // chip being visible: its rectangle is only solid while it is, and acting on
  // a click there when it is not would be a button hidden in empty desktop.
  window.addEventListener('click', (event) => {
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
    utterance.step(envelope.quietFor, seconds)
    bubble.step(envelope.quietFor, seconds, utterance.begun())
    lastAt = now

    avatar.render(now)
    // AFTER her, so it sits above rather than behind. It is asked nothing about
    // the mouse: `hitTest` below is the avatar's alone, which is what keeps the
    // design's promise that a bubble cannot enlarge her hit region.
    if (colours !== null) {
      bubble.draw(ctx, canvas.clientWidth, colours, utterance.text(), utterance.at())
    }

    const onHer = pointer !== null && avatar.hitTest(pointer.x, pointer.y)

    // The hover control, over everything, including the bubble: it is the only
    // thing here that can be clicked, so nothing may sit on top of it.
    const wanted = chipVisible(pointer, onHer, herCorner()) ? 1 : 0
    chip =
      wanted > chip
        ? Math.min(1, chip + seconds / CHIP_FADE_S)
        : Math.max(0, chip - seconds / CHIP_FADE_S)
    drawChip(ctx, herCorner(), CHIP_COLOURS, chip)

    // Only when it CHANGES. Asking main to toggle the window flag sixty times a
    // second would be sixty IPC messages a second for an answer that changes
    // when the cursor crosses an edge.
    //
    // The chip's rectangle counts as solid WHILE IT IS SHOWING, which is the
    // one deliberate exception to "only painted pixels take the mouse" — a
    // control nobody can click is not a control. It is exactly the size of the
    // control and disappears with it.
    const onChip = chip > 0 && pointer !== null && chipHits(pointer.x, pointer.y, herCorner())
    const on = onHer || onChip
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
    speaks: (itemId: string) => utterance.speaks(itemId),
    finished: (itemId: string, interrupted: boolean) => utterance.finished(itemId, interrupted),
    heard: () => ({ text: utterance.text(), at: utterance.at(), itemId: utterance.itemId() }),
    showWords: (next: BubbleColours | null) => {
      colours = next
      if (next === null) bubble.clear()
    },
    wear: (face: FaceSpec) => {
      // Her appearance, and the rate. A different character means a different
      // VOICE, and the learned speaking rate belongs to the voice —
      // `Pacer.restart()` keeps it on purpose, which is right between two
      // utterances of one voice and wrong between two voices.
      avatar.setFace(face)
      utterance.wear()
      bubble.clear()
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
