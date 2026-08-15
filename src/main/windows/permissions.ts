/**
 * What the renderer is allowed to ask the OS for.
 *
 * Its own module because it is a security policy, and a security policy buried
 * two thirds of the way down a startup function is one nobody reviews. It also
 * has a specific past: the handler used to be `callback(permission === 'media')`,
 * which granted to ANY WebContents that asked -- and `media` covers the camera,
 * so a page loaded into some future window could have taken video.
 */

import { session, type BrowserWindow } from 'electron'

/**
 * Whether a request asks for the microphone and nothing else.
 *
 * `mediaTypes` is what separates the microphone this app needs from the camera
 * it never uses — the distinction the module header describes, made here.
 */
function mediaAllowed(details: unknown): boolean {
  const types =
    typeof details === 'object' && details !== null && 'mediaTypes' in details
      ? (details as { mediaTypes?: readonly string[] }).mediaTypes
      : undefined
  // An empty or absent list is NOT a pass. Electron omits `mediaTypes` on
  // some requests, and defaulting that to "allowed" would grant exactly the
  // unexamined case this handler exists to catch.
  return types !== undefined && types.length > 0 && types.every((type) => type === 'audio')
}
/**
 * Install both handlers.
 *
 * BOTH, always. The request handler governs prompts and the check handler
 * governs synchronous checks; leaving either unset means the two can disagree
 * about the same question, which is a gap nobody notices until something reads
 * the one that was never written.
 */
export function applyMediaPolicy(liveWindow: () => BrowserWindow | null): void {
  // Handlers must be SET, even to say no: without one, Electron denies `media`
  // outright and `getUserMedia` rejects with no OS prompt ever shown — which
  // looks exactly like a user refusing.
  session.defaultSession.setPermissionRequestHandler((contents, permission, callback, details) => {
    const ours = contents === liveWindow()?.webContents
    callback(ours && permission === 'media' && mediaAllowed(details))
  })
  // The same question, asked the same way. This handler approved any `media`
  // check from the companion without looking at what kind, so a synchronous
  // check for video came back allowed while the request handler beside it was
  // carefully refusing exactly that.
  //
  // `mediaType` is singular here, unlike the request handler's `mediaTypes`
  // array -- Electron gives the check handler one type at a time. An absent or
  // unrecognised type is denied rather than defaulted, which is the same rule
  // `mediaAllowed` applies to an empty list.
  session.defaultSession.setPermissionCheckHandler((contents, permission, _origin, details) => {
    if (contents !== liveWindow()?.webContents || permission !== 'media') return false
    const mediaType =
      typeof details === 'object' && details !== null && 'mediaType' in details
        ? (details as { mediaType?: string }).mediaType
        : undefined
    return mediaType === 'audio'
  })
}
