import type { MochiApi } from '@shared/ipc'
import { openSession, type Session, type SessionState } from './audio/session'

declare global {
  interface Window {
    readonly mochi: MochiApi
  }
}

const found = document.querySelector('#app')
if (found === null) {
  // Fail loud. Rendering into nothing is indistinguishable from a slow start.
  throw new Error('companion: #app is missing from the document')
}
// Re-bound so the narrowing survives into the closures below, which are defined
// after the check and cannot see it otherwise.
const root: Element = found

/** Her voice. Attached to an element because that is what plays audio. */
const speaker = new Audio()
speaker.autoplay = true

function show(text: string): void {
  root.textContent = text
}

function describe(state: SessionState): string {
  if (state === 'opening') return 'opening…'
  if (state === 'listening') return 'listening'
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
      },
      onExpiry: () => {
        /* main schedules the reconnect; nothing to do here */
      },
    })
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
