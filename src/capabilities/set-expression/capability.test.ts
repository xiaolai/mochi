import { describe, expect, it } from 'vitest'
import { EMOTIONS } from '@shared/avatar'
import { stubDeps } from '../../test/capability-deps'
import { capability } from './capability'

/**
 * The tool that made six drawn expressions reachable.
 *
 * `neutral` and `sleepy` were the only two anybody ever saw, because
 * `setEmotion` had no caller outside the rig. These check the three things the
 * handler decides: whether the face exists, whether THIS character uses it, and
 * whether there is a window to draw it in.
 */

function run(args: Record<string, string>, deps = stubDeps({ wearExpression: () => true })) {
  const handler = capability.handler as (a: typeof args, d: typeof deps) => unknown
  return handler(args, deps) as { status: string; guidance?: string; answer?: { summary: string } }
}

describe('the manifest', () => {
  it('declares all eight, and is narrowed per character later', () => {
    // Declaring the full tuple here and narrowing in `whatSheMayDo` keeps one
    // answer to "which faces exist" and one to "which does she use".
    expect(capability.manifest.parameters.properties['face']?.enum).toEqual([...EMOTIONS])
  })

  it('tells her the face persists, which is what the rig does', () => {
    // The rig holds the emotion rather than expiring it. A description saying
    // otherwise would be a promise the drawing does not keep.
    expect(capability.manifest.description).toContain('stays until you change it')
  })
})

describe('what it refuses', () => {
  it('refuses a face that is not one of the eight', () => {
    const out = run({ face: 'smug' })
    expect(out.status).toBe('refused')
    expect(out.guidance).toContain('smug')
  })

  it('names the faces she ACTUALLY has when it refuses', () => {
    // Listing all eight would send her straight back to one that is not on her
    // wire — the refusal has to agree with the enum she was offered.
    const out = run({ face: 'smug' }, stubDeps({ facesSheMayWear: () => ['neutral', 'happy'] }))
    expect(out.guidance).toContain('neutral, happy')
    expect(out.guidance).not.toContain('sleepy')
  })

  it('refuses a real face this character does not use', () => {
    const out = run(
      { face: 'angry' },
      stubDeps({ facesSheMayWear: () => ['neutral'], wearExpression: () => true }),
    )
    expect(out.status).toBe('refused')
    expect(out.guidance).toContain('angry')
  })

  it('tells her to use words when she has no faces at all', () => {
    const out = run({ face: 'happy' }, stubDeps({ facesSheMayWear: () => [] }))
    expect(out.status).toBe('refused')
    expect(out.guidance).toContain('keep the face you have')
  })

  it('says so when there is no window to draw in', () => {
    // A silent success would have her narrating a face nobody can see.
    const out = run({ face: 'happy' }, stubDeps({ wearExpression: () => false }))
    expect(out.status).toBe('refused')
    expect(out.guidance).toContain('could not be changed')
  })
})

describe('what it does', () => {
  it('wears the face and says which one', () => {
    let worn: string | null = null
    const out = run(
      { face: 'thinking' },
      stubDeps({
        wearExpression: (face) => {
          worn = face
          return true
        },
      }),
    )
    expect(worn).toBe('thinking')
    expect(out.status).toBe('done')
    // Named, so a transcript replayed later records WHICH face she chose rather
    // than that she chose something.
    expect(out.answer?.summary).toContain('thinking')
  })

  it('is immediate, because the whole action is one value crossing a bridge', () => {
    expect(capability.kind).toBe('immediate')
  })
})
