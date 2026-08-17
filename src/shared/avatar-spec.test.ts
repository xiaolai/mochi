import { describe, expect, it } from 'vitest'
import { COLOUR_KEYS, FACE_BOUNDS, MOCHI, parseFaceSpec } from './avatar-spec'

/** A valid file, as an ordinary mutable object a test can spoil. */
const good = (): Record<string, unknown> => ({ ...MOCHI })

describe('parseFaceSpec', () => {
  it('accepts the built-in mochi', () => {
    // The built-in goes through the same validator a user avatar does. If it
    // could not, the plugin path would be a second code path that nothing
    // exercises -- and the first person to write their own avatar would be the
    // one to discover it was broken.
    const result = parseFaceSpec(MOCHI)
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.face).toEqual(MOCHI)
  })

  it('rejects anything that is not an object', () => {
    for (const value of [null, undefined, 42, 'mochi', [], true]) {
      expect(parseFaceSpec(value).ok, JSON.stringify(value)).toBe(false)
    }
  })

  it('reports EVERY problem, not just the first', () => {
    // Someone hand-editing a file wants the whole list. Failing on the first
    // field turns one round of fixing into five, with no way to see the rest.
    const broken = good()
    broken['bodyW'] = -1
    broken['waist'] = 99
    broken['colBody'] = 'greenish'
    const result = parseFaceSpec(broken)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.problems).toHaveLength(3)
    expect(result.problems.join('\n')).toContain('bodyW')
    expect(result.problems.join('\n')).toContain('waist')
    expect(result.problems.join('\n')).toContain('colBody')
  })

  it('names the field and the range it wanted', () => {
    const broken = good()
    broken['stiffness'] = 99_999
    const result = parseFaceSpec(broken)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.problems[0]).toContain('stiffness')
      expect(result.problems[0]).toContain(String(FACE_BOUNDS.stiffness.max))
      expect(result.problems[0]).toContain('99999')
    }
  })

  it('rejects out-of-range numbers rather than clamping them', () => {
    // Clamping would render something the designer did not ask for and say
    // nothing. A file that is wrong should be reported as wrong.
    for (const [key, bound] of Object.entries(FACE_BOUNDS)) {
      for (const value of [bound.min - 1, bound.max + 1]) {
        const broken = { ...good(), [key]: value }
        expect(parseFaceSpec(broken).ok, `${key} = ${value}`).toBe(false)
      }
    }
  })

  it('accepts both ends of every declared range', () => {
    // The bounds have to be reachable, or a slider at its limit produces a file
    // the loader refuses.
    for (const [key, bound] of Object.entries(FACE_BOUNDS)) {
      for (const value of [bound.min, bound.max]) {
        expect(parseFaceSpec({ ...good(), [key]: value }).ok, `${key} = ${value}`).toBe(true)
      }
    }
  })

  it('rejects NaN and Infinity, which are numbers but not values', () => {
    for (const value of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      expect(parseFaceSpec({ ...good(), bodyW: value }).ok).toBe(false)
    }
  })

  it('rejects a missing field instead of defaulting it', () => {
    // Silently substituting the built-in value would render a face nobody
    // designed, out of a file somebody thought was complete.
    const missing = good()
    delete missing['eyeX']
    const result = parseFaceSpec(missing)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.problems[0]).toContain('eyeX is missing')
  })

  it('reports an unknown field rather than ignoring it', () => {
    // A typo like `eyeWith` is otherwise silently dropped, and the designer
    // watches their change do nothing with no explanation available.
    const result = parseFaceSpec({ ...good(), eyeWith: 12 })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.problems[0]).toContain('eyeWith')
  })

  it('allows a name, because a file wants one', () => {
    expect(parseFaceSpec({ ...good(), name: 'blueberry' }).ok).toBe(true)
  })

  describe('colours', () => {
    it('accepts hex in every length canvas understands', () => {
      for (const colour of ['#abc', '#abcd', '#8ec8a8', '#8ec8a880']) {
        expect(parseFaceSpec({ ...good(), colBody: colour }).ok, colour).toBe(true)
      }
    })

    it('refuses anything that is not hex', () => {
      // A colour string reaches `fillStyle`, which is the one field in this
      // format that is INTERPRETED rather than measured. CSS accepts a great
      // deal there -- url(), image-set(), var() -- and none of it belongs in a
      // file somebody downloaded.
      for (const colour of [
        'red',
        'rgb(1,2,3)',
        'url(http://example.com/x.png)',
        'var(--x)',
        'image-set("a.png" 1x)',
        '#12345',
        '',
        '#gggggg',
      ]) {
        expect(parseFaceSpec({ ...good(), colBody: colour }).ok, colour).toBe(false)
      }
    })

    it('checks every colour field, not only the first', () => {
      for (const key of COLOUR_KEYS) {
        expect(parseFaceSpec({ ...good(), [key]: 'red' }).ok, key).toBe(false)
      }
    })
  })

  it('produces an object with exactly the expected keys', () => {
    // No prototype pollution and no extra properties riding along into the
    // renderer: the result is built key by key from the schema, never spread
    // from the input.
    const result = parseFaceSpec({ ...good(), name: 'x' })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const expected = [...Object.keys(FACE_BOUNDS), ...COLOUR_KEYS].sort()
    expect(Object.keys(result.face).sort()).toEqual(expected)
  })

  it('ignores a __proto__ key in the input', () => {
    const hostile = JSON.parse(`{"__proto__":{"polluted":true},"bodyW":100}`) as unknown
    parseFaceSpec(hostile)
    expect(({} as Record<string, unknown>)['polluted']).toBeUndefined()
  })
})

describe('the edges of the format', () => {
  it('lists every colour field, enforced by the type checker', () => {
    // `COLOUR_KEYS` used to be a plain `ColourKey[]`, which any subset
    // satisfies. It is now derived from a `Record<ColourKey, true>`, so a sixth
    // colour added to `FaceSpec` fails to compile until it is listed here. This
    // test is the runtime half: it catches a colour on the interface that the
    // table forgot, which the compiler alone would let through in the other
    // direction.
    const declared = Object.keys(MOCHI).filter((key) => key.startsWith('col'))
    expect([...COLOUR_KEYS].sort()).toEqual(declared.sort())
  })

  it('validates the name it accepts, rather than discarding it unread', () => {
    // `name` is a label for whoever edits the file and never reaches the
    // renderer -- but "accepted and discarded" and "accepted, malformed, and
    // discarded" looked the same from outside, so a typo simply vanished.
    expect(parseFaceSpec({ ...MOCHI, name: 'blueberry' }).ok).toBe(true)
    for (const bad of [12345, '', '   ', null, 'x'.repeat(200)]) {
      const result = parseFaceSpec({ ...MOCHI, name: bad })
      expect(result.ok, String(bad)).toBe(false)
      if (!result.ok) expect(result.problems.join(' ')).toContain('name')
    }
  })

  it('still keeps the name out of the face', () => {
    const result = parseFaceSpec({ ...MOCHI, name: 'blueberry' })
    expect(result.ok).toBe(true)
    if (result.ok) expect('name' in result.face).toBe(false)
  })

  it('returns a verdict even when reading a property throws', () => {
    // The signature promises an answer for ANY `unknown`. A getter that throws
    // used to take the caller down with it -- unreachable through JSON or IPC,
    // which is exactly why it would have waited for the first caller to pass a
    // live object.
    const hostile = {
      ...MOCHI,
      get colBody(): string {
        throw new Error('nope')
      },
    }
    const result = parseFaceSpec(hostile)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.problems[0]).toContain('could not be read')
  })
})
