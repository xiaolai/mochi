---
max_pure_loc: 350
overrides:
  'src/main/index.ts': 1500
  'src/renderer/history/main.ts': 1050
  'src/renderer/companion/face.ts': 600
---

# loc-guardian — mochi

Electron 43 + TypeScript 7, three processes (`main`, `preload`, `renderer`),
no UI framework — the renderer builds DOM through an `element()` helper.

> **Note on `overrides`:** loc-guardian 0.1.5 does not read this field yet; it
> applies `max_pure_loc` to every file. The three entries are recorded here
> because the reasoning below is the part worth keeping, and because a limit
> that is knowingly wrong about three files should say so in the file that sets
> it rather than in somebody's memory. See the plugin's
> `dev-docs/2026-08-24-improvements.md`, finding 7.

## Why 350, and why PURE lines

This codebase is **58% comments and blanks** by design: `AGENTS.md` requires
comments explain _why_ a path was chosen, what was rejected, and what breaks
otherwise. Raw line counts are therefore meaningless here — `shared/ipc.ts` is
708 raw lines and 284 lines of code.

Measured 2026-08-24 across 149 TypeScript source files (15,671 pure / 37,357
raw), 350 flags exactly three:

| pure | file                             |
| ---- | -------------------------------- |
| 1488 | `src/main/index.ts`              |
| 1034 | `src/renderer/history/main.ts`   |
| 593  | `src/renderer/companion/face.ts` |

The next file down is **336**, and nothing sits between 336 and 593. That gap
is the argument for the number: every file this project considers healthy is at
or under 336, so 350 has no false positives today and roughly fifteen lines of
headroom above the largest healthy file. A lower limit would flag files that
need no action, and a gate that is usually wrong is a gate people learn to
ignore.

**Never shorten or delete a comment to get under the limit.** The limit is on
code. If a file is over, extract code; the comments travel with the code they
explain.

## The three exceptions, and why extraction does not fix them

Each was measured rather than assumed. All three are one thing, not several
things sharing a file — which is the case the limit cannot express.

### `src/main/index.ts` — 1488

The composition root. It holds **21 module-level mutable bindings** and wires 36
IPC channels to them, with every `ipcMain` registration at column 0 closing over
that state.

The measurement that settles it: the voice group — the largest contiguous block
of handlers — references **22 module-level bindings**, most of them heavily used
elsewhere (`companion` 52 times, `archive` 42, `problems` 37, `conversation`
35). Extracting it means a 22-entry dependency interface, roughly a third of it
setters because the handlers write that state. That is more lines than it
removes and harder to read than what it replaces.

`codex/ready.ts` came out of here in 2026-08 because it was genuinely
self-contained — its state was read twice outside the three functions that own
it. `flush` (24 lines, needs `conversation` and `shutDown`) and `bubble` (83
lines, needs `catalogue`, `companion`, `fitted`, `tray`) were examined and
rejected on the same test.

Getting this under 350 needs the live state moved into an object the handler
modules receive — a redesign of how every feature is written, not an extraction.
Note that **seven tests assert on this file's source text**, slicing it at a
named `ipcMain.handle(...)`; they would not catch a runtime mistake made during
that redesign.

### `src/renderer/history/main.ts` — 1034

A window controller. Of its 35 functions, **exactly three are pure** (`empty`,
`iconButton`, `facts`); the rest read the same module state — `conversations`,
`open`, `shelf`, `place`, `generation`, `showingCharacter`.

Splitting the render functions from that state produces import cycles, which
this file already forbids below. Extracting the 35 DOM handles into their own
module was tried and reverted: it moved 36 declarations out and added 36 import
lines back, for a net of **1034 → 1032**. That is the shape this document warns
against, and it did not even satisfy the number.

### `src/renderer/companion/face.ts` — 593

One render loop. `tick` is 339 lines capturing **34** closure variables;
`fitToContent` captures 10. The genuinely pure candidates — `bodyOf`,
`availableScreen`, `roomOnScreen` — total about 30 lines between them.

`padNeeded` (6 captures) is the one worthwhile extraction here, on rule 1
grounds rather than line-count grounds: it holds the horizontal-symmetry rule
that was once wrong by 12px, and no test can reach it while it lives inside a
closure in a module that resolves a palette off `document` at load.

## Extraction rules

Applied in this order. Each has a precedent in this repository — these are not
generic advice, they are what was actually done here.

### 1. Testability split — pure logic out of a module that cannot be imported

A module that touches `document`, `window` or `electron` **at load** cannot be
imported by a test. Any decision logic inside it is therefore untestable, and
untestable decision logic is where the expensive bugs live.

Extract the decision into a sibling module named after the question it answers,
and give it a test.

- `main/index.ts` → `main/voice/availability.ts` (can she speak, and how is it
  repaired?)
- `main/index.ts` → `main/codex/ready.ts` (is the CLI she delegates to usable?)
- `store/personas.ts` → `store/unfinished.ts` (what was half-done when we were
  last killed?)

Take the **state** with the logic, not just the functions. `ready.ts` exists
because the path and the last known status are only meaningful to the three
functions that interpret them.

### 2. One function per channel, per surface, per registration

A `registerXIpc()` that installs eight handlers hides the shape they share —
check the sender, validate, act, tell the window — so the two that skip a step
look like the six that do not. Name each after its channel; the registration
function should read as an index.

Not yet applied in `index.ts`: see the exception above for the measurement that
blocks it.

### 3. One builder per section, and the parent keeps only the order

A pane builder that also owns state, persistence and localisation is several
things. Split by **what it produces**, and leave the parent holding the order
the pieces appear in.

- `settings/panes.ts` (557) → seven `settings/pane/*.ts` and a **10-line**
  `panes.ts` that is the order and the argument for it
- `history/shelf.ts` (725) → eleven `history/sheet/*.ts` and a 131-line
  `shelf.ts`
- `store/transcripts.ts` (533) → `schema.ts` + `statements.ts` + `archive.ts`

When you do this, the shared vocabulary must go **below** the sections, not stay
beside them: `settings/pane.ts` and `history/sheet/row.ts` exist because
otherwise every section imports the file that imports it.

### 4. Lift nested closures that capture a collector

A closure capturing the error collector, the source object and a limits table at
once is a validator you cannot read without holding three things in your head.
Lift it to a named function that takes the collector explicitly.

- `parsePersona`'s inner `text` / `moment` → `readText(problems, source, …)`

### 5. Shared helper at the SECOND use, not the third

Two copies of the same helper is one defect wearing two hats. When the second
appears, extract it — and extract the _reason_, not just the code.

- `element()` was byte-identical in `settings/panes.ts` and `history/shelf.ts`,
  and **missing** in `history/main.ts`, which paid 41 bare `createElement` calls
  for the absence. Now `renderer/element.ts`.
- `stripControl` / `oneLine` → `shared/text.ts`

Put it in `shared/` only if more than one **process** needs it; otherwise keep it
beside its callers. `element()` touches `document`, so it stays in `renderer/`.

### 6. A cycle means the layer is missing, not that the split was wrong

Twice during the 2026-08 split, extracting along a correct seam produced two
modules importing each other. Both times the answer was a third module _below_
both, never a re-merge:

- `store/personas.ts` ↔ `store/unfinished.ts` → `store/persona-files.ts` holds
  where a package sits on disk, and imports nothing back.
- `store/transcripts.ts` ↔ `store/archive.ts` → `store/turn-row.ts` holds what a
  row IS and how one is decoded, because `toTurn` is read by both.

The types travel with the decoder. A decoder in one file and the shape it
decodes to in another is the same separation wearing a different hat.

## Tests that read source text

Thirty-two test files read source as text and assert on it, because the module
under test cannot be imported outside Electron. They are load-bearing —
`saving-switch.test.ts` says its assertion was "found by mutation, not by
review" — and they break whenever code moves.

**When one breaks because of a move, point it at the surface, not at a file.**
Naming a file is how the next split makes an assertion pass by moving the line
out of view rather than by keeping it true. `saving-switch.test.ts` and
`persona.test.ts` now walk `renderer/history/` rather than naming `shelf.ts`.

Two guards were found to be wrong in this direction during the same work:

- `store/wiring.test.ts` excluded a leading `.` so `obj.name()` would not read
  as a call to `name()` — and a spread's third dot is a dot, so `toTurn` was
  called three times and reported as having no caller at all.
- `stylesheets.test.ts` read one directory without descending, so ten live
  classes looked dead the moment their files moved one level down.

Both were fixed at the detector. A guard that can be wrong in this direction
hides real findings.

## What NOT to do when a file is over

- Do not split a file by line count. Split it along the seam the rules above
  name; if none applies, the file may genuinely be one thing — and three of them
  here are.
- Do not move code into a `utils.ts` or `helpers.ts`. Name the module after the
  question it answers.
- Do not split a module just to satisfy the number and leave the state behind —
  that produces two files that must be read together, which is worse than one.
- Do not move declarations that only one file uses. Moving 36 handles out and
  importing 36 names back is a net of two lines and one more file to open.
