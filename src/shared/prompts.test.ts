import { describe, expect, it } from 'vitest'
import { CAPABILITIES } from '../capabilities'
import { missingFrom, promptsFor, toolArgumentKey, toolDescriptionKey } from './prompts'

describe('the catalogue', () => {
  const all = promptsFor(CAPABILITIES.manifests)

  it('covers every capability description and every argument', () => {
    /*
      The claim this whole change makes is that NOTHING model-facing is left
      unreachable. For the tool half that is checkable rather than assertable in
      prose: every manifest in this build must appear, and so must each of its
      arguments.
    */
    for (const manifest of CAPABILITIES.manifests) {
      expect(all.map((one) => one.key)).toContain(toolDescriptionKey(manifest.name))
      for (const argument of Object.keys(manifest.parameters.properties)) {
        expect(all.map((one) => one.key)).toContain(toolArgumentKey(manifest.name, argument))
      }
    }
  })

  it('derives tool text from the manifest rather than restating it', () => {
    // Two sources for one sentence is two places for it to drift. Adding a
    // capability adds its prompts here with no edit to the catalogue at all.
    const manifest = CAPABILITIES.manifests[0]
    if (manifest === undefined) throw new Error('this build has no capabilities')
    const entry = all.find((one) => one.key === toolDescriptionKey(manifest.name))
    expect(entry?.text).toBe(manifest.description)
  })

  it('gives every entry a stable key, a title and a purpose', () => {
    // The pane draws all three, and an entry with an empty purpose is a box
    // somebody is asked to edit without being told what it does.
    for (const spec of all) {
      expect(spec.key, spec.title).not.toBe('')
      expect(spec.title, spec.key).not.toBe('')
      expect(spec.purpose, spec.key).not.toBe('')
    }
  })

  it('has no duplicate keys, since the key is the name on disk', () => {
    expect(new Set(all.map((one) => one.key)).size).toBe(all.length)
  })

  it('ships a default for every entry', () => {
    // Something has to be there on a fresh install. "Nothing is hardcoded"
    // means nothing is FIXED, not that nothing ships.
    for (const spec of all) expect(spec.text, spec.key).not.toBe('')
  })

  it('keeps every required phrase in its own default', () => {
    // A default that failed its own requirement would warn on a fresh install,
    // which teaches people to ignore the warning.
    for (const spec of all) expect(missingFrom(spec, spec.text), spec.key).toEqual([])
  })
})
