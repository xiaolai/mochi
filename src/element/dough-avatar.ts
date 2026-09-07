/**
 * `<dough-avatar>` — the engine as a custom element.
 *
 * The point of this file is that using the character engine from a plain HTML
 * page should not require a bundler, a framework, or knowing that a render loop
 * exists. Everything below is the boilerplate a host would otherwise write:
 * a canvas sized to the element at device resolution, a rAF loop that stops
 * when the element leaves the document, and attributes wired to the backend.
 *
 * **Browser only.** Importing this module evaluates `class ... extends
 * HTMLElement`, which throws in a bare Node process — so it is a SEPARATE entry
 * point (`@hando/dough/element`) that server-side code must not import. The
 * core is meant to run under Node and does; this is not.
 */

import { DoughAvatar } from '../canvas2d/avatar.js'
import { parseFaceSpec, type FaceSpec } from '../core/spec.js'
import { MOCHI } from '../characters/mochi.js'
import { EMOTIONS, type Emotion } from '../core/vocabulary.js'

function isEmotion(value: string | null): value is Emotion {
  return value !== null && (EMOTIONS as readonly string[]).includes(value)
}

/**
 * `size`, as the backend takes it: a percentage, or the string that means
 * "fill whatever canvas you were given". Anything unparseable is the latter,
 * which is also what an absent attribute means.
 */
function sizeFrom(raw: string | null): number | 'fit-canvas' {
  if (raw === null || raw.trim() === '' || raw.trim() === 'fit-canvas') return 'fit-canvas'
  const percent = Number(raw)
  return Number.isFinite(percent) ? percent : 'fit-canvas'
}

export class DoughAvatarElement extends HTMLElement {
  static observedAttributes = ['emotion', 'size', 'face']

  private canvas: HTMLCanvasElement | null = null
  private avatar: DoughAvatar | null = null
  private frame = 0
  private observer: ResizeObserver | null = null
  private face: FaceSpec | undefined

  connectedCallback(): void {
    /*
      Capabilities FIRST, before anything is created or appended.

      Checked up front rather than discovered halfway through: initialising in
      order meant a missing `ResizeObserver` threw after the avatar existed and
      a missing `requestAnimationFrame` threw after the observer was attached,
      each leaving a half-built element with no teardown path. Nothing is built
      until everything needed to tear it down is known to exist.
    */
    if (
      typeof ResizeObserver === 'undefined' ||
      typeof requestAnimationFrame !== 'function' ||
      typeof cancelAnimationFrame !== 'function'
    ) {
      return
    }

    if (this.canvas === null) {
      const canvas = document.createElement('canvas')
      canvas.style.width = '100%'
      canvas.style.height = '100%'
      canvas.style.display = 'block'
      this.canvas = canvas
    }
    // A 2D context can genuinely be refused — a lost GPU, or too many live
    // canvases. Returning before the canvas is appended leaves the element
    // empty rather than showing a blank rectangle that looks like a bug.
    const ctx = this.canvas.getContext('2d')
    if (ctx === null) return

    if (this.style.display === '') this.style.display = 'block'
    if (!this.canvas.isConnected) this.append(this.canvas)

    this.avatar = new DoughAvatar(ctx, {
      // Spread rather than `face: this.face`: under `exactOptionalPropertyTypes`
      // an explicit `undefined` is not the same as an absent key, and the
      // engine's default only applies to the absent one.
      ...(this.face === undefined ? {} : { face: this.face }),
      size: sizeFrom(this.getAttribute('size')),
    })
    this.applyEmotion()
    this.fitToElement()

    // Re-measure on layout change rather than on window resize: the element can be
    // resized by its container without the window changing at all.
    this.observer = new ResizeObserver(() => this.fitToElement())
    this.observer.observe(this)

    const tick = (now: number): void => {
      this.avatar?.render(now)
      this.frame = requestAnimationFrame(tick)
    }
    this.frame = requestAnimationFrame(tick)
  }

  disconnectedCallback(): void {
    // Both, and neither is optional: a live rAF loop keeps the element and its
    // canvas reachable, so an element removed from the document would go on
    // painting into a detached canvas forever.
    if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(this.frame)
    this.frame = 0
    this.observer?.disconnect()
    this.observer = null
    this.avatar = null
  }

  attributeChangedCallback(name: string): void {
    // Read back through `getAttribute` rather than taking the new value: that
    // makes removal — which arrives as null — the same code path as a change,
    // and every one of these has a defined meaning for "absent".
    if (name === 'emotion') this.applyEmotion()
    if (name === 'face') this.applyFace()
    if (name === 'size') this.applySize()
  }

  /** The face, as a `FaceSpec`. Set this instead of the attribute when you have one. */
  set faceSpec(face: FaceSpec | undefined) {
    this.face = face
    // Cleared means "back to the default", applied to the LIVE avatar too.
    // Clearing only the stored copy left the current face on screen until the
    // next reconnect, at which point it silently changed — the same input
    // producing two different results depending on DOM history.
    if (this.avatar === null) return
    this.avatar.setFace(face ?? MOCHI)
  }

  get faceSpec(): FaceSpec | undefined {
    return this.face
  }

  private applyFace(): void {
    const raw = this.getAttribute('face')
    if (raw === null) {
      this.faceSpec = undefined
      return
    }
    let value: unknown
    try {
      value = JSON.parse(raw)
    } catch {
      // A malformed attribute leaves the current face alone rather than
      // throwing inside a lifecycle callback, where nothing can catch it.
      return
    }
    const result = parseFaceSpec(value)
    if (result.ok) this.faceSpec = result.face
  }

  private applyEmotion(): void {
    const wanted = this.getAttribute('emotion')
    // Absent, or a word this engine does not have, both mean neutral. Leaving
    // the previous emotion running would make `removeAttribute` do nothing.
    this.avatar?.setEmotion({
      emotion: isEmotion(wanted) ? wanted : 'neutral',
      intensity: isEmotion(wanted) ? 1 : 0,
    })
  }

  private applySize(): void {
    this.avatar?.setSizePercent(sizeFrom(this.getAttribute('size')))
    this.fitToElement()
  }

  private fitToElement(): void {
    const canvas = this.canvas
    if (canvas === null || this.avatar === null) return
    const rect = this.getBoundingClientRect()
    if (rect.width === 0 || rect.height === 0) return
    const ratio = window.devicePixelRatio || 1

    /*
      The BACKING STORE, not only the geometry.

      `resize` tells the avatar how big she is in CSS pixels; nothing in the
      engine touches `canvas.width`, because the engine does not own the canvas.
      Without these two lines the bitmap stays at its 300x150 default forever —
      a 200x200 element at ratio 2 asked for 400x400 and got a 300x150 buffer,
      so she was drawn clipped and then stretched by the browser to fit.

      Assigned only on change: writing `canvas.width` clears the canvas and
      resets the context state even when the value is identical, which would
      throw away the frame on every single resize callback.
    */
    const width = Math.max(1, Math.round(rect.width * ratio))
    const height = Math.max(1, Math.round(rect.height * ratio))
    if (canvas.width !== width) canvas.width = width
    if (canvas.height !== height) canvas.height = height

    this.avatar.resize(rect.width, rect.height, ratio)
  }
}
