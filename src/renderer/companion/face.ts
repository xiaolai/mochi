import { EnvelopeMouth } from './rig/mouth'
import { MochiAvatar } from './rig/mochi'
import { rms } from './rig/envelope'

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
  /** Stop the loop, release the analyser, drop the canvas. */
  dispose(): void
}

export function showFace(canvas: HTMLCanvasElement): Face {
  const ctx = canvas.getContext('2d')
  if (ctx === null) throw new Error('companion: the canvas has no 2d context')

  const avatar = new MochiAvatar(ctx, { size: 'fit-canvas' })
  const mouth = new EnvelopeMouth(avatar)

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

    if (analyser !== null && samples !== null) {
      analyser.getFloatTimeDomainData(samples)
      const seconds = lastAt === null ? 1 / 60 : Math.min(0.1, (now - lastAt) / 1000)
      mouth.observe(rms(samples), seconds)
    }
    lastAt = now

    avatar.render(now)

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
