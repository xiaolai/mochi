import { describe, expect, it } from 'vitest'

import { migrateBubbleSide } from './bubble-side'
import type { BubbleSideMigrationDeps } from './bubble-side'

/**
 * A one-time migration, tested for the first time.
 *
 * It ran exactly once on somebody's real data and could never be observed
 * doing it again — and it lived in `index.ts`, which cannot be imported
 * outside Electron, so none of the ordering below was assertable at all.
 *
 * The ordering IS the migration: `bubbleSideMigrated` marks first, because
 * `auto` is both the default and a real choice, so a second pass cannot tell a
 * character nobody has touched from one whose owner has since picked `auto`.
 */

function deps(over: Partial<BubbleSideMigrationDeps> = {}): BubbleSideMigrationDeps {
  return {
    userData: () => '/tmp/nowhere',
    catalogue: () => ({ personas: new Map(), problems: [] }) as never,
    savePersona: () => undefined,
    log: () => undefined,
    warn: () => undefined,
    ...over,
  }
}

describe('the bubble-side migration', () => {
  it('does not throw when there is nothing to carry', () => {
    // The ordinary case: `auto` is what the setting shipped as and what the
    // new field defaults to.
    expect(() => {
      migrateBubbleSide(deps())
    }).not.toThrow()
  })

  it('survives a character that cannot be written', () => {
    /*
      Said, not thrown. One character that could not be saved must not stop the
      others — and the marker is already down, so anything skipped here is
      skipped for good. That is the trade the ordering makes and it is why a
      throw would be the wrong answer.
    */
    const warned: string[] = []
    expect(() => {
      migrateBubbleSide(
        deps({
          savePersona: () => {
            throw new Error('read-only volume')
          },
          warn: (line) => warned.push(line),
        }),
      )
    }).not.toThrow()
  })
})
