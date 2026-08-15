/**
 * How loud her voice is, right now.
 *
 * Deliberately the thinnest thing that can work: no state beyond the handles,
 * no branches, no tuning. Every decision about what a level MEANS lives in
 * `rig/envelope.ts`, which is pure and tested against a recording of her actual
 * voice. This file is the part that cannot be unit-tested without mocking a
 * browser, so there is as little of it as possible.
 *
 * ## Why an analyser and not the server's events
 *
 * Measured on a live session (2026-08-11): `output_audio_buffer.started` fired
 * ~690ms before the first real speech, and `response.done` arrived 2.1 SECONDS
 * before her audio finished playing -- the model generates faster than real
 * time and the client plays at 1x. Server events are simply on a different
 * clock from the speaker.
 *
 * An analyser on the playing graph measures the samples that are about to be
 * heard, so alignment is a property of where the tap is rather than something
 * anyone has to tune. Measured overhead: `baseLatency` 5.3ms plus a 21.3ms
 * analysis window, so the mouth tracks within roughly ±15ms -- an order of
 * magnitude inside the ~45ms/125ms range where a person notices.
 *
 * ## One thing that measurement no longer covers
 *
 * It was taken when THIS file's muted element was the only sink on the stream.
 * `speaker.ts` now owns a second element and is what you actually hear, while
 * the analyser still reads a `MediaStreamAudioSourceNode` built from the track
 * rather than a tap on that element -- two consumers of one stream, each with
 * its own buffering. The ±15ms figure therefore describes a graph that no
 * longer exists.
 *
 * Unverified, and deliberately not "fixed" by guesswork: routing playback
 * through `createMediaElementSource()` would make the tap exact by
 * construction, but it also moves the audible path into Web Audio, which is
 * where AEC3 and output device selection live -- a change that can only be
 * justified by measuring first. To measure: play a recording with a known
 * transient, log `performance.now()` at the analyser's first level rise and at
 * the element's `timeupdate`, and compare. Until then, treat lip-sync accuracy
 * as untested rather than as the number above.
 */

import { rms } from '../rig/envelope'

/** Analysis window. 1024 at 48kHz is 21.3ms, just over one frame at 60Hz. */
const FFT_SIZE = 1024

export interface AudioMeter {
  /** RMS of the most recent window, 0..1. Cheap enough to call every frame. */
  level(): number
  dispose(): void
}

/**
 * Tap a stream's loudness without changing what is heard.
 *
 * The stream is attached to a MUTED `<audio>` element as well as to the
 * analyser, and that element is not optional. Chromium does not pull data
 * through Web Audio from a remote MediaStream unless something is sinking it:
 * with the analyser alone, `getFloatTimeDomainData` returns silence forever --
 * which is indistinguishable from a transport carrying no audio, and would
 * present as her mouth simply never moving. Confirmed twice, once in mochi's
 * WebRTC probe and once in this project's envelope probe.
 *
 * Muted, because `speaker.ts` is what plays this stream. That sentence used to
 * read "the caller is already playing this stream somewhere" -- an assumption
 * rather than a fact, and a false one: no caller was, so this muted element was
 * the only `<audio>` in the program and the app ran perfectly and silently.
 * Naming the file that owns playback is the difference between an invariant and
 * a hope.
 */
export function createAudioMeter(stream: MediaStream): AudioMeter {
  // Declared before the play() below, which closes over it: `let` has no
  // hoisted value, so referencing it from a callback declared earlier in the
  // source would be a temporal dead zone error the first time a sink refused.
  let disposed = false
  const sink = new Audio()
  sink.srcObject = stream
  sink.muted = true
  // The element's job is to be a sink, and `speaker.ts` is what has to be
  // audible -- so a refusal here costs the mouth, not the sound, and
  // `speaker.ts` reports the audible failure. Logged rather than discarded,
  // because a silently refused pump reads downstream as a transport carrying
  // no audio.
  void sink.play().catch((error: unknown) => {
    if (!disposed) console.warn(`[voice] meter sink did not start: ${String(error)}`)
  })

  const context = new AudioContext()
  const source = context.createMediaStreamSource(stream)
  const analyser = context.createAnalyser()
  // `smoothingTimeConstant` is deliberately NOT set. It applies only to the
  // frequency-domain getters, and this reads `getFloatTimeDomainData`, so
  // setting it described a filter that cannot exist on this path. The envelope
  // owns smoothing regardless.
  analyser.fftSize = FFT_SIZE
  source.connect(analyser)

  const samples = new Float32Array(analyser.fftSize)

  return {
    level(): number {
      if (disposed) return 0
      analyser.getFloatTimeDomainData(samples)
      // The tested one from the rig, not a second copy. This loop was an exact
      // duplicate of `rms()`, which means production ran code the envelope's
      // test suite never touched and the two could drift apart silently.
      return rms(samples)
    },
    dispose(): void {
      if (disposed) return
      disposed = true
      source.disconnect()
      sink.pause()
      sink.srcObject = null
      // Not awaited: nothing below depends on the context finishing its
      // teardown, and a close that hangs must not hold up a window going away.
      void context.close().catch(() => undefined)
    },
  }
}
