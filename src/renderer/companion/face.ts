import { MochiAvatar } from './rig/mochi'
import { advanceEnvelope, rms, DEFAULT_ENVELOPE, SILENT } from './rig/envelope'
import { createBubble, type BubbleColours } from './bubble'

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
  /** One fragment of what she is saying. Ignored unless the bubble is on. */
  saying(delta: string, responseId: string): void
  /** Her voice for this response has started. Paces the bubble's reveal. */
  speaks(responseId: string): void
  /** Turn the bubble on for this persona, with the surface it draws on. */
  showWords(colours: BubbleColours | null): void
  /** Stop the loop, release the analyser, drop the canvas. */
  dispose(): void
}

export function showFace(canvas: HTMLCanvasElement): Face {
  const found = canvas.getContext('2d')
  if (found === null) throw new Error('companion: the canvas has no 2d context')
  // Re-bound so the narrowing survives into the render loop below.
  const ctx: CanvasRenderingContext2D = found

  const avatar = new MochiAvatar(ctx, { size: 'fit-canvas' })
  const bubble = createBubble()

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
    bubble.step(envelope.quietFor, seconds)
    lastAt = now

    avatar.render(now)
    // AFTER her, so it sits above rather than behind. It is asked nothing about
    // the mouse: `hitTest` below is the avatar's alone, which is what keeps the
    // design's promise that a bubble cannot enlarge her hit region.
    if (colours !== null) bubble.draw(ctx, canvas.clientWidth, colours)

    // Only when it CHANGES. Asking main to toggle the window flag sixty times a
    // second would be sixty IPC messages a second for an answer that changes
    // when the cursor crosses an edge.
    const on = pointer !== null && avatar.hitTest(pointer.x, pointer.y)
    if (on !== solid) {
      solid = on
      window.mochi.report({ kind: 'pointer', onHer: on })
    }
  }
  frame = requestAnimationFrame(tick)

  return {
    saying: (delta: string, responseId: string) => {
      if (colours !== null) bubble.add(delta, responseId)
    },
    speaks: (responseId: string) => {
      if (colours !== null) bubble.speaks(responseId)
    },
    showWords: (next: BubbleColours | null) => {
      colours = next
      // Turning it off forgets what was on it, so switching to a character
      // without a bubble and back does not resurrect the previous one's words.
      if (next === null) bubble.clear()
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
