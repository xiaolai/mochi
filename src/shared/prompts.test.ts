import { describe, expect, it } from 'vitest'
import { CAPABILITIES } from '../capabilities'
import {
  describedTools,
  missingFrom,
  promptsFor,
  toolArgumentKey,
  toolDescriptionKey,
} from './prompts'
import { createRegistry, type WireTool } from './capability/registry'
import { MAX_DESCRIPTION, MAX_PROPERTY_DESCRIPTION } from './capability/manifest'
import { resolvePrompts } from '../main/store/prompts'

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

/**
 * The half that was missing for the whole of this build.
 *
 * Every one of these entries was displayed, warned about, saved and reported
 * saved — and then discarded, because `createRegistry` copies the manifest's own
 * text and nothing put an override back. The property is the round trip, so
 * that is what is asserted: what somebody writes is what leaves on the wire.
 */
describe('a rewritten tool description reaches the wire', () => {
  const registry = createRegistry(CAPABILITIES.manifests)
  const first = registry.tools[0]
  if (first === undefined) throw new Error('this build has no capabilities')
  const specs = promptsFor(CAPABILITIES.manifests)
  const argument = Object.keys(first.parameters.properties)[0]
  if (argument === undefined) throw new Error('the first capability declares no arguments')

  function withOverrides(overrides: Readonly<Record<string, string>>): readonly WireTool[] {
    return describedTools(registry.tools, resolvePrompts(specs, overrides))
  }

  it('sends the shipped text when nothing has been written', () => {
    expect(withOverrides({})).toEqual(registry.tools)
  })

  it('sends what somebody wrote for the description', () => {
    const written = 'Ask the workspace, but only about cheese.'
    const sent = withOverrides({ [toolDescriptionKey(first.name)]: written })
    expect(sent.find((one) => one.name === first.name)?.description).toBe(written)
  })

  it('sends what somebody wrote for an argument', () => {
    const written = 'The question, phrased as a question.'
    const sent = withOverrides({ [toolArgumentKey(first.name, argument)]: written })
    expect(
      sent.find((one) => one.name === first.name)?.parameters.properties[argument]?.description,
    ).toBe(written)
  })

  it('leaves the other tools and the other arguments alone', () => {
    const sent = withOverrides({ [toolDescriptionKey(first.name)]: 'changed' })
    for (const tool of sent) {
      if (tool.name === first.name) continue
      expect(tool).toEqual(registry.tools.find((one) => one.name === tool.name))
    }
  })

  it('keeps the schema around the descriptions it rewrites', () => {
    /*
      `describedTools` rebuilds `parameters` and `properties` to swap two
      strings. Everything else in those objects has to come through untouched —
      `required` decides whether the model may omit an argument, and `type` is
      what makes the payload a function call at all. A spread that lost one
      would produce a tool that still reads correctly and is wrong on the wire.
    */
    const sent = withOverrides({ [toolDescriptionKey(first.name)]: 'changed' })
    for (const tool of sent) {
      const shipped = registry.tools.find((one) => one.name === tool.name)
      expect(tool.type, tool.name).toBe('function')
      expect(tool.parameters.type, tool.name).toBe('object')
      expect(tool.parameters.required, tool.name).toEqual(shipped?.parameters.required)
      expect(Object.keys(tool.parameters.properties), tool.name).toEqual(
        Object.keys(shipped?.parameters.properties ?? {}),
      )
    }
  })

  it('keeps an argument enum, which is what constrains what she can ask for', () => {
    // Spreading a property must not drop `enum`: it is the half that narrows
    // the wire, and losing it turns a closed set into free text silently.
    const sent = withOverrides({})
    for (const tool of sent) {
      for (const [name, property] of Object.entries(tool.parameters.properties)) {
        const shipped = registry.tools.find((one) => one.name === tool.name)?.parameters.properties[
          name
        ]
        expect(property.enum, `${tool.name}.${name}`).toEqual(shipped?.enum)
      }
    }
  })

  it('falls back to the shipped text when the override is empty', () => {
    // A tool with no explanation is worse than one nobody edited: the model
    // reaches for it blind. Refused at the point of saving too — this is the
    // second layer, for a `prompts.json` edited by hand.
    for (const empty of ['', '   ', '\n']) {
      const sent = withOverrides({ [toolDescriptionKey(first.name)]: empty })
      expect(sent.find((one) => one.name === first.name)?.description).toBe(first.description)
    }
  })

  it('falls back to the shipped text when the override is over the bound', () => {
    // Billed on every session for the life of it. `manifest.ts` checks the same
    // number, and an override that skipped it would be a bound with a door.
    const sent = withOverrides({
      [toolDescriptionKey(first.name)]: 'x'.repeat(MAX_DESCRIPTION + 1),
    })
    expect(sent.find((one) => one.name === first.name)?.description).toBe(first.description)
  })

  it('accepts an override of exactly the bound', () => {
    // The boundary itself is allowed. Off by one here would be a limit nobody
    // could reach and no error message would explain.
    const written = 'x'.repeat(MAX_DESCRIPTION)
    const sent = withOverrides({ [toolDescriptionKey(first.name)]: written })
    expect(sent.find((one) => one.name === first.name)?.description).toBe(written)
  })

  it('bounds an argument by the argument limit, not the description one', () => {
    const written = 'x'.repeat(MAX_PROPERTY_DESCRIPTION + 1)
    const sent = withOverrides({ [toolArgumentKey(first.name, argument)]: written })
    expect(
      sent.find((one) => one.name === first.name)?.parameters.properties[argument]?.description,
    ).toBe(first.parameters.properties[argument]?.description)
  })

  it('gives every tool entry a limit, since an unbounded one reaches the wire', () => {
    for (const manifest of CAPABILITIES.manifests) {
      const description = specs.find((one) => one.key === toolDescriptionKey(manifest.name))
      expect(description?.limit, manifest.name).toBe(MAX_DESCRIPTION)
      for (const name of Object.keys(manifest.parameters.properties)) {
        const one = specs.find((each) => each.key === toolArgumentKey(manifest.name, name))
        expect(one?.limit, `${manifest.name}.${name}`).toBe(MAX_PROPERTY_DESCRIPTION)
      }
    }
  })
})
