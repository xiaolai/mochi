/**
 * Her voice, actually coming out of the speakers.
 *
 * This file exists because the app once did everything else correctly and was
 * silent. The session connected, the model spoke, `output_audio_buffer.started`
 * and `.stopped` bracketed 2.7 seconds of audio, and her mouth moved in time
 * with words nobody could hear -- because the only `<audio>` element in the
 * program belonged to `meter.ts`, which mutes its element on the documented
 * assumption that the caller plays the stream somewhere. Nobody did. Receiving
 * a WebRTC track does not play it; something has to sink it, audibly, on
 * purpose.
 *
 * So playback gets a name and an owner rather than being a side effect of
 * measuring. Kept apart from the meter for a concrete reason: `teardown()`
 * disposes and recreates the meter, and a design where the analyser also
 * carries the audio would cut her off every time the tap churned.
 */

export interface Speaker {
  dispose(): void
}

/**
 * Play a remote stream out loud.
 *
 * The rejection from `play()` is REPORTED, not swallowed. An autoplay policy
 * refusing here produces exactly the failure this file was written to fix --
 * everything green, nothing audible -- and the only difference between a bug
 * that takes a minute to find and one that takes an hour is whether this line
 * says anything.
 */
export function playStream(stream: MediaStream, onSilent: (reason: string) => void): Speaker {
  const element = new Audio()
  element.srcObject = stream
  // Explicit rather than trusting a default, because the whole point of this
  // module is being audible; a default that changes is a silent regression.
  element.muted = false
  element.volume = 1
  let disposed = false

  void element.play().then(
    () => {
      if (!disposed) console.log('[voice] speaker playing')
    },
    (error: unknown) => {
      // Disposal aborts a pending play(), and Chromium reports that as an
      // AbortError. Treating it as a fault would report "she will be silent"
      // every single time a session closed normally -- a false alarm that
      // teaches you to ignore the true one.
      if (disposed) return
      const reason = `playback was refused: ${String(error)}`
      console.error(`[voice] SPEAKER BLOCKED — ${reason}`)
      // Reported, not just logged. A refused play() leaves a session that is
      // connected, transcribing, and permanently inaudible -- indistinguishable
      // from working unless somebody is listening.
      onSilent(reason)
    },
  )

  return {
    dispose(): void {
      if (disposed) return
      disposed = true
      element.pause()
      element.srcObject = null
    },
  }
}
