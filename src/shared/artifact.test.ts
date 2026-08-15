/**
 * The artifact, as somebody else's file.
 *
 * This is the boundary a downloaded package crosses, so it gets the avatar
 * format's treatment: every problem reported at once, unknown fields refused rather
 * than dropped, and a `kind` this build cannot run refused rather than
 * approximated.
 */

import { describe, expect, it } from 'vitest'
import { ARTIFACT_KINDS, fill, isSiblingFile, parseArtifact, saidAdvance } from './artifact'

const GOOD = {
  kind: 'walk-a-list',
  items: ['ephemeral', 'candid'],
  advanceOn: ['next', '下一个'],
  say: 'Use "{item}" in one sentence.',
}

describe('reading an artifact', () => {
  it('accepts a complete one', () => {
    const read = parseArtifact(GOOD)
    expect(read.ok, read.ok ? '' : read.problems.join('; ')).toBe(true)
    if (!read.ok) return
    expect(read.artifact.items).toEqual(['ephemeral', 'candid'])
    // Absent means no announcement, not an empty string that gets spoken.
    expect(read.artifact.onRestart).toBeNull()
  })

  it('takes items from a sibling file', () => {
    const read = parseArtifact({ ...GOOD, items: { file: 'words.json' } })
    expect(read.ok).toBe(true)
    if (read.ok) expect(read.artifact.items).toEqual({ file: 'words.json' })
  })

  it('refuses a kind this build cannot run, and says what it can', () => {
    // Not approximated and not ignored. A persona that loads, looks right and
    // does nothing is the least debuggable outcome this feature can have.
    const read = parseArtifact({ ...GOOD, kind: 'pronunciation-coach' })
    expect(read.ok).toBe(false)
    if (read.ok) return
    expect(read.problems[0]).toContain('pronunciation-coach')
    expect(read.problems[0]).toContain(ARTIFACT_KINDS[0])
  })

  it('refuses a template that never mentions the item', () => {
    // The one mistake that is invisible: it reads fine and produces the same
    // sentence every turn, about nothing.
    const read = parseArtifact({ ...GOOD, say: 'Say something nice.' })
    expect(read.ok).toBe(false)
    if (!read.ok) expect(read.problems.join(' ')).toContain('{item}')
  })

  it('refuses an unknown field rather than dropping it', () => {
    const read = parseArtifact({ ...GOOD, advanceOnn: ['next'] })
    expect(read.ok).toBe(false)
    if (!read.ok) expect(read.problems.join(' ')).toContain('advanceOnn')
  })

  it('reports every problem at once, not the first', () => {
    // The rule, for its reason: reporting one turns a single round of
    // fixes into five for somebody editing by hand.
    const read = parseArtifact({ kind: 'walk-a-list', items: [], advanceOn: [], say: '' })
    expect(read.ok).toBe(false)
    if (!read.ok) expect(read.problems.length).toBeGreaterThanOrEqual(3)
  })
})

describe('a package may not choose which file the app opens', () => {
  it('accepts only a plain sibling name', () => {
    for (const name of ['words.json', 'items-2.json', 'a']) {
      expect(isSiblingFile(name), name).toBe(true)
    }
  })

  it('refuses anything that could leave the folder', () => {
    // "Data, never code" buys nothing if a data file can name
    // `../../.ssh/id_rsa` and have the app read it.
    for (const name of [
      '../secrets.json',
      '..',
      '/etc/passwd',
      'sub/dir.json',
      'back\\slash.json',
      '.hidden',
      '',
      'x'.repeat(65),
      42,
      null,
    ]) {
      expect(isSiblingFile(name), String(name)).toBe(false)
    }
  })

  it('refuses an escaping name at parse time too', () => {
    const read = parseArtifact({ ...GOOD, items: { file: '../../words.json' } })
    expect(read.ok).toBe(false)
  })
})

describe('the template and the trigger', () => {
  it('puts the item everywhere the template asks', () => {
    expect(fill('Say "{item}", then spell {item}.', 'candid')).toBe(
      'Say "candid", then spell candid.',
    )
  })

  it('advances on the phrases the artifact declares, with filler in front', () => {
    const phrases = ['next', '下一个']
    for (const said of ['next', 'Okay then, next.', '好，下一个']) {
      expect(saidAdvance(said, phrases), said).toBe(true)
    }
  })

  it('does not advance on a sentence that merely contains one', () => {
    const phrases = ['next']
    for (const said of ['what does next mean', 'next, what does that mean']) {
      expect(saidAdvance(said, phrases), said).toBe(false)
    }
  })

  it('knows nothing about words -- the phrases belong to the package', () => {
    // A deck of chords advanced by "again" is the same shape, and this file
    // has no opinion about that.
    expect(saidAdvance('again', ['again'])).toBe(true)
    expect(saidAdvance('next', ['again'])).toBe(false)
  })
})
