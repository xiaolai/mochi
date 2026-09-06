# @hando/dough

A soft-body companion character engine. Zero dependencies.

The shape is a superellipse ovoid with **independent exponents above and below its
widest point**, so it can be a squat cushion or a teardrop from the same four
numbers. It squashes area-preservingly, leans by a shear pinned at its contact
point, breathes on a one-sided curve and settles on a second-order spring. A face
rides on it at a configurable _grip_, so it deforms with the body without looking
printed on.

A face is **data**, not code — see `FaceSpec`. A design is a JSON file.

## Install

```sh
npm install @hando/dough
```

## Use it from a plain HTML page

```html
<script type="module">
  import '@hando/dough/element'
</script>

<dough-avatar emotion="happy" style="width: 200px; height: 200px"></dough-avatar>
```

That is the whole integration. The element makes its own canvas, sizes it at
device resolution, runs the frame loop, and stops when it leaves the document.

## Use it against a canvas

```js
import { DoughAvatar, PLAIN } from '@hando/dough'

const avatar = new DoughAvatar(canvas.getContext('2d'), {
  face: { ...PLAIN, colBody: '#c88e9d', waist: 0.32 },
  size: 'fit-canvas',
})
avatar.resize(300, 300, devicePixelRatio)
avatar.setEmotion({ emotion: 'happy', intensity: 1 })

const tick = (now) => {
  avatar.render(now)
  requestAnimationFrame(tick)
}
requestAnimationFrame(tick)
```

## Use just the geometry

`core` is pure arithmetic — it returns points and numbers and imports no canvas,
no document, and no platform. Useful for hit-testing, physics, or your own
renderer.

```js
import { domeOutline, squashed, widthAt } from '@hando/dough'

const shape = {
  halfWidth: 50,
  height: 78,
  waist: 0.3,
  upperShoulder: 1.9,
  lowerShoulder: 2.6,
  lean: 0,
}
const points = domeOutline(shape) // the closed outline
const half = widthAt(shape, 0.5) // half-width at half height, 0..1
const flatter = squashed(shape, 0.2) // area-preserving
```

## Where it runs

Anywhere there is a 2D context or nowhere at all:

| Target    | How                                |
| --------- | ---------------------------------- |
| Browser   | `canvas.getContext('2d')`          |
| Worker    | `OffscreenCanvas`                  |
| Node      | `@napi-rs/canvas` or `node-canvas` |
| Electron  | either process                     |
| No canvas | `core` only, or the SVG emitter    |

`CanvasRenderingContext2D` is used structurally, so no adapter is needed.

## Entry points

| Import                 | Contains                           |
| ---------------------- | ---------------------------------- |
| `@hando/dough`         | core + canvas2d + svg              |
| `@hando/dough/element` | `<dough-avatar>`, self-registering |
| `@hando/dough/core/*`  | individual pure modules            |

## The default face

`PLAIN` is deliberately plain: a near-symmetric egg, one flat tone, no blush. It
exists so the engine renders something out of the box, and it is meant to be
replaced. The character this engine was extracted from is **not** included — see
`BRAND.md` in the parent repository.

## Licence

MIT.
