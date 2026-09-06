# Brand, Character, and Trademark

[`LICENSE.md`](LICENSE.md) splits this package in two. **Part 1 is MIT and covers
the engine** — the geometry, the physics, the format, the renderers. **Part 2
covers the character**, and it is not MIT.

This file is the reasoning behind that split. `LICENSE.md` is the operative
document; where the two differ, `LICENSE.md` governs.

This is the same split used by Rust, Kubernetes, Mozilla, and Docker: the code
is free, the identity is not.

---

## 1. What is reserved

**The Mochi character.** A soft green ovoid companion with a face, defined by
the parameter set `MOCHI` in `src/shared/avatar-spec.ts` and rendered by the
geometry in `src/renderer/companion/rig/`. The character comprises, without
limitation:

- the silhouette — an ovoid whose widest point sits at 0.295 of its height,
  formed from superellipse exponents 1.86 above the waist and 2.58 below;
- the two-tone flat shading, the lit copy displaced up and to the right,
  leaving an uncovered band along the lower-left edge;
- the palette `#8ec8a8` body, `#7dbd99` shadow, `#24463a` ink, `#ef8f86` cheek;
- the facial layout — paired round eyes at 0.3 of half-width and 0.46 of
  height, a lower-arc mouth at 0.24, radial cheeks at 0.62 / 0.33;
- the eight named expressions and the deformation values that produce them;
- the area-preserving squash, the height-proportional lean, and the breathing
  cycle that together give the character its motion identity;
- any work derived from, or substantially similar to, the above.

**The artwork.** `src/characters/__fixtures__/mochi-icon.png`, and every
rendering of the character produced by this software.

**The name and marks.** "Mochi" as the name of this application, the character
name, and the icon as used to identify the software or the character.

Copyright © 2026 HANDO K.K. All rights reserved. Not licensed under the MIT
licence, and not placed in the public domain.

## 2. What you may do without asking

- Use, modify, and redistribute the **engine** under the MIT licence, including
  in commercial work.
- Display and animate **Mochi herself** in your own projects, including ones you
  sell. She is not a paid asset and there is no non-commercial restriction.
- Design **your own** avatar as a `FaceSpec` JSON file, using the plugin format
  documented in `src/shared/avatar-spec.ts`. Your parameter values are yours.
  The format, the renderer, and the built-in `MOCHI` values are not.
- Refer to the project by name in prose — reviews, articles, tutorials,
  comparisons, and "works with Mochi" statements. Nominative use is fine and
  needs no permission.

## 3. What requires written permission

- Presenting the character under another name, or as a character of your own.
- Selling her _as_ the goods — asset packs, sticker sets, merchandise.
- Using the character or the name as the primary identity of a product or
  organisation.
- Using the character or the marks on merchandise, in a logo, or in any way
  suggesting affiliation, sponsorship, or endorsement.
- Registering the character, the name, or any confusingly similar mark as a
  trademark in any jurisdiction, or as a copyright in any registry.
- Training a generative model for the purpose of reproducing the character.

**If you want a character of your own, change the numbers.** The format exists
precisely so that costs a JSON file rather than a fork: start from `PLAIN`, and
what comes out is yours, with nothing here constraining it.

## 4. Attribution

Where attribution is required by the MIT licence, use:

> Mochi © 2026 HANDO K.K. — https://github.com/xiaolai/mochi

## 5. Contact

Requests for permission: https://github.com/xiaolai/mochi/issues

---

_This document states the licensor's position. It is not legal advice, and it
does not enlarge or reduce any right either party has under applicable law._
