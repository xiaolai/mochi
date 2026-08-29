# The three families, self-hosted

Literata, Sora and DM Mono, as `tokens.css` names them — the delivered design's
three faces, one per job. Literata sets anything you read, Sora anything you
operate, DM Mono anything machine-shaped.

They replaced Archivo, Archivo Narrow and IBM Plex Mono, which had no serif at
all: that palette gave prose and controls the same face and the difference
between reading and operating had to be carried by size alone.

## Why they are in the repository rather than fetched

The handoff loads them from `fonts.googleapis.com`, and this is a desktop
application that opens a window before it has any network. `@font-face` pointing
at `fonts.gstatic.com` fails in exactly that case — silently, falling back to the
system font, which is the outcome the whole design system exists to prevent. It
would also tell Google when this app was opened, every launch, which is not a
thing a companion that keeps a private note about somebody should do.

## What is here, and what is not

**Latin and Latin-Extended only.** The token file names the CJK fallbacks
explicitly — `PingFang SC`, `Hiragino Sans`, `Songti SC`, `Sarasa Mono SC` — and
those come from the operating system. A character called せんせい has to render on
the first launch, and bundling a CJK face would be tens of megabytes to replace
what macOS already ships.

Literata and Sora are **variable**: one file per subset covers the whole weight
axis. Literata's is the build carrying the **optical-size axis** as well
(`opsz 7..72`), which is why it is 110 KB where the weight-only build is 52 — it
is the face that has to work at both 46px and 13px, and optical sizing is what
makes that one face rather than two. DM Mono is static, so it has one file per
weight.

304 KB for all eight, against 156 KB for the three it replaced.

## Licence

All three are SIL Open Font License 1.1, which permits bundling in an
application. The full texts are beside this file and are the licence as
published by each project, not a summary of it:

| Family   | Copyright                         | Licence            | Source                                    |
| -------- | --------------------------------- | ------------------ | ----------------------------------------- |
| Literata | 2017 The Literata Project Authors | `Literata-OFL.txt` | <https://github.com/googlefonts/literata> |
| Sora     | 2019 The Sora Project Authors     | `Sora-OFL.txt`     | <https://github.com/sora-xor/sora-font>   |
| DM Mono  | 2020 The DM Mono Project Authors  | `DM-Mono-OFL.txt`  | <https://github.com/googlefonts/dm-mono>  |

Nothing here modifies them — the files are the subsets Google Fonts serves,
unaltered, which is also why they should be re-fetched rather than edited. None
of the three carries a Reserved Font Name, so the OFL's one hard clause does not
bite; it did for IBM Plex, and that is worth remembering if a fourth is ever
added.
