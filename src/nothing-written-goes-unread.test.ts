import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import { CAPABILITIES } from './capabilities'
import { promptsFor, toolArgumentKey, toolDescriptionKey } from '@shared/prompts'

/**
 * A producer with no consumer, and nothing that fails.
 *
 * ## Five instances, one mechanism
 *
 * This is not a hypothesis. Each of these was found separately, each looked
 * like its own bug, and all five are the same shape — something is computed,
 * stored or sent, and the thing that was supposed to read it does not:
 *
 * | what | written | read |
 * | --- | --- | --- |
 * | `tool.*.description` | `prompts.json`, on every save | never; the wire used the manifest |
 * | `notes.*`, `grants.*` | `prompts.json`, on every save | never; two default parameters swallowed them |
 * | `.alarm` | onto a warning element | never; the stylesheet's variant is `.note.bad` |
 * | `SettingsView.pronoun` | across the bridge, for the length of the build | never; every character came out "her" |
 * | `SettingsKey.shipped` | across the bridge | never; added and unread in one commit |
 *
 * The last is the sharpest evidence that a check is the answer rather than
 * another careful pass: it was introduced by the change that fixed the first
 * two, by somebody actively looking for this exact defect.
 *
 * Every one of them was invisible. Nothing threw, no test failed, and the
 * screen looked right — a prompt that reads correctly is not distinguishable
 * from a prompt that reads correctly and is not the one you configured.
 *
 * ## What is checked, and why these two surfaces
 *
 * Two of the four surfaces this class lives on are covered elsewhere: CSS
 * classes by `stylesheets.test.ts`, in both directions, and the prompt-to-wire
 * round trip by `prompts.test.ts` and `what-she-may-do.test.ts`, which assert
 * that a rewritten string actually comes out the other end. What was left is
 * the two that had no check at all.
 *
 * **Every catalogued prompt is asked for somewhere.** The catalogue's claim is
 * that it holds every string this app puts in front of a model. A key nobody
 * resolves is an editor in the settings window for a string that reaches
 * nothing — which is what four of them were.
 *
 * **Every field crossing the bridge is read by a renderer.** Main computes it,
 * serialises it and sends it on every read; if no window looks at it, the work
 * and the wire are spent on nothing, and — worse — a reader may believe the
 * value is being honoured. `pronoun` was exactly that for the whole build.
 *
 * ## The direction each check can be wrong in
 *
 * Both OVER-collect consumption: a field is called read if its name appears as
 * a property access or a destructuring binding anywhere in the renderer, and a
 * prompt is called consumed if its key appears in any resolver call. So both
 * can miss a dead one; neither can invent a live one. That is the safe
 * direction — a false alarm here would be a test nobody trusts, and the point
 * of a ratchet is that it is believed when it fires.
 *
 * Checked against the historical instance rather than assumed: at `bfd3732~1`,
 * the commit before the pronoun was first rendered, `.pronoun` appears nowhere
 * in `src/renderer`. This would have caught it.
 */

const SRC = fileURLToPath(new URL('.', import.meta.url))

function filesUnder(directory: string, keepTests = false): readonly string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = `${directory}${entry.name}`
    if (entry.isDirectory()) return filesUnder(path + '/', keepTests)
    if (!entry.name.endsWith('.ts')) return []
    if (!keepTests && entry.name.endsWith('.test.ts')) return []
    return [path]
  })
}

function sourceOf(paths: readonly string[]): string {
  return paths.map((path) => readFileSync(path, 'utf8')).join('\n')
}

describe('every catalogued prompt is asked for', () => {
  const specs = promptsFor(CAPABILITIES.manifests)
  /*
    COMMENTS STRIPPED, and the catalogue itself excluded.

    Both matter. `summariser.instruction` is resolved as
    `promptsNow()('summariser.instruction')` — a call on a call, which a pattern
    matching `prompt('…')` misses — and it is also NAMED in three comments, so a
    check that read prose would have passed it for the wrong reason and stayed
    green when the resolver went away.

    So the rule is: the key appears as a string literal, in code, outside the
    file that declares it. That over-collects — a key in a test fixture counts —
    and over-collecting is the safe direction here, because a false alarm is a
    test nobody trusts.
  */
  const everything = sourceOf(filesUnder(SRC, true).filter((path) => !path.endsWith('prompts.ts')))
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^[ \t]*\/\/.*$/gm, '')

  const asked = new Set([...everything.matchAll(/'([\w.-]+)'/g)].map((one) => one[1] ?? ''))

  /**
   * The tool entries are resolved BY CONSTRUCTION, not by name.
   *
   * `describedTools` builds their keys from the manifest through
   * `toolDescriptionKey` and `toolArgumentKey`, so they never appear as
   * literals and a check looking for one would call every tool prompt dead.
   * `prompts.test.ts` asserts that round trip directly, which is the stronger
   * evidence anyway: it puts a string in and reads it off the wire.
   */
  const byConstruction = new Set(
    CAPABILITIES.manifests.flatMap((manifest) => [
      toolDescriptionKey(manifest.name),
      ...Object.keys(manifest.parameters.properties).map((argument) =>
        toolArgumentKey(manifest.name, argument),
      ),
    ]),
  )

  it('has a catalogue to check, and a detector that matches something', () => {
    // Counted first. A regex that has stopped matching would call every prompt
    // dead, and one that matched everything would call none of them dead —
    // both look exactly like a passing test.
    expect(specs.length).toBeGreaterThan(20)
    expect(asked.size).toBeGreaterThan(10)
  })

  it.each(specs.map((spec) => [spec.key]))('%s', (key) => {
    expect(
      asked.has(key) || byConstruction.has(key),
      `this prompt is offered for editing and nothing resolves it — either read it or drop it from the catalogue`,
    ).toBe(true)
  })
})

describe('every field that crosses the bridge is read by a window', () => {
  const renderer = sourceOf(filesUnder(`${SRC}renderer/`))

  /** A property access, or a name bound out of a destructuring pattern. */
  function isRead(field: string): boolean {
    if (new RegExp(`\\.${field}\\b`).test(renderer)) return true
    return new RegExp(`\\{[^{}]*\\b${field}\\b[^{}]*\\}\\s*=`).test(renderer)
  }

  /** The `readonly` fields of every interface in a file whose name matches. */
  function fieldsIn(file: string, prefixes: readonly string[]): readonly (readonly string[])[] {
    const source = readFileSync(`${SRC}shared/${file}`, 'utf8')
    const found: (readonly string[])[] = []
    for (const match of source.matchAll(/export interface (\w+)\s*\{([\s\S]*?)\n\}/g)) {
      const name = match[1] ?? ''
      if (!prefixes.some((prefix) => name.startsWith(prefix))) continue
      const body = (match[2] ?? '').replace(/\/\*[\s\S]*?\*\//g, '')
      for (const field of body.matchAll(/^\s*readonly (\w+)\??:/gm)) {
        found.push([`${name}.${field[1] ?? ''}`, field[1] ?? ''])
      }
    }
    return found
  }

  const fields = [
    ...fieldsIn('ipc.ts', ['Settings']),
    ...fieldsIn('history-window.ts', ['Shelf', 'History']),
  ]

  it('has fields to check, and a detector that can say no', () => {
    expect(fields.length).toBeGreaterThan(50)
    // The guard on the guard: a matcher that answered `true` for anything would
    // make every assertion below vacuous.
    expect(isRead('aFieldNoWindowCouldPossiblyRead')).toBe(false)
    expect(isRead('pronoun')).toBe(true)
  })

  it.each(fields)('%s', (_label, field) => {
    expect(
      isRead(field),
      `main sends this on every read and no window looks at it — either draw it or stop sending it`,
    ).toBe(true)
  })
})
