# Brand, Character, and Trademark

The MIT licence in [`LICENSE`](LICENSE) covers the **source code** of this
project. It does not grant any right in the **Mochi character**, the name
"Mochi" as used to identify this software, or the marks and artwork listed
below. Those are reserved.

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

**The artwork.** `src/renderer/companion/rig/__fixtures__/mochi-icon.png`, all
files under `resources/icons/` and `resources/tray/`, and every rendering of
the character produced by this software.

**The name and marks.** "Mochi" as the name of this application, the character
name, and the icon as used to identify the software or the character.

Copyright © 2026 HANDO K.K. All rights reserved. Not licensed under the MIT
licence, and not placed in the public domain.

## 2. What you may do without asking

- Use, modify, and redistribute the **source code** under the MIT licence.
- Run the software and use the character as the application presents it.
- Design **your own** avatar as a `FaceSpec` JSON file, using the plugin format
  documented in `src/shared/avatar-spec.ts`. Your parameter values are yours.
  The format, the renderer, and the built-in `MOCHI` values are not.
- Refer to the project by name in prose — reviews, articles, tutorials,
  comparisons, and "works with Mochi" statements. Nominative use is fine and
  needs no permission.

## 3. What requires written permission

- Redistributing a fork, product, or service that uses the Mochi character or
  the name "Mochi" as its own identity or branding.
- Using the character or the marks on merchandise, in a logo, or in any way
  suggesting affiliation, sponsorship, or endorsement.
- Registering the character, the name, or any confusingly similar mark as a
  trademark in any jurisdiction, or as a copyright in any registry.
- Training a generative model for the purpose of reproducing the character.

**If you fork the code, change the avatar.** The format exists precisely so
that you can: ship your own `FaceSpec` and your own name, and nothing here
constrains you.

## 4. Attribution

Where attribution is required by the MIT licence, use:

> Based on Mochi (https://github.com/xiaolai/mochi), © 2026 HANDO K.K.
> Used under the MIT licence. The Mochi character and name are not included.

## 5. Contact

Requests for permission: https://github.com/xiaolai/mochi/issues

---

_This document states the licensor's position. It is not legal advice, and it
does not enlarge or reduce any right either party has under applicable law._
