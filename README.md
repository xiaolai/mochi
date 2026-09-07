# Mochi

<img src="https://raw.githubusercontent.com/xiaolai/mochi/main/src/characters/__fixtures__/mochi-icon.png" width="120" align="right" alt="Mochi">

A soft-body companion character, and the engine that draws her.

She is an ovoid whose widest point sits at 0.295 of her height, formed from
superellipse exponents 1.86 above the waist and 2.58 below. She squashes without
changing area, leans by a shear pinned at the point where she meets the surface,
breathes on a one-sided curve and settles on an underdamped spring. Her face
rides on her at a grip of 0.82 — following the body without looking printed on.

Zero runtime dependencies.

```sh
npm install mochi-avatar
```

## From a plain HTML page

```html
<script type="module">
  import 'mochi-avatar/element'
</script>

<dough-avatar emotion="happy" style="width: 200px; height: 200px"></dough-avatar>
```

That is the whole integration. The element makes its own canvas, sizes it at
device resolution, runs the frame loop, and stops when it leaves the document.

Attributes: `emotion` (one of the eight below), `size` (a percentage or
`fit-canvas`), `face` (a `FaceSpec` as JSON). Removing an attribute resets it.

## Against a canvas

```js
import { DoughAvatar, MOCHI } from 'mochi-avatar'

const avatar = new DoughAvatar(canvas.getContext('2d'), { face: MOCHI, size: 'fit-canvas' })
avatar.resize(300, 300, devicePixelRatio)
avatar.setEmotion({ emotion: 'happy', intensity: 1 })

const tick = (now) => {
  avatar.render(now)
  requestAnimationFrame(tick)
}
requestAnimationFrame(tick)
```

**Expressions** — `neutral` · `happy` · `shy` · `sad` · `angry` · `surprised` ·
`thinking` · `sleepy`. Each is a set of multipliers on the neutral geometry, not
separate artwork, so one silhouette carries all eight.

**Colourways** — `matcha` (the original) · `sakura` · `kinako` · `yuzu` ·
`ramune` · `budo`.

```js
import { mochiIn, MOCHI } from 'mochi-avatar'
const sakura = mochiIn('sakura', MOCHI)
```

## Just the geometry

`core` is pure arithmetic. It returns points and numbers, and imports no canvas,
no document and no platform — useful for hit-testing, your own renderer, or
working out where to put something.

```js
import { domeOutline, squashed, widthAt } from 'mochi-avatar'

const shape = {
  halfWidth: 50,
  height: 78,
  waist: 0.295,
  upperShoulder: 1.86,
  lowerShoulder: 2.58,
  lean: 0,
}
domeOutline(shape) // the closed outline, as points
widthAt(shape, 0.5) // half-width at half height, 0..1
squashed(shape, 0.2) // area-preserving
```

## Where it runs

| Target           | How                                |
| ---------------- | ---------------------------------- |
| Browser          | `canvas.getContext('2d')`          |
| Worker           | `OffscreenCanvas`                  |
| Node             | `@napi-rs/canvas` or `node-canvas` |
| No canvas at all | `core` only, or the SVG emitter    |

`CanvasRenderingContext2D` is used structurally, so no adapter is needed. The
conformance test has been rendering her under Node this whole time.

## Making your own character

A face is **data**, not code — see `FaceSpec`. A design is a JSON file, and the
format bounds every field so a bad one is refused with a reason instead of
rendering something wrong in a way nothing mentions.

```js
import { DoughAvatar, PLAIN } from 'mochi-avatar'
new DoughAvatar(ctx, { face: { ...PLAIN, waist: 0.5, colBody: '#c88e9d' }, size: 'fit-canvas' })
```

`PLAIN` is the default face and is deliberately plain — a near-symmetric egg,
one flat tone, no blush. It exists to be replaced.

## Licence

**Two licences, split by directory.** The engine is [MIT](LICENSE.md). Mochi
herself — `src/characters/` — is not: use her as she is, in anything including
what you sell, but don't rename her, sell her _as_ the goods, or make her your
brand. The full terms are short and in [LICENSE.md](LICENSE.md); the reasoning
is in [BRAND.md](BRAND.md).

If you want a character of your own, the engine is all you need.

## The desktop app has been retired

Mochi began as a realtime-voice AI companion that lived on your macOS desktop.
That app is no longer developed.

- **Downloads still work.** Every release remains available, including
  [v0.1.20](https://github.com/xiaolai/mochi/releases/tag/v0.1.20) with signed
  and notarized builds for Apple silicon and Intel.
- **The source is preserved** on the
  [`archive/app`](https://github.com/xiaolai/mochi/tree/archive/app) branch,
  exactly as it was at v0.1.20.
- **No further releases will be published here**, so installed copies will go on
  reporting themselves up to date rather than trying to update into a package.

The character outlived the application, which is the usual way round.
