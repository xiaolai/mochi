import type { MochiApi } from '@shared/ipc'

declare global {
  interface Window {
    readonly mochi: MochiApi
  }
}

const root = document.querySelector('#app')

if (root === null) {
  // Fail loud. Rendering into nothing is indistinguishable from a slow start.
  throw new Error('companion: #app is missing from the document')
}

// Round-trip the one declared channel on load. A broken preload bridge or an
// unregistered handler then shows up as visible text, rather than as a window
// that paints perfectly and does nothing — which is the failure this skeleton
// exists to make impossible to miss.
try {
  const reply = await window.mochi.invoke('companion:ping')
  root.textContent = `mochi — ${String(reply)}`
} catch (error) {
  root.textContent = 'mochi — the bridge did not answer'
  console.error('[companion] ping failed', error)
}
