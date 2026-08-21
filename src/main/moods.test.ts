import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { EMOTIONS, type Emotion } from '@shared/avatar'
import { createRegistry } from '@shared/capability/registry'
import { DEFAULT_GRANTS } from '@shared/grants'
import { DEFAULT_PERSONA, type Persona } from '@shared/persona'
import { CAPABILITIES } from '../capabilities'
import { stubDeps } from '../test/capability-deps'
import { whatSheMayDo } from './what-she-may-do'

/**
 * Her face, from the character sheet to the pixels, in one pass.
 *
 * ## Why this file exists at all
 *
 * Every link in this chain is covered somewhere. `capability.test.ts` drives the
 * handler, `what-she-may-do.test.ts` drives the narrowing, `looks.test.ts` pins
 * the drawing, `persona.test.ts` validates the field. Nothing crossed a join.
 *
 * That is the exact shape this repository keeps shipping. `resources/icons/dock.png`
 * was measured against the artwork by a green test and read by no code at all.
 * The halo preference was wired end to end and governed a state its own window
 * was never told it was in. Both looked finished from every angle except the one
 * nobody stood at.
 *
 * So these tests deliberately use the REAL modules on both sides of each join —
 * the collected registry rather than a fixture manifest, `whatSheMayDo` rather
 * than a hand-built tool list, and the capability the compiler actually
 * collected rather than the one this file could import directly. A stub anywhere
 * in the middle would put the join back.
 *
 * ## The one thing it cannot reach
 *
 * Whether she CALLS it. Everything below is the tool being offered and honoured;
 * how often a model reaches for it is runtime behaviour, and no test here sees
 * it. Said out loud so this file is not read as covering more than it does.
 */

const REGISTRY = createRegistry(CAPABILITIES.manifests)

/** The worn character, with `faces` set to whatever this case is about. */
function wearing(faces: readonly Emotion[]): Persona {
  return { ...DEFAULT_PERSONA, faces }
}

/** The `set_expression` tool as it would actually go on the wire, or null. */
function offered(persona: Persona, grants = DEFAULT_GRANTS) {
  const mayDo = whatSheMayDo(persona, '', grants, REGISTRY.tools)
  return mayDo.tools.find((tool) => tool.name === 'set_expression') ?? null
}

/** The collected capability, run as the dispatch would run it. */
function call(face: string, deps: Parameters<typeof stubDeps>[0] = {}) {
  const capability = CAPABILITIES.byName.get('set_expression')
  expect(capability, 'set_expression is collected by the compiler').toBeDefined()
  if (capability === undefined) throw new Error('unreachable')
  const handler = capability.handler as (
    a: Record<string, string>,
    d: ReturnType<typeof stubDeps>,
  ) => { status: string; guidance?: string; answer?: { summary: string } }
  return handler({ face }, stubDeps({ wearExpression: () => true, ...deps }))
}

describe('a face this character uses', () => {
  it('is on the wire, and the same value the handler accepts', () => {
    /*
      THE JOIN. The enum is built by `narrowFaces` from `persona.faces`; the
      handler checks `deps.facesSheMayWear()`. Two answers to "which faces", in
      two processes' worth of code, and nothing made them compare notes — so a
      face could be offered and then refused, which reads to her as the tool
      being broken and to a log as her calling it wrong.

      The value fed to the handler is READ OFF THE WIRE rather than written here,
      which is what makes this a join and not two assertions side by side.
    */
    const persona = wearing(['neutral', 'happy'])
    const tool = offered(persona)
    expect(tool?.parameters.properties['face']?.enum).toEqual(['neutral', 'happy'])

    const onTheWire = tool?.parameters.properties['face']?.enum ?? []
    for (const face of onTheWire) {
      const out = call(String(face), { facesSheMayWear: () => persona.faces })
      expect(out.status, `${String(face)} was offered, so it must be accepted`).toBe('done')
      // The answer NAMES it, so a transcript replayed later records which face
      // she chose rather than that she chose something.
      expect(out.answer?.summary).toContain(String(face))
    }
  })

  it('refuses one this character does NOT use, and the wire agrees it was absent', () => {
    const persona = wearing(['neutral', 'happy'])
    const missing = EMOTIONS.filter((one) => !persona.faces.includes(one))
    expect(
      missing.length,
      'the fixture must leave some out or this proves nothing',
    ).toBeGreaterThan(0)

    for (const face of missing) {
      expect(offered(persona)?.parameters.properties['face']?.enum).not.toContain(face)
      const out = call(face, { facesSheMayWear: () => persona.faces })
      expect(out.status, `${face} is not offered, so it must be refused`).toBe('refused')
      // And the refusal names only what she HAS. Listing all eight would send
      // her straight back to one that was never on her wire.
      for (const absent of missing) expect(out.guidance).not.toContain(`, ${absent}`)
    }
  })
})

describe('the two gates that remove it entirely', () => {
  it('is not offered at all when the character uses no faces', () => {
    // Narrowing an empty list produced `enum: []` — a schema no argument can
    // satisfy, offered to her anyway. Not offered, rather than offered and
    // refused, is this file's rule one level down.
    expect(offered(wearing([]))).toBeNull()
  })

  it('is not offered at all when the grant is withheld', () => {
    const withheld = { ...DEFAULT_GRANTS, set_expression: false }
    expect(offered(wearing([...EMOTIONS]), withheld)).toBeNull()
    // And the tools that have nothing to do with her face are untouched, so
    // this is a gate rather than an outage.
    const mayDo = whatSheMayDo(wearing([...EMOTIONS]), '', withheld, REGISTRY.tools)
    expect(mayDo.tools.length).toBe(REGISTRY.tools.length - 1)
  })
})

describe('when there is no window to draw in', () => {
  it('says so rather than reporting a face nobody can see', () => {
    // The silent-success direction is the one that matters: she would narrate a
    // change of expression that never reached a pixel.
    const out = call('happy', {
      facesSheMayWear: () => ['neutral', 'happy'],
      wearExpression: () => false,
    })
    expect(out.status).toBe('refused')
    expect(out.guidance).toContain('could not be changed')
  })
})

/**
 * Trying one on from the grid, which is the only way to SEE six of the eight.
 *
 * `set_expression` made them reachable by her and her manifest asks her not to
 * use one every reply — so somebody deciding which faces a character should have
 * was looking at eight 56px tiles with no way to see the answer at the size she
 * appears on the desktop.
 *
 * The three things worth pinning are that it exists at all, that it is bounded
 * by `EMOTIONS`, and that it is NOT bounded by the switch beside it.
 */
describe('trying an expression on from the shelf', () => {
  const source = (relative: string): string =>
    readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8')

  it('is offered by the bridge and answered by main, on the same channel', () => {
    // Three files, one string, and nothing types the join. A rename in any of
    // them compiles and ships as a tile that stops doing anything.
    for (const file of ['../shared/ipc.ts', '../preload/index.ts', './index.ts']) {
      expect(source(file), file).toContain('shelf:wear-face')
    }
  })

  it('ends at the same frame the capability sends, not a wider one', () => {
    /*
      The reason this is safe to offer a window at all.

      `wearExpression` is one enum wide on purpose — a general "send a frame to
      the companion" would let anything push anything into her window. This path
      has to be exactly as narrow, and a source check is what says so: the
      handler builds the same `__mochi_face__` frame and nothing else.
    */
    const main = source('./index.ts')
    const handler = /ipcMain\.handle\('shelf:wear-face'[\s\S]*?\n\}\)/.exec(main)?.[0] ?? ''
    expect(handler, 'main answers shelf:wear-face').not.toBe('')
    expect(handler).toContain('EMOTIONS')
    expect(handler).toMatch(/type: '__mochi_face__', face/)
    // One send, and no other frame type smuggled alongside it.
    expect(handler.match(/webContents\.send/g)).toHaveLength(1)
    expect(handler.match(/__mochi_/g)).toHaveLength(1)
  })

  it('is NOT gated on the character’s faces, which is deliberate', () => {
    /*
      The switch beside the tile decides what SHE may reach for. A person
      clicking a tile in their own settings window is not her reaching for
      anything — and gating this on it would make it impossible to look at an
      expression before deciding whether to enable it, which is the one thing
      somebody standing at that grid wants to do.

      Asserted rather than left as a comment because it reads exactly like a
      bypass somebody would "fix".
    */
    const main = source('./index.ts')
    const handler = /ipcMain\.handle\('shelf:wear-face'[\s\S]*?\n\}\)/.exec(main)?.[0] ?? ''
    expect(handler).not.toContain('facesSheMayWear')
    expect(handler).not.toContain('readGrants')
    // And it refuses when there is no window, like the capability does — a
    // success reported over a missing window is a face nobody can see.
    expect(handler).toContain('isDestroyed')
  })
})

/**
 * The last join, and the only one that is two string literals in two processes.
 *
 * `wearExpression` sends `{ type: '__mochi_face__', face }` from main;
 * `companion/main.ts` reads `frame.face` off that type and validates it against
 * `EMOTIONS` before wearing it. Neither side imports the other, nothing types
 * the frame, and a rename on either side compiles, lints and ships — the face
 * would simply stop changing, silently, which is the whole failure mode this
 * chain has already produced twice in other guises.
 */
describe('the frame between the two processes', () => {
  const source = (relative: string): string =>
    readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8')

  it('is sent and read under the same name, carrying the same key', () => {
    const main = source('./index.ts')
    const companion = source('../renderer/companion/main.ts')
    for (const text of [main, companion]) expect(text).toContain('__mochi_face__')

    // The KEY as well as the type. A frame renamed on one side is caught by the
    // line above; a payload key renamed is not, and is just as silent.
    expect(main).toMatch(/type: '__mochi_face__', face/)
    expect(companion).toMatch(/\{ face\?: unknown \}\)\.face/)
  })

  it('is re-validated on arrival, because main is not the only thing that can send', () => {
    // `voice:send` carries frames the renderer forwards to the service. A face
    // arriving on it is checked against the canonical tuple rather than trusted
    // — the renderer holds the one thing that draws her.
    const companion = source('../renderer/companion/main.ts')
    const guard = /__mochi_face__[\s\S]{0,400}?EMOTIONS[\s\S]{0,200}?includes\(chosen\)/
    expect(companion).toMatch(guard)
  })
})
