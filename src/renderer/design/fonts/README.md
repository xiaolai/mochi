# The two families, self-hosted

Outfit and JetBrains Mono, as `tokens.css` names them — the v2 delivery's two
faces, one per job. Outfit sets anything you read or operate, layered by weight;
JetBrains Mono sets machine shapes only — times, counts, paths, keys, filenames.

They replaced Literata, Sora and DM Mono. **Three faces became two**, and that
is the point rather than a side effect: with three, "the same kind of thing in
two different faces" was a mistake anybody could make and nobody could see. With
two, prose and apparatus are the only distinction there is, so the mistake is
structurally impossible — either it is a machine shape or it is not.

Literata was a serif carrying everything you read. v2 gives that job to Outfit
at a lighter weight, which is why the window no longer reads as a printed page:
it is not one, and setting it like one was the piece of v1 that never agreed
with the rest.

## Why they are in the repository rather than fetched

The delivery loads them from `fonts.googleapis.com`, and this is a desktop
application that opens a window before it has any network. `@font-face` pointing
at `fonts.gstatic.com` fails in exactly that case — silently, falling back to the
system font, which is the outcome the whole design system exists to prevent. It
would also tell Google when this app was opened, every launch, which is not a
thing a companion that keeps a private note about somebody should do.

The About screen already promises this in as many words — "bundled rather than
fetched" — so the delivery agrees with itself here; only the artboards' own
`<link>` tags do not.

## What is here, and what is not

**Latin and Latin-Extended only.** The token file names the CJK fallbacks
explicitly — `PingFang SC`, `Hiragino Sans`, `Sarasa Mono SC` — and those come
from the operating system. A character called せんせい has to render on the first
launch, and bundling a CJK face would be tens of megabytes to replace what macOS
already ships. The About screen says this too.

Both families are **variable**: one file per subset covers the whole weight axis,
so four files cover both faces at every weight the design uses — Outfit 300–600,
JetBrains Mono 400–500.

**90 KB for all four, against 304 KB for the eight they replace.** The saving is
the two static DM Mono weights and Literata's optical-size axis, neither of which
has a job in a two-face system.

## Licence

Both are SIL Open Font License 1.1, which permits bundling in an application. The
full texts are beside this file and are the licence as published by each project,
not a summary of it:

| Family         | Copyright                               | Licence                  | Source                                       |
| -------------- | --------------------------------------- | ------------------------ | -------------------------------------------- |
| Outfit         | 2021 The Outfit Project Authors         | `Outfit-OFL.txt`         | <https://github.com/Outfitio/Outfit-Fonts>   |
| JetBrains Mono | 2020 The JetBrains Mono Project Authors | `JetBrains-Mono-OFL.txt` | <https://github.com/JetBrains/JetBrainsMono> |

Nothing here modifies them — the files are the subsets Google Fonts serves,
unaltered, which is also why they should be re-fetched rather than edited.

**Neither carries a Reserved Font Name**, checked in the licence texts rather
than assumed. That is the OFL's one hard clause and it did bite for IBM Plex, so
it is worth checking rather than remembering — and worth checking again if a
third family is ever added.
