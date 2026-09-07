# Licence

This package is under **two** licences, split by directory. The engine is MIT.
The character is not.

| Path                                                         | Licence                              |
| ------------------------------------------------------------ | ------------------------------------ |
| everything except `src/characters/` (and `dist/characters/`) | MIT — Part 1                         |
| `src/characters/` and `dist/characters/`                     | The Mochi Character Licence — Part 2 |

The split exists because the two things are genuinely different. The engine is a
way of drawing soft-bodied characters and belongs to anyone who wants it. Mochi
is one specific character, and she is not a free asset.

**If you want a character of your own, the engine is all you need.** Start from
`PLAIN` — which lives in `src/core/` and is MIT — move the numbers, and what
comes out owes nothing to Part 2.

One caveat, stated rather than buried: an avatar constructed without a face
defaults to Mochi, so that is the single place Part 1 code names something from
Part 2. Taking the engine alone means passing a face, which anyone building
their own character does on the first line anyway.

---

## Part 1 — MIT License (the engine)

Applies to every file in this package **except** those under `src/characters/`
and `dist/characters/`.

Copyright (c) 2026 HANDO K.K.

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

---

## Part 2 — The Mochi Character Licence

Applies to `src/characters/` and `dist/characters/`: the `MOCHI` parameter set,
the colourways, and the reference artwork. Together these are the **Character**.

Copyright © 2026 HANDO K.K. All rights reserved.

### You may, without asking

- **Use her.** Display and animate the Character in your own work — a website, an
  app, a game, a school project, a video — including work you sell.
- **Recolour her** using the colourways in this package, or your own.
- **Redistribute this package** unmodified, including as a dependency.
- **Name her.** Say your project uses Mochi. Nominative reference needs no
  permission.

There is no fee, no registration, and no requirement to be non-commercial.

### You may not, without written permission

- **Rename her.** Presenting the Character under another name, or as a character
  of your own creation, is the one thing this licence exists to prevent.
- **Sell her as the goods.** She may appear in what you sell; she may not _be_
  what you sell — no asset packs, sticker sets, merchandise, or NFTs.
- **Make her your brand.** Using the Character as the primary identity of a
  product or organisation, or in a way suggesting affiliation with or
  endorsement by HANDO K.K.
- **Register her.** As a trademark, design right, or copyright, in any
  jurisdiction.
- **Train on her** for the purpose of generating her, or characters
  substantially similar to her.

### Attribution

Not required, but appreciated:

> Mochi © 2026 HANDO K.K. — https://github.com/xiaolai/mochi

### Modifications

You may change her parameters for your own use. If the result is still
recognisably Mochi, this licence still applies to it. If it is a different
creature, it is yours and this licence has nothing to say about it — which is
the intended outcome, and why the format is data rather than code.

### No warranty

The Character is provided "as is", without warranty of any kind.

### Asking

Permission for anything above: https://github.com/xiaolai/mochi/issues

---

_Part 2 states the licensor's position. It is not legal advice, and it does not
enlarge or reduce any right either party has under applicable law. Nothing in
Part 2 restricts any right granted by Part 1 over the engine._
