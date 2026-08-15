/**
 * The gates, which are the reason a capability flag alone is not enough.
 *
 * The shape for the mouth: three conditions in one
 * place, because the third -- does the thing currently loaded actually have
 * this? -- is the one that gets dropped, and dropped it makes every flag
 * report success over a face that does not move.
 */

import { describe, expect, it } from 'vitest'
import { EMOTIONS, renderableExpressions, renderableMotions } from './avatar'

describe('what can actually be rendered, as opposed to what is claimed', () => {
  // The rule in general form. The gate is a CONJUNCTION, and the
  // condition that gets dropped is "does the thing currently loaded have
  // this?" -- dropped, the call succeeds, every flag reports success, and her
  // face does not move.
  const can = { presetExpressions: true, supportsMotions: true }

  it('gives everything the format defines when a persona declares nothing', () => {
    // Saying nothing about expressions is not opting out of them.
    expect(renderableExpressions(can, null)).toEqual(EMOTIONS)
  })

  it('intersects a declared subset with what the format defines', () => {
    expect(renderableExpressions(can, ['happy', 'sad'])).toEqual(['happy', 'sad'])
  })

  it('orders by the canonical list, not by what the package wrote', () => {
    // A tool schema built from this must not change shape because somebody
    // reordered a JSON array.
    expect(renderableExpressions(can, ['sad', 'happy'])).toEqual(['happy', 'sad'])
  })

  it('renders none when the backend cannot do expressions at all', () => {
    // The first condition. A package declaring eight against a backend that
    // renders none must not read as eight.
    expect(renderableExpressions({ presetExpressions: false }, ['happy'])).toEqual([])
    expect(renderableExpressions({ presetExpressions: false }, null)).toEqual([])
  })

  it('distinguishes declaring nothing from declaring none', () => {
    // `[]` says this persona has no expressions and somebody meant it;
    // collapsing it into null would make a typo read as "everything".
    expect(renderableExpressions(can, [])).toEqual([])
    expect(renderableExpressions(can, null)).toEqual(EMOTIONS)
  })

  it('plays no motion, because no backend in this app has any', () => {
    // The honest state rather than a gap: a package may NAME motions so a clip
    // format designed later needs no retrofit, and naming one buys nothing
    // until something can play it. Without this gate that would be silent.
    expect(renderableMotions({ supportsMotions: false }, ['wave'])).toEqual([])
    expect(renderableMotions(can, ['wave'])).toEqual(['wave'])
    expect(renderableMotions(can, null)).toEqual([])
  })
})
