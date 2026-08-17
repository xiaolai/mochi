import type { MochiApi } from '@shared/ipc'
import { showFace, type Face } from './face'
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

function show(text: string): void {
  status.textContent = text
}

function describe(state: SessionState): string {
  if (state === 'opening') return 'opening…'
  // Nothing, once she is up. The status line exists for the states where there
  // is no her to look at; "listening" written under her face is a label on a
  // thing that is plainly already listening.
  if (state === 'listening') return ''
  if (state === 'closed') return 'closed'
  if ('expired' in state) return 'the hour is up — reconnecting'
  return state.failed
}

let session: Session | null = null

async function open(): Promise<void> {
  session?.close()
  session = null
  try {
    session = await openSession({
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
    })
    // Off unless this persona asked for it. The surface is opaque paper rather
    // than her colour: the design settles it as a rule — anything carrying
    // words gets its own opaque surface, because she may sit on anything, a
    // photograph included, and a translucent one has no contrast ratio at all.
    face.showWords(session.bubble ? { paper: '#f4f2ea', ink: '#2b2c25' } : null)
    // The microphone opens only once the session is up, so she is never
    // transmitting into a peer that is still being negotiated.
    session.listen(true)
  } catch (error: unknown) {
    show(String(error))
  }
}

/**
 * Main asks for a reconnect by sending a frame the service would never send.
 *
 * A private type rather than a second channel: `voice:send` already exists and
 * already crosses in the right direction, and the alternative is a channel per
 * lifecycle event — which is the shape v1's 45 message kinds grew out of.
 */
window.mochi.onSend((frame) => {
  if ((frame as { type?: unknown }).type === '__mochi_reconnect__') void open()
})

void open()
