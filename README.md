<p align="center">
  <img src="https://raw.githubusercontent.com/xiaolai/mochi/main/assets/mochi-alive.png" width="220" alt="Mochi, breathing and occasionally blinking — a soft green ovoid with two round eyes and a small quiet mouth">
</p>

<h1 align="center">Mochi</h1>

<p align="center">
  A soft-body companion character, and the engine that draws her.
</p>

---

She is an ovoid whose widest point sits at 0.295 of her height, formed from
superellipse exponents 1.86 above the waist and 2.58 below. She squashes without
changing area, leans by a shear pinned at the point where she meets the surface,
breathes on a one-sided curve and settles on an underdamped spring. Her face
rides on her at a grip of 0.82 — following the body without looking printed on.

Every image in this file was rendered by the package itself, from `MOCHI`. There
is no second drawing of her anywhere in this repository for the code to drift
away from.

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

## She is alive before you tell her anything

That image is not a loop somebody animated. It is the engine, running, with no
input at all — because an idle character who holds perfectly still reads as a
crashed one. She is breathing, and blinking about once every seven seconds —
which is her own schedule, not a decision made in the picture. What is turned
off there is the sway: `setDrift(false)`, because a still on a page should hold
its frame.

|            |                                                                                                                                                                                                                                          |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Breath** | 3400ms, one-sided. Two half raised-cosines meeting at zero slope, 1:1.5 in to out — inspiration is muscular, expiration is elastic recoil. It only ever spreads her; her resting silhouette is a floor she returns to, never a midpoint. |
| **Blink**  | 130ms, 35% closing and 65% opening, because a real lid shuts faster than it opens. Gaps come from a clamped exponential — blinking is a Poisson process, and a uniform gap reads as a metronome within about thirty seconds.             |
| **Drift**  | Three mutually incommensurate sines per channel, so the pattern never visibly repeats. About 2.6px of sway on a 94px body: somebody shifting their weight, not somebody pacing.                                                          |

All of it is a pure function of the clock — no timers, no random walk, no state
that a throttled tab can desynchronise. Ask it where she is at time _t_ and it
answers.

## Making her do things

```js
avatar.setEmotion({ emotion: 'happy', intensity: 1 })
avatar.playMotion('hop') // nod · sway · hop · swing · turn · wander
avatar.lookAt(0.4, -0.2) // she follows a point; the far side wraps out of sight
avatar.poke() // squash, then settle on the spring
avatar.setAsleep(true) // she keeps breathing; stopping entirely reads as a crash
```

### Speaking

```js
avatar.setSpeaking(true)
avatar.setMouthOpen(0.8) // drive this from your audio, per frame
avatar.setSpeaking(false)
```

`EnvelopeMouth` in `core/mouth` will do the driving for you from an audio
envelope — `advanceEnvelope` turns a `Float32Array` of samples into a mouth
opening with attack and release, so speech does not chatter on every zero
crossing.

Two honest limits: `setVisemes` exists on the backend interface but this rig
does not implement it — the mouth is one lens with an opening, not a phoneme
shape, and `caps.visemes` says so rather than pretending. And the custom element
wires `emotion`, `size` and `face` only; anything above needs the JS object.

### Accessibility

```js
avatar.setReducedMotion(true) // stops the idle motion, keeps one-shot replies
avatar.setDrift(false) // stops only the sway; she goes on breathing
```

`setReducedMotion` is the accessibility preference, and it stops the breath
along with everything else. `setDrift` is the weaker, orthogonal one: use it
when she has to hold a fixed frame but should still look alive — which is
exactly what the image at the top of this page is doing. A companion who
answers nothing is a picture, not a quieter companion — the preference asks for
less movement, not for no feedback.

### Expressions

<img src="https://raw.githubusercontent.com/xiaolai/mochi/main/assets/expressions.png" width="100%" alt="Mochi in eight expressions: neutral, happy, shy, sad, angry, surprised, thinking, sleepy">

<p align="center"><sub>
neutral · happy · shy · sad · angry · surprised · thinking · sleepy
</sub></p>

Each is a set of multipliers on the neutral geometry rather than separate
artwork, so one silhouette carries all eight. Sleepy has no mouth on purpose —
a mouth left on a sleeping face reads as awake-but-quiet.

### Colourways

<img src="https://raw.githubusercontent.com/xiaolai/mochi/main/assets/colourways.png" width="100%" alt="Mochi in six colourways: matcha, sakura, kinako, yuzu, ramune, budo">

<p align="center"><sub>
matcha · sakura · kinako · yuzu · ramune · budo
</sub></p>

```js
import { mochiIn, MOCHI } from 'mochi-avatar'
const sakura = mochiIn('sakura', MOCHI)
```

One geometry throughout — five colour fields swapped, nothing else. Which is the
claim the picture is making: she is the shape, not the colour.

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
