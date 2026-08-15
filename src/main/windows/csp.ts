/**
 * The content policy, and the one line in it that WebRTC needs.
 *
 * `connect-src` governs ICE. That is not a guess and it is not from a spec
 * reading: mochi's shipped policy carries `stun: stuns: turn: turns:` in
 * `connect-src`, and those schemes are only there because the peer connection
 * did not work without them. Our companion page shipped `default-src 'none'`
 * with no `connect-src` at all, which would have blocked the session and
 * presented as "she never connects" with nothing pointing here.
 *
 * Sent as a RESPONSE HEADER rather than a `<meta>` tag, which is mochi's
 * lesson: a tag is baked into the HTML, so the development policy -- which has
 * to permit the dev server's origin and its hot-reload socket -- would ship
 * inside the built application. Two policies also do not widen each other; CSP
 * composes by intersection, so a tag left in place would quietly override
 * anything set here.
 */

import { session } from 'electron'

const CSP_HEADER = 'Content-Security-Policy'

const BASE = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self'",
  // The vendored faces. Absent, `default-src 'none'` catches fonts and the
  // window falls back to a system face -- which is the worst shape of failure
  // this file can produce, because nothing breaks: the text renders, the
  // layout holds, and only the console says the design is not the one being
  // looked at. Six woff2 files shipped and were blocked for two days.
  "font-src 'self'",
  "img-src 'self' data:",
  "object-src 'none'",
  "base-uri 'none'",
  "frame-src 'none'",
]

/**
 * ICE, and nothing else.
 *
 * NOT `https://api.openai.com`, which mochi needed and we do not: the SDP
 * exchange happens in main, so the renderer never issues that request. The
 * ephemeral key stays in the process that minted it and only SDP crosses the
 * bridge -- so the narrower policy is a consequence of that design rather than
 * an optimisation, and if it ever has to be widened, something has moved into
 * the renderer that should not have.
 */
const ICE = 'stun: stuns: turn: turns:'

export function policyFor(rendererUrl: string | null): string {
  const connect = `connect-src 'self' ${ICE}`
  if (rendererUrl === null) return [...BASE, connect].join('; ')

  // `'self'` already covers Vite's module graph AND its hot-reload socket,
  // because in development the document IS served from that origin -- and CSP
  // source matching lets an `http:` source expression cover `ws:` on the same
  // host. An earlier version listed the origin and a derived `ws://` variant
  // explicitly; two falsification attempts failed to block anything before it
  // became clear that neither entry could ever have mattered.
  //
  // Vite injects its client inline, which `script-src` must allow and a
  // packaged build must not -- the whole reason this is a header rather than a
  // meta tag baked into the HTML.
  return [
    ...BASE.filter((directive) => !directive.startsWith('script-src')),
    "script-src 'self' 'unsafe-inline'",
    connect,
  ].join('; ')
}

/**
 * Stamp the policy on our own documents.
 *
 * Matched by URL rather than applied to everything: the listener sits on the
 * default session, and a policy written for the companion has no business
 * landing on somebody else's page. The failure mode of getting the match wrong
 * is the quiet one -- a document nobody recognised gets NO policy, loads
 * perfectly, and is simply unprotected.
 */
export function applyContentSecurityPolicy(rendererUrl: string | null): void {
  const policy = policyFor(rendererUrl)
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    const ours =
      rendererUrl === null ? details.url.startsWith('file://') : details.url.startsWith(rendererUrl)
    if (!ours) return callback({})
    // Existing entries are dropped whatever their casing. HTTP header names are
    // case-insensitive and this object's keys are not, so adding
    // `Content-Security-Policy` beside a `content-security-policy` leaves BOTH
    // on the response -- and Chromium then enforces the intersection, which is
    // a policy nobody wrote.
    const headers = Object.fromEntries(
      Object.entries(details.responseHeaders ?? {}).filter(
        ([name]) => name.toLowerCase() !== CSP_HEADER.toLowerCase(),
      ),
    )
    callback({ responseHeaders: { ...headers, [CSP_HEADER]: [policy] } })
  })
}
