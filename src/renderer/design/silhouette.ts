/**
 * Her outline, as an SVG element, from the geometry that draws her.
 *
 * The colour swatches were rounded rectangles with a CSS `border-radius`
 * approximating her shape. That is a fourth place her likeness is drawn, by
 * eye, and it drifts the moment anybody touches `waist` or a shoulder exponent
 * — the exact failure the one-graphical-source rule exists to prevent: one
 * graphical source, everything else generated from it. `domeOutline` is that
 * source, and it is what the rig fills and what the tray icon is traced from.
 *
 * ## Two tones, not one
 *
 * A flat disc of `colBody` shows the colour and misrepresents the drawing. What
 * makes her read as a body rather than a circle is the shading band: the
 * shadow shape, then the same outline displaced up and right and filled with
 * the lit colour, clipped so it cannot spill. That is `paintBody` in the rig
 * and `paintShadedBody` in the icon generator, and this is the third
 * implementation of the same three steps — small enough to state, and identical
 * because it reads the same `shadowX` and `shadowY` off the face.
 *
 * ## SVG rather than a canvas per swatch
 *
 * Eight canvases with their own contexts, redrawn whenever the pane repaints,
 * to show eight static shapes. SVG is the right medium for a shape that never
 * animates, and it scales with the type around it.
 */

import type { FaceSpec } from '@shared/avatar-spec'
import { domeOutline, type BodyShape, type Point } from '../companion/rig/geometry'

const SVG_NS = 'http://www.w3.org/2000/svg'

/**
 * Unique per document, because a `clipPath` is referenced by id.
 *
 * Eight swatches sharing one id means seven of them clip against the first
 * one's shape — which, since every theme has the same geometry, would look
 * perfectly correct right up until a face with different proportions arrived.
 */
let sequence = 0

/**
 * An id nothing in this document is already using.
 *
 * The counter alone is not enough. It lives in module scope, so it restarts
 * from zero whenever the module is evaluated again -- which is exactly what a
 * dev-server hot replacement does, while the previously rendered swatches are
 * still in the DOM. The new ones then reference the old ones' clip paths, and
 * because every theme shares one geometry it looks entirely correct.
 *
 * Asking the document is the only check that cannot be fooled by that, and it
 * runs a handful of times per render.
 */
function freeClipId(): string {
  let id = `mochi-clip-${String(++sequence)}`
  while (document.getElementById(id) !== null) id = `mochi-clip-${String(++sequence)}`
  return id
}

function shapeOf(face: FaceSpec): BodyShape {
  return {
    halfWidth: face.bodyW / 2,
    height: face.bodyH,
    waist: face.waist,
    upperShoulder: face.upperShoulder,
    lowerShoulder: face.lowerShoulder,
    // Upright. A swatch is her at rest, not mid-lean.
    lean: 0,
  }
}

/** Local space is +y up with the base at 0; SVG is +y down. */
function pathData(points: readonly Point[], face: FaceSpec, dx = 0, dy = 0): string {
  return `${points
    .map((point, index) => {
      const x = face.bodyW / 2 + point.x + dx
      const y = face.bodyH - point.y - dy
      return `${index === 0 ? 'M' : 'L'}${x.toFixed(2)} ${y.toFixed(2)}`
    })
    .join(' ')}Z`
}

export interface SilhouetteOptions {
  /**
   * A name, if this is the only thing identifying the choice.
   *
   * Omitted where a text label sits beside it, which is the swatch case — an
   * icon named the same as the word next to it is read out twice.
   */
  readonly label?: string
}

/** Her, in the colours of the face given. */
export function silhouette(face: FaceSpec, options: SilhouetteOptions = {}): SVGSVGElement {
  // Fewer points than the rig uses: at swatch size the difference between 96
  // segments and 48 is invisible, and this is eight of them in a list.
  const outline = domeOutline(shapeOf(face), 48)
  // ONE path string, used by the clip and by the shadow. It was computed twice
  // from the same two inputs -- so the mask and the shape it masks could only
  // ever agree by both being recomputed correctly, rather than by being the
  // same value.
  const d = pathData(outline, face)
  const id = freeClipId()

  const svg = frame(face, options)
  svg.append(clipDefs(id, d), shadowPath(face, d), litBody(face, outline, id))
  return svg
}

/** The element itself, sized and named. Accessibility lives here and nowhere else. */
function frame(face: FaceSpec, options: SilhouetteOptions): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg')
  svg.setAttribute('viewBox', `0 0 ${String(face.bodyW)} ${String(face.bodyH)}`)
  svg.setAttribute('class', 'silhouette')
  // A blank label counts as no label: `role="img"` with an empty `aria-label`
  // is an image a screen reader must announce and has no words for.
  if (options.label === undefined || options.label.trim() === '') {
    svg.setAttribute('aria-hidden', 'true')
  } else {
    svg.setAttribute('role', 'img')
    svg.setAttribute('aria-label', options.label)
  }
  return svg
}

/** The mask the lit copy is cut against. Her outline, undisplaced. */
function clipDefs(id: string, d: string): SVGDefsElement {
  const defs = document.createElementNS(SVG_NS, 'defs')
  const clip = document.createElementNS(SVG_NS, 'clipPath')
  clip.setAttribute('id', id)
  const shape = document.createElementNS(SVG_NS, 'path')
  shape.setAttribute('d', d)
  clip.append(shape)
  defs.append(clip)
  return defs
}

/** First and underneath, exactly as the rig paints it. */
function shadowPath(face: FaceSpec, d: string): SVGPathElement {
  const shadow = document.createElementNS(SVG_NS, 'path')
  shadow.setAttribute('d', d)
  shadow.setAttribute('fill', face.colShadow)
  return shadow
}

/**
 * Then the lit copy, displaced and clipped.
 *
 * The band she is left with is the crescent the copy fails to cover -- a hard
 * edge that follows the contour, which is what the artwork actually has. See
 * `paintBody`.
 */
function litBody(face: FaceSpec, outline: readonly Point[], id: string): SVGGElement {
  const lit = document.createElementNS(SVG_NS, 'g')
  lit.setAttribute('clip-path', `url(#${id})`)
  const body = document.createElementNS(SVG_NS, 'path')
  body.setAttribute(
    'd',
    pathData(outline, face, face.shadowX * face.bodyW, face.shadowY * face.bodyH),
  )
  body.setAttribute('fill', face.colBody)
  lit.append(body)
  return lit
}
