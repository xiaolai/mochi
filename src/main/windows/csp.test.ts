import { describe, expect, it } from 'vitest'
import { policyFor } from './csp'

describe('policyFor', () => {
  it('permits the ICE schemes WebRTC needs', () => {
    // The load-bearing line. `connect-src` governs ICE — mochi's shipped policy
    // carries these schemes because the peer connection did not work without
    // them, and our page previously had no `connect-src` at all.
    for (const policy of [policyFor(null), policyFor('http://localhost:5173')]) {
      for (const scheme of ['stun:', 'stuns:', 'turn:', 'turns:']) {
        expect(policy, scheme).toContain(scheme)
      }
    }
  })

  it('is enforced — verified against a live renderer, not assumed', () => {
    // Removing `'self'` from connect-src produced, in the renderer console:
    //   Connecting to 'ws://localhost:5173/...' violates the following Content
    //   Security Policy directive: "connect-src stun: stuns: turn: turns:".
    // Two earlier attempts failed to falsify because `'self'` IS the dev origin
    // in development, so nothing they removed could ever have blocked anything.
    expect(policyFor('http://localhost:5173')).toContain("connect-src 'self'")
  })

  it('never lets a packaged build run inline script', () => {
    // Vite injects its client inline in development. A meta tag would bake that
    // allowance into the shipped HTML, which is why this is a response header.
    expect(policyFor(null)).not.toContain("'unsafe-inline'")
    expect(policyFor('http://localhost:5173')).toContain("script-src 'self' 'unsafe-inline'")
  })

  it('denies everything not named', () => {
    for (const directive of ["default-src 'none'", "object-src 'none'", "base-uri 'none'"]) {
      expect(policyFor(null)).toContain(directive)
    }
  })

  it('does not open a path to the API from the renderer', () => {
    // The SDP exchange happens in main, so the ephemeral key never crosses the
    // bridge. If this ever has to be widened, something moved into the renderer
    // that should not have.
    expect(policyFor(null)).not.toContain('api.openai.com')
  })
})
