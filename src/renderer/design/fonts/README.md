# The three families, self-hosted

Archivo, Archivo Narrow and IBM Plex Mono, as `tokens.css` names them.

## Why they are in the repository rather than fetched

The handoff says it plainly: _"self-host them if the app must look identical
offline."_ This is a desktop application that opens a window before it has any
network at all, and `@font-face` pointing at `fonts.gstatic.com` fails in
exactly that case — silently, falling back to the system font, which is the
outcome the whole design system exists to prevent. It also means every launch
tells Google when this app was opened, which is not a thing a companion that
keeps a private note about somebody should do.

## What is here, and what is not

**Latin and Latin-Extended only.** The token file names the CJK fallbacks
explicitly — `PingFang SC`, `Hiragino Sans`, `Sarasa Mono SC` — and those come
from the operating system. Bundling a CJK face would be tens of megabytes to
replace something macOS already ships.

Archivo and Archivo Narrow are **variable**: one file per subset covers the
whole weight axis, which is why there are two files rather than eight. IBM Plex
Mono is static, so it has one per weight.

156 KB for all eight.

## Licence

Both are SIL Open Font License 1.1, which permits bundling in an application.
The full texts are beside this file and are the licence as published by each
project, not a summary of it:

| Family                  | Copyright                                 | Licence            | Source                                    |
| ----------------------- | ----------------------------------------- | ------------------ | ----------------------------------------- |
| Archivo, Archivo Narrow | 2020 The Archivo Project Authors          | `Archivo-OFL.txt`  | <https://github.com/Omnibus-Type/Archivo> |
| IBM Plex Mono           | 2017 IBM Corp., Reserved Font Name "Plex" | `IBM-Plex-OFL.txt` | <https://github.com/IBM/plex>             |

The OFL's one hard rule is the Reserved Font Name: a MODIFIED IBM Plex may not
be distributed under the name "Plex". Nothing here modifies them — the files are
the subsets Google Fonts serves, unaltered — so that clause is satisfied by not
touching them, which is also why they should be re-fetched rather than edited.
