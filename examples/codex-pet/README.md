# Mochi as a Codex CLI pet

<img src="https://raw.githubusercontent.com/xiaolai/mochi/main/examples/codex-pet/preview-idle.webp" width="120" align="right" alt="Mochi idling in the pet sprite sheet">

A worked example of using `mochi-avatar` for something it was not built for:
exporting a **sprite atlas**. No canvas on screen, no frame loop, no clock —
just "give me this pose at this instant, as pixels".

Codex CLI pets are a fixed grid: 192×208 cells, one row per animation state,
plus sixteen look directions. This renders all 74 frames from `MOCHI` and
assembles them into `spritesheet.webp`.

```sh
node render.mjs      # 74 frames into build/raw/, plus a manifest
python3 assemble.py  # downsample, atlas, verify invariants
```

## Installing

Codex CLI keeps its pets in `~/.codex/pets/<id>/`, one directory per pet, and
reads two files from it: `pet.json` and whatever `spritesheetPath` names.
Nothing else in the directory is used, so keep backups somewhere else — a stray
file in a pet folder is a scan waiting to trip over it.

```sh
mkdir -p ~/.codex/pets/mochi
cp pet.json spritesheet.webp ~/.codex/pets/mochi/
```

Both are committed here, so installing needs no build. To rebuild them you need
`@napi-rs/canvas` (a dev dependency of this repo) and Python with Pillow.

**Updating an existing install** is a copy of `spritesheet.webp` — `pet.json`
has not changed. If your pet was built before the engine was extracted into this
package, exactly one frame is stale: `waving` frame 2, whose crescent eye the
old code flattened.

## What it demonstrates

**Rendering without the clock.** `DoughAvatar` owns time — it runs the idle
layer, schedules its own blinks, decides how far through a breath it is. That is
right on a desktop and wrong for an exporter, which has to say "frame 3 of 6,
eyes 70% shut". So this composes frames from `domeOutline`, `placeFeature` and
the three paint functions instead. They are pure, so it works.

**A character with no limbs answering a format that assumes them.** The atlas
asks for rows called `running` and `jumping`. Mochi has nothing to run with, so
those rows are facial responses rather than literal actions. Giving her limbs
would have made her a different character; the format bends instead.

**One silhouette, sixteen directions.** The look poses move only the eyes and
mouth — the body is identical in all sixteen, and `assemble.py` asserts it by
comparing alpha channels. There is one view of her and no second one to turn to.

## The gap it exposes

`draw()` reimplements the body compositing — the clip, the shadow fill, the lit
copy displaced up and to the right. That is a copy of what `DoughAvatar.paint`
does internally, and it is the one part of this example that can drift from the
engine. It is about six lines, but a package that expects people to write
exporters should probably expose it.

If you are writing one of your own, that is the part to watch.

## Provenance

Written by OpenAI Codex against this repository when it was still a desktop
application, and adapted here to import the published package rather than load
source files through a Vite dev server. The pose table is unchanged.

**No generated artwork is involved.** Every pixel comes from `domeOutline` and
the `MOCHI` constants — this is a rendering of the character, not an imitation
of her. That distinction is why it belongs in this repository at all.

When the exporter was re-pointed at the published package, **73 of its 74 frames
came out pixel-identical** to the atlas Codex originally produced against the
pre-extraction source tree. The single exception is `waving` frame 2, the only
frame in the atlas with a negative `eyeLower` — the crescent eye, which the
engine [used to
flatten](https://github.com/xiaolai/mochi/commit/115b899) because a floor was
being applied to a signed value. That one frame is the bug fix, and nothing else
moved.

## Licence

The exporter is MIT with the rest of the engine. The rendered frames are Mochi,
and carry the character licence in [`LICENSE.md`](../../LICENSE.md): use her,
don't rename her.
