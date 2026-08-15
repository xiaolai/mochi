import { Window } from 'happy-dom'
import { beforeEach, describe, expect, it } from 'vitest'
import { MOCHI } from '@shared/avatar-spec'
import { THEME_IDS, applyTheme } from '@shared/theme'
import { domeOutline } from '../companion/rig/geometry'
import { silhouette } from './silhouette'

beforeEach(() => {
  const window = new Window()
  Object.assign(globalThis, { document: window.document })
})

const SVG_NS = 'http://www.w3.org/2000/svg'

describe('the swatch is her, not an approximation of her', () => {
  it('is built from the same geometry the rig fills', () => {
    // The point of the whole module. A CSS `border-radius` shaped roughly like
    // her drifts the first time anybody touches `waist` or a shoulder exponent,
    // and nothing would notice. Retuning her here MUST change the swatch.
    const before = silhouette(MOCHI).querySelector('path')?.getAttribute('d')
    const wider = silhouette({ ...MOCHI, waist: 0.6, upperShoulder: 4 })
      .querySelector('path')
      ?.getAttribute('d')
    expect(before).not.toBe(wider)

    // And it is the real outline: as many points as `domeOutline` returns at
    // the resolution this asks for, plus the closing Z.
    const points = domeOutline(
      {
        halfWidth: MOCHI.bodyW / 2,
        height: MOCHI.bodyH,
        waist: MOCHI.waist,
        upperShoulder: MOCHI.upperShoulder,
        lowerShoulder: MOCHI.lowerShoulder,
        lean: 0,
      },
      48,
    )
    const commands = (before ?? '').match(/[ML]/g) ?? []
    expect(commands).toHaveLength(points.length)
    expect(before?.endsWith('Z')).toBe(true)
  })

  it('carries her real proportions in the viewBox', () => {
    // Sized by width in CSS with `height: auto`, so the viewBox is the only
    // thing keeping her from being stretched.
    expect(silhouette(MOCHI).getAttribute('viewBox')).toBe(
      `0 0 ${String(MOCHI.bodyW)} ${String(MOCHI.bodyH)}`,
    )
  })

  it('rests on the base of the box, as she rests on a surface', () => {
    // Local space is +y up with the base at 0. Getting the flip wrong draws her
    // upside down, which is the kind of thing that looks like a geometry bug
    // in the rig rather than a bug in this file.
    const d = silhouette(MOCHI).querySelector('path')?.getAttribute('d') ?? ''
    const ys = [...d.matchAll(/[ML][\d.-]+ ([\d.-]+)/g)].map((m) => Number(m[1]))
    expect(Math.max(...ys)).toBeCloseTo(MOCHI.bodyH, 0)
    expect(Math.min(...ys)).toBeGreaterThanOrEqual(0)
  })
})

describe('the shading band', () => {
  it('paints the shadow first and the lit copy over it, displaced', () => {
    const svg = silhouette(MOCHI)
    const paths = [...svg.querySelectorAll('path')]
    // clip shape, shadow, lit copy.
    expect(paths).toHaveLength(3)
    expect(paths[1]?.getAttribute('fill')).toBe(MOCHI.colShadow)
    expect(paths[2]?.getAttribute('fill')).toBe(MOCHI.colBody)
    expect(paths[1]?.getAttribute('d')).not.toBe(paths[2]?.getAttribute('d'))
  })

  it('clips the lit copy, so it cannot spill past her outline', () => {
    // Without the clip the displaced copy escapes up and to the right, and she
    // gets a bright sliver outside her own silhouette.
    const svg = silhouette(MOCHI)
    const group = svg.querySelector('g')
    const clipRef = group?.getAttribute('clip-path') ?? ''
    expect(clipRef).toMatch(/^url\(#.+\)$/)
    const id = clipRef.slice(5, -1)
    expect(svg.querySelector(`clipPath#${id}`)).not.toBeNull()
  })

  it('gives every instance its own clip id', () => {
    // Eight swatches sharing one id means seven clip against the first one's
    // shape. Invisible while every theme has the same geometry, and wrong the
    // moment one does not.
    const ids = THEME_IDS.map((id) =>
      silhouette(applyTheme(MOCHI, id)).querySelector('clipPath')?.getAttribute('id'),
    )
    expect(new Set(ids).size).toBe(THEME_IDS.length)
  })

  it('shows each theme in its own colours', () => {
    for (const id of THEME_IDS) {
      const face = applyTheme(MOCHI, id)
      const paths = [...silhouette(face).querySelectorAll('path')]
      expect(paths[1]?.getAttribute('fill'), id).toBe(face.colShadow)
      expect(paths[2]?.getAttribute('fill'), id).toBe(face.colBody)
    }
  })
})

describe('accessibility', () => {
  it('is hidden by default, because a text label sits beside it', () => {
    expect(silhouette(MOCHI).getAttribute('aria-hidden')).toBe('true')
  })

  it('takes a name when it is the only thing identifying the choice', () => {
    const named = silhouette(MOCHI, { label: 'Moss' })
    expect(named.getAttribute('aria-label')).toBe('Moss')
    expect(named.hasAttribute('aria-hidden')).toBe(false)
  })

  it('is built in the SVG namespace', () => {
    // `createElement('svg')` renders nothing at all, silently. Same trap as
    // `icon.ts`, same first assertion.
    const svg = silhouette(MOCHI)
    expect(svg.namespaceURI).toBe(SVG_NS)
    expect(svg.querySelector('path')?.namespaceURI).toBe(SVG_NS)
  })
})
