---
plugin: grill
version: 1.2.3
date: 2026-08-26
target: /Users/joker/github/xiaolai/myprojects/mochi
style: Select All (Architecture Review, Hard-Nosed Critique, Multi-Perspective Panel, ADR, Paranoid Mode)
addons: scale stress, hidden costs, principle violations, strangler fig, success metrics, before-vs-after, assumptions audit, compact & optimize
agents: recon, architecture, error-handling, realtime-voice, capability-dispatch, untested-surface
---

# Grill report — mochi

## 0. Coverage and honesty about it

Eleven agent runs were attempted. **Six completed**; five parent agents died with
`API Error: Connection lost mid-response` after two attempts each, plus three
sub-agents.

| Area                           | Status      | Source                                                |
| ------------------------------ | ----------- | ----------------------------------------------------- |
| Recon                          | complete    | `recon`                                               |
| Architecture                   | complete    | `architecture` (retry)                                |
| Error handling & observability | complete    | `error-handling`                                      |
| Realtime voice / WebRTC        | complete    | sub-agent of `security`                               |
| Capability dispatch & ledger   | complete    | sub-agent of `security`                               |
| Untested surface & coverage    | complete    | sub-agent of `testing`                                |
| **Security synthesis**         | **MISSING** | parent died ×2                                        |
| **Edge-case matrix**           | **PARTIAL** | parent died ×2; dispatch sub-agent covered much of it |
| **CI/CD analysis**             | **MISSING** | testing parent died ×2 before reaching it             |

What this means for the reader: prompt-injection, preload-allowlist,
path-traversal and secrets analysis were **not** completed as a dedicated pass.
The dispatch and voice sub-agents covered a large part of that ground
incidentally, and their findings are included — but nobody audited the preload
allowlist or the credential path end to end. **Treat the security section as
partial.** A report with a silent hole is worse than a short one.

Three defects found during the run were fixed and committed before this report
was written (`9eb91eb`); they are listed in §2 as `[FIXED]` with their evidence
intact, because the pattern that produced them is the report's headline finding.

---

## 1. The headline finding: comments are load-bearing and ungated

This codebase's defining strength is that it writes down _why_. 55% of it is
comment. Decisions are argued in prose next to the code that implements them,
and that prose is genuinely excellent — it names the defect each choice
prevents, often with the date and the measurement.

**It is also the one artefact here with no gate.** Every other claim is checked:
types by two `tsc` projects, style by prettier, wiring by `wiring.test.ts`,
prompts by `no-hardcoded-prompts.test.ts`, registration by `index.test.ts`.
Comments are checked by nothing, and this audit found **ten** that assert
properties the code does not have.

| #   | The claim                                                                                           | The reality                                                                      | Where                          |
| --- | --------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- | ------------------------------ |
| 1   | `store/prompts.ts` cites `worn.ts` as precedent for refusing to write over an unreadable file       | `writeMerged` still does exactly that, across 9 callers                          | `store/worn.ts:130-152`        |
| 2   | `codex/auth.ts` says `credential.ts` "describes the failure by errno"                               | It does not; it interpolates `String(error)`                                     | `voice/credential.ts:98`       |
| 3   | `credential.ts` header says the two `auth.json` readers were deduplicated "once, for everyone"      | Two readers remain; the second is sync, unbounded, unchecked, on the main thread | `voice/credential.ts:88-99`    |
| 4   | `spawn.ts` describes a SIGKILL escalation that "survived a whole audit round"                       | The escalation does not exist in the code                                        | `ask-workspace/ask.ts:234-237` |
| 5   | `workspace.ts` says the guard walks ancestors "because Codex reads AGENTS.md upward"                | For any workspace outside `<userData>/workspace` it inspects the leaf only       | `store/worn.ts:328-330`        |
| 6   | `reconnect.ts` states an unusable expiry is "NEVER silently treated as never reconnect"             | Its only caller clears the timer and returns, scheduling nothing                 | `main/index.ts:1656-1661`      |
| 7   | `pending.ts` header claims the empty-cut-row regression was fixed                                   | Reachable from the other side, via a late truncation                             | `pending.ts:227-234`           |
| 8   | `ledger.ts`/`dispatch.ts` call `unanswered()`/`undelivered()` the things that "would notice" a hang | Neither has a production caller                                                  | `capability/ledger.ts:351-352` |
| 9   | `.claude/loc-guardian.local.md` says 32 test files read source as text                              | 18 (15 pure + 3 mixed)                                                           | config, written this session   |
| 10  | `.claude/loc-guardian.local.md` cites `AGENTS.md` as the source of the comment policy               | No `AGENTS.md` exists in the repo                                                | config                         |

Plus two the audit produced _during_ it, both in code merged the same day:

| #   | The claim                                                                                          | The reality                                                                                                                          |
| --- | -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| 11  | `look-up/capability.ts` — "Every KEY, always. Only the documents are cut."                         | The same commit pushed `LIMIT 25` into the SQL, so `keys` held 25 and `unread` was 0 for a collection of 40. **`[FIXED]` `9eb91eb`** |
| 12  | `.claude/loc-guardian.local.md` — "What is left is threading, which is what a composition root IS" | Three state clusters extract cleanly for 236 lines. See §3.5                                                                         |

**This is not a documentation problem.** Items 4, 5, 6 and 8 are each a _safety
mechanism the reader believes exists_. Somebody reading `spawn.ts` would not
add a SIGKILL escalation, because the comment says one is there.

**Recommendation.** Not "write fewer comments" — the density is an asset. Add a
`claims.test.ts` in the shape this repo already uses for `wiring` and
`registry`: a small table of `{ file, claim, assertion }` for the load-bearing
ones, so a comment asserting a guard has a test asserting the same guard. Start
with the eight in the table above that name a mechanism.

---

## 2. Findings by severity

### CRITICAL

**C1 — Revoking a capability reports success and does not take effect.**
`main/index.ts:2422` (write), `:1875` (read), `:1628-1637` (enforce)
The panel writes and reads `wornId()`; dispatch enforces against
`sessionPersona`. After a shelf switch these differ by design. Sequence: session
opens as A → user switches to B → panel renders **B's** switches → user turns off
"Read your workspace" → `writeGrant` writes **B's** file → `tellTheSession()`
rebuilds from **A**, whose grants are unchanged → returns `true` → panel says
`{ok:true}`, "in force now" → model calls `ask_workspace` → `withheld()` reads
**A's** grants → allowed → `codex exec` reads the workspace.
This is exactly what `shared/grants.ts:40-51` promises cannot happen.
_Effort: Small. Fix: one persona id for panel and dispatch, or block the panel
on a live session that is not the worn one._

**C2 — `session_expired` tears down nothing; the microphone stays live.**
`renderer/companion/audio/session.ts:435-438`
No `shutdown()`. Peer, data channel, tracks and `micTrack.enabled = true` all
survive. An SCTP abort does not necessarily move `connectionState` to `failed`,
so the listener at `:325-335` may never run either. The renderer paints "the
hour is up — reconnecting" while the macOS microphone indicator stays lit on a
dead connection, indefinitely.
_Effort: Trivial._

**C3 — One reconnect trigger; every pre-`session.created` failure is terminal.**
`main/index.ts:1654-1685`, `audio/session.ts:340-343`
`reconnectTimer` is armed only by a `VoiceReport{kind:'expiry'}`, which the
renderer emits only on `session.created`. `VoiceReport` has no failure kind, so
main is never told a session died. A failed mint at the moment the hourly timer
fires (captive portal, off-network) → no `session.created` → no new timer → **she
is silent until the user manually toggles rest.** Same for denied `getUserMedia`,
failed SDP exchange, `voice:config` rejecting.
_Effort: Small — an unconditional ~50-minute floor timer plus a
`powerMonitor.on('resume')` re-evaluation closes C3, plus voice findings 5, 6, 7._

**C4 — Concurrent opens share one `minted` slot.**
`main/index.ts:1411,1427,1436`
`voice:sdp` reads the module-global `minted`, not the caller's mint. On first
launch: `did-finish-load` → open A blocks on the mic permission prompt; user
sleeps/wakes → open B completes and overwrites `minted`; user grants the prompt
→ A's `voice:sdp` uses **key B**, consuming the single-use ephemeral key; B then
fails. Net: no session at all, and per C3 no retry. The comment on `:1410` says
this is held "so a second open replaces the first rather than racing it" — the
code makes the second mint win the first open's exchange.
_Effort: Medium._

### HIGH

**H1 — No last-resort handler in either process.**
Zero matches across `src/` for `uncaughtException`, `unhandledRejection`,
`window.onerror`. `problems.ts:4-8` opens with _"a packaged app has no console"_
— and the one sink that catches what per-site handling misses was never
installed.

**H2 — `voice:report` is the only unguarded IPC listener in main.**
`main/index.ts:1648-1760`. Calls `conversation()` (which **throws by design** at
`:1279` when the archive is closing) with no `try`. A throw out of an
`ipcMain.on` listener has nowhere to go; with H1, Node's default is print-and-exit.
The highest-frequency listener is the one that was missed.

**H3 — A failed conversation delete is completely silent.**
`renderer/history/main.ts:253,272-293`. `void deleteThem(...)` with no `try`; the
handler can reject above its own guard (`index.ts:2740,2749,2750`). The sheet
closes, nothing is deleted, nothing is said. Its two siblings (`write()`,
`writeMachine()`) both catch and `say()`.

**H4 — A deferred answer delivered across a reconnect is discarded, and the
ledger records success.** `capability/ledger.ts:252-268`
`emit` sends then unconditionally records `delivered`; `send` is
`webContents.send`, which succeeds as long as the window exists regardless of
which session is listening. With a 180-second ceiling against an hourly session
this is ~5% of lookups. `undelivered()` — the query built to catch exactly this
— reports nothing, because `emit` already moved the call to `delivered`.

**H5 — 180-second TOCTOU on the only deferred capability.**
`capability/dispatch.ts:209-213,267-269`; `ask-workspace/ask.ts:236`
`withheld` is checked once, then `codex exec` runs for up to 180s. Revoking
mid-flight is honoured for future calls only; the in-flight read completes and
its content reaches the model.

**H6 — SIGTERM with no escalation hangs the capability forever.**
`ask-workspace/ask.ts:234-237`. No SIGKILL. If Codex ignores SIGTERM,
`handle.finished` never resolves → scratch dir leaks, the call sits `deferred`
for the process lifetime, the bead spins forever, `volunteer()` never fires.

**H7 — The workspace guard does not walk ancestors for any user-chosen workspace.**
`store/worn.ts:328-330`. For a workspace outside `<userData>/workspace`,
`stopAt === workspace`, so `chain()` returns one directory. An `AGENTS.md` one
level up is loaded by Codex as instructions and is invisible to the guard.
`workspace.ts:10-20` claims the opposite.

**H8 — `set_expression` validates against the worn character while the wire enum
holds the live one's faces.** `what-she-may-do.ts:49-79` vs `main/index.ts:1362-1366`.
After a switch she is refused for a face that _is_ on her wire, and told to use
faces that are not.

**H9 — ICE/peer failure leaves the halo and menu-bar mic lit over a closed peer.**
`audio/session.ts:325-335`; `companion/main.ts:226`. `applyMicrophone()` is never
called on this path. Switch networks mid-conversation and the ring stays filled
and the tray keeps saying she can hear you, permanently.

**H10 — The barge-in cursor can belong to the _next_ response.**
`audio/session.ts:389-390` computes the truncated item's response and reads the
cursor, and never compares them. Produces an **empty cut row over speech that
was actually heard** — the §28 regression `pending.ts` claims to have fixed.

**H11 — `put()` silently drops every frame when the channel is not open.**
`audio/session.ts:315-317`. No return value. Drops a revoked-grant
`session.update` (while the panel says "in force now"), a tool answer mid-reconnect,
and the turn nudge.

**H12 — `audio_end_ms` is required with zero consumers.**
`realtime/frames.ts:280`. If the service renames or drops it, every
`conversation.item.truncated` parses as malformed → `pending.truncated` is never
called → items file as `whole`, a silent return of the +446%–513% over-filing
that §60 removed.

**H13 — `look_up` truncated keys at 25 while claiming otherwise.** `[FIXED] 9eb91eb`
See §1 item 11.

### MEDIUM (abridged — 24 findings)

`readTombstones` conflates unreadable with absent, so a crash-interrupted
deletion whose tombstone is unreadable is _never swept_ and the persona's data
survives deletion permanently (`store/unfinished.ts:91,103`) · "every permission
withheld" detected by reference identity, which a field-by-field parse defeats
(`index.ts:1534`) · retention silently switching to do-not-keep with console-only
notice (`store/policy.ts:104-116`) · the user's system prompt dropped to a console
(`store/prompt.ts:105-112`) · `recall` discards the distinction `recallState`
computed (`store/memory.ts:77-80`) · `writeMerged` overwrites a file it could not
read, across 9 callers (`store/worn.ts:130-152`) · duplicate `callId` dropped in
silence with no observer (`ledger.ts:296`) · wrong-typed args become a _false_
refusal, so she reports "nothing to keep" for a call that carried a value
(`shared/capability/args.ts:55-56`) · no size bound between data channel and
handler; two full regex passes over a multi-MB string on the main thread before
the cheap length check (`remember-this/capability.ts:80`) · child orphaned on app
quit with its scratch dir (`spawn.ts:29-34`) · unlimited concurrent lookups ·
`readFileSync` unbounded on the answer file (`ask.ts:249`) · "last used"
attributed to the wrong character (`store/usage.ts:25-30`) · three integrity
pragmas set with `db.exec`, whose result rows are discarded (`store/schema.ts:18,19,30`)
· two awaits outside the try break the result contract (`voice/credential.ts:178,182`)
· voice failure console-only in main (`index.ts:1418,1424,1440`) · the nudge
consumed on a refused `response.create` (`nudge.ts:78-86`) · a late truncation
resurrects a settled item (`pending.ts:227-234`) · every hourly reconnect
re-greets mid-conversation (`session.ts:280,482-491`) · `setTimeout` overflow
makes a units change an immediate reconnect loop (`reconnect.ts:66-83`) · private
control frames coerced without validation; `Number(undefined)` = NaN silently
disables the outstanding-lookup bead (`companion/main.ts:394,422,430,483`) ·
`keep` reported `room` as the constant cap `[FIXED]` · a renamed prompt key ships
`guidance: ''` silently across all three kept tools (`store/prompts.ts:88`) ·
`withheldGuidance` makes her assert the user turned off a switch that does not
exist (`shared/grants.ts:270-278`).

### LOW (abridged — 16 findings)

`close()` can re-arm a scrub timer after `db.close()` · `ROLLBACK` outside a try
· `shell.openPath` result discarded · `void audio?.close()` · absolute path of
`auth.json` in a user-visible `why` · `clearTombstone` swallows every errno, so
an unremovable tombstone re-runs deletion every launch forever · ledger map never
pruned · `shutdown()` reads a `const` declared 39 lines later · `pacer.wrote()` is
O(n²) per utterance · `pending` eviction drops a completed turn silently · blank-
rendering characters outside `Cf`/`Zs` (U+3164, U+2800) pass `looksEmpty` · the
one real import cycle in the repo, `prompts.ts` ↔ `prompts-kept.ts`, type-only ·
`workspace` read twice with a race between the reads · bare `pnpm build` does not
evaluate the capability registry.

### `[GOOD]` — verified, do not break

- **Layer boundaries hold, proven by full-graph SCC.** `shared/` → anything: **0
  edges**. Not one leak, not one `import type` cheat, across 57 files with no
  framework enforcing it.
- **`capability/dispatch.ts` in full.** Every path answers; observers quarantined
  behind `quietly()`; synchronous-throw-before-the-promise handled.
- **`ledger.emit` sends before recording**, so a throwing transport leaves the
  call visible rather than booked as answered.
- **`store/read-bounded.ts`** — four distinct outcomes, `lstat` not `stat`, and a
  header stating what it does _not_ promise.
- **The grants/policy triad** — absent/held/unusable carried end to end, with a
  named `'unreadable'` sentinel instead of `undefined`.
- **`capabilities/index.ts`** — `collect()` is a pure function over a module map;
  the empty-glob guard catches the green-but-did-nothing failure in four lines.
- **Zero-trust applied directionally**: 285 `: unknown` params, all 36 IPC
  handlers parse rather than cast; the preload's 30 casts are all on the
  main→renderer direction. Channel ledger reconciles exactly: 39 declared, 36
  registered, 1 in `ipc/forget-kept.ts`, 2 main→renderer pushes, zero orphans.
- **The four cycle-breaker modules are correctly shaped** — verified by testing
  whether inlining each would create a cycle. It would, in all four.
- **`face.ts` holds 444 lines of animation state with one module-level binding**,
  proving the codebase can seal a large stateful component.

---

## 3. Architecture review + rewrite plan

**3.1 Redesign decisions.** None wholesale. The three-process split, the
allowlisted IPC, the build-time capability registry and the directional trust
model are all sound and unusually well-executed. The work is corrective, not
structural.

**3.2 New architecture.** Unchanged, plus: a **session-generation tag** on
`call_id` (kills H4), a **supervisor** over the reconnect schedule (kills C3 and
three voice findings), and **one persona identity** shared by panel and dispatch
(kills C1 and the usage misattribution).

**3.3 Data model.** `kept`, `session`, `turn`, `turn_fts` are well-shaped. One
gap: schema migration is done by `PRAGMA table_info` introspection with **no
`user_version` ledger** (`store/schema.ts:100,119`). Robust against version-
skipping, but nothing records what version a file is.

**3.4 Reliability.** §2 C1–C4, H1–H12.

**3.5 The decomposition that actually pays.** Measured, and it corrects a claim
made in this repo's own config. Handler-splitting `index.ts` does **not** pay —
9 of 19 module bindings span essentially the whole file, so it relocates state
and makes the write set harder to audit. But three clusters are tightly local:

| cluster                   | bindings                                      | span  | code lines |
| ------------------------- | --------------------------------------------- | ----- | ---------- |
| companion geometry        | `herBody`, `herFeet`, `fitted`, `bubbleSides` | 1–332 | 177        |
| credential mint/reconnect | `minted`, `reconnectTimer`                    | 10    | 39         |
| idle-sleep timer          | `idleTimer`                                   | 12    | 20         |

`herFeet` has a reference span of **one line**. Extracting all three removes
**236 pure lines** (1,521 → ~1,285, real headroom under the _existing_ 1530
override) and 6 of 19 globals, at zero coupling cost. The config currently says
"what is left is threading"; that was measured only against handler groups.

**3.6 Security.** Partial — see §0.

**3.7 Testing.** §5.

**3.8 Performance.** `pacer.wrote()` O(n²); unbounded arg processing on the main
thread; `readFileSync` on the answer file.

**3.9 DX.** The comment culture is the best DX asset here and the gate in §1 is
the highest-leverage addition to it.

**3.10 Migration.** §7.

---

## 4. Hard-nosed critique + 15-item backlog

Ranked by impact ÷ (risk × effort).

| #   | Item                                                    | Impact   | Risk   | Effort  |
| --- | ------------------------------------------------------- | -------- | ------ | ------- |
| 1   | SIGKILL escalation in `ask.ts`                          | High     | None   | Trivial |
| 2   | `shutdown()` on `session_expired`                       | High     | None   | Trivial |
| 3   | One persona id for panel + dispatch (C1)                | Critical | Low    | Small   |
| 4   | `uncaughtException` / `unhandledRejection` handlers     | High     | None   | Small   |
| 5   | `try` around `voice:report`                             | High     | None   | Trivial |
| 6   | Unconditional reconnect floor + `powerMonitor` resume   | Critical | Low    | Small   |
| 7   | `catch` + `say()` on `deleteThem`                       | High     | None   | Trivial |
| 8   | Session-generation tag on `call_id`                     | High     | Medium | Medium  |
| 9   | `put()` returns a boolean; callers handle false         | High     | Low    | Small   |
| 10  | Compare `responseId` before reading the barge-in cursor | High     | Low    | Trivial |
| 11  | `readTombstones` distinguishes unreadable from absent   | Medium   | Low    | Small   |
| 12  | `writeMerged` refuses over an unreadable file           | Medium   | Low    | Trivial |
| 13  | Extract the three state clusters (§3.5)                 | Medium   | Low    | Medium  |
| 14  | `claims.test.ts` for load-bearing comments (§1)         | High     | None   | Medium  |
| 15  | Handler tests for `keep` / `forget_kept` (§5)           | Medium   | None   | Small   |

**Quick wins under a day:** 1, 2, 5, 7, 10, 12 — six findings, three of them
High or Critical, none carrying risk.

**Red flags.** (a) Silence is the default failure mode across the voice layer —
`put()` drops, unusable expiry drops, `MAX_HELD` drops, malformed truncation
drops, refused `response.create` drops; each individually defended, collectively
meaning the commonest failure is a thing that quietly did not happen while every
surface reads green. (b) Ten comments assert guards that do not exist.

---

## 5. Testing

Measured with `vitest run --coverage`:

| File                          | Stmts | Branch | Funcs |
| ----------------------------- | ----- | ------ | ----- |
| `keep/capability.ts`          | 7.14  | **0**  | **0** |
| `look-up/capability.ts`       | 8.33  | **0**  | **0** |
| `forget-kept/capability.ts`   | 10    | **0**  | **0** |
| `remember-this/capability.ts` | 100   | 94.4   | 100   |

The non-zero statement figures are the module-level object literal, evaluated by
the registry glob. **Not one handler line executed anywhere in the suite.**
`main/ipc/forget-kept.ts`, `capabilities/kind.ts` and all of
`renderer/history/sheet/` produce no coverage row at all.

**All three capabilities are importable in plain node vitest** — the closure is
14 files with zero bare specifiers. `look-up` now has 8 tests (`9eb91eb`); `keep`
and `forget-kept` remain untested. `recall-conversations/capability.test.ts`
copies verbatim as scaffolding. **Estimated one agent-hour for both.**

`kind.ts` correctly has no test: it emits zero runtime code, and its two failure
modes are already asserted via `@ts-expect-error` in `index.test.ts:173-205`.

`showFace` cannot be imported at all — `face.ts:232-233` touches
`document.documentElement` at module scope, and the suite runs
`environment: 'node'`. The repo has already extracted and tested every _decision_
out of it (`her-geometry`, `screen-room`, `pad-change`). What remains is
composition and drawing, and the right guard for that is running the app, not a
DOM emulator. **This report does not recommend testing `showFace`.**

Meta-guards that can pass vacuously: `stylesheets.test.ts` checks styled→created
but not created→styled, so unstyled markup ships green (confirmed this session:
three classes shipped with no CSS); `wiring.test.ts`'s caller regex missed spread
calls; `documents.test.ts` compares against a hand-curated id list. The 18
source-text tests break whenever code moves, and twice this session broke
_silently_ by asserting over an empty list.

**Not analysed:** CI/CD (agent died before reaching it). `verify.yml` runs on
macos-latest only, with no coverage threshold and no mutation testing.

---

## 6. Multi-perspective panel

- **Staff backend** — C1, H4, H5. One identity, one generation tag, one re-check.
- **Security** — H7 (ancestor `AGENTS.md`), H5 (revoke does not stop an in-flight
  read), C1. Also: the fence plus `kept.isData` is a mitigation, not a boundary;
  it cannot stop content that _is_ the answer being acted on.
- **SRE** — H1, H2, C3. No last-resort handler, one liveness timer, no supervisor.
  Everything else is a detail next to "the app can exit and nobody knows why".
- **Performance** — `pacer.wrote()` O(n²) inside `requestAnimationFrame`;
  unbounded arg regex on the main thread.
- **Product** — C1 first: a permission switch that reports success and does
  nothing is the worst defect in the report, because it damages the one thing the
  grant system exists to sell. Then C2 (mic lit on a dead session).
- **Junior-dev advocate** — §1. Ten comments describe guards that do not exist; a
  newcomer trusting them writes wrong code confidently.

**Unified plan.** Panel resolves cleanly: quick wins (1,2,5,7,10,12), then C1+C3
as the two structural fixes, then the §1 gate. Only disagreement is item 13's
priority — performance and product both rank it last; architecture ranks it
mid — resolved in favour of last, since it is quality-of-life and the others are
correctness.

---

## 7. ADRs

**ADR-1 — One persona identity for authorization.** _Context:_ panel and dispatch
read different ids (C1). _Decision:_ the live session's persona is authoritative
for enforcement; the panel refuses to present switches for a persona that is not
live, or states plainly that changes apply from her next wake. _Alternatives:_
make dispatch read `wornId()` — rejected, it would authorize a live session
against a character it is not. _Consequences:_ one honest sentence in the UI.
_Migration:_ none; no stored data changes.

**ADR-2 — A supervised reconnect.** _Context:_ C3, plus voice 5/6/7. _Decision:_
an unconditional floor timer (~50 min) plus `powerMonitor.on('resume')`
re-evaluation, independent of `session.created`. _Alternatives:_ add failure
kinds to `VoiceReport` — good, and complementary, but does not cover clock skew.
_Consequences:_ at most one redundant reconnect per hour.

**ADR-3 — Session-generation tags on `call_id`.** _Context:_ H4. _Decision:_ tag
each call with the session generation; `deliver` refuses a call from a previous
generation and reports it. _Consequences:_ `undelivered()` becomes truthful.

**ADR-4 — `put()` reports.** _Context:_ H11 and four dependent drops.
_Decision:_ return a boolean; callers decide. _Consequences:_ the grant path can
stop claiming "in force now" when the frame was dropped.

**ADR-5 — Comments that name a guard get a test.** _Context:_ §1. _Decision:_ a
`claims.test.ts` table. _Alternatives:_ prune the comments — rejected, the prose
is the asset. _Consequences:_ new load-bearing comments cost one table row.

**ADR-6 — Keep `showFace` untested; test its decisions.** _Context:_ §5.
_Decision:_ ratify current practice explicitly, so nobody adds jsdom for it.

**ADR-7 — `user_version` for the schema.** _Context:_ §3.3. _Decision:_ record a
schema version alongside the introspection.

**ADR-8 — The three state clusters leave `index.ts`.** _Context:_ §3.5.
_Decision:_ extract; revert the 1530 override to ~1300 afterwards.

---

## 8. Paranoid mode — edge-case risk matrix

| Scenario                                                        | Likelihood | Impact   | Risk         | Component     | File                 |
| --------------------------------------------------------------- | ---------- | -------- | ------------ | ------------- | -------------------- |
| Revoke reports success, capability keeps running                | High       | Critical | **Critical** | grants        | `index.ts:2422,1628` |
| Mic stays live on an expired session                            | High       | Critical | **Critical** | voice         | `session.ts:435`     |
| Failed mint at reconnect ⇒ permanently silent                   | Medium     | Critical | **Critical** | voice         | `index.ts:1654`      |
| Throw in `voice:report` exits the app                           | Medium     | Critical | **High**     | IPC           | `index.ts:1648`      |
| Deferred answer lost across reconnect (~5% of lookups)          | High       | High     | **High**     | ledger        | `ledger.ts:252`      |
| Codex ignores SIGTERM ⇒ hang for process life                   | Low        | High     | **High**     | ask-workspace | `ask.ts:234`         |
| Ancestor `AGENTS.md` unguarded                                  | Medium     | High     | **High**     | ask-workspace | `worn.ts:328`        |
| Unreadable tombstone ⇒ deleted persona's data survives for ever | Low        | Critical | **High**     | deletion      | `unfinished.ts:91`   |
| ICE failure ⇒ halo and tray lie about the mic                   | Medium     | Medium   | **Medium**   | voice         | `session.ts:325`     |
| Clock skew ⇒ silent outage, "reconnecting" on screen            | Medium     | High     | **Medium**   | reconnect     | `reconnect.ts:76`    |
| Clock ahead ≳1h ⇒ unbounded reconnect loop                      | Low        | High     | **Medium**   | reconnect     | `reconnect.ts:66`    |
| Empty cut row over speech actually heard                        | Medium     | Medium   | **Medium**   | pending       | `session.ts:389`     |
| Hand-removed persona folder ⇒ new character inherits 4 stores   | Low        | High     | **Medium**   | personas      | `personas.ts:510`    |
| `expires_at` in ms ⇒ immediate reconnect loop                   | Low        | High     | **Medium**   | reconnect     | `reconnect.ts:66`    |

---

## 9. Pressure tests

**Scale (100× traffic, 2× team).** Single-user desktop; traffic does not scale.
Team doubling breaks on §1 first — ten comments describing guards that do not
exist is a newcomer trap that scales linearly with headcount. Second: `index.ts`
at 1,521/1,530 and `history/main.ts` at 934/975 are both pinned at ceiling, so
the next two features each require an override negotiation.

**Hidden costs.** (1) Ten false comments — debugging cost paid by whoever trusts
one. (2) 55% comment density means every refactor is a prose edit too; this
session proved comments go stale faster than code. (3) `node:sqlite` is pre-stable
with no adapter seam — the escape hatch is a Node version bump, not a lockfile
entry. (4) 18 source-text tests break on every code move, twice silently. (5) The
zero-dependency policy costs ~650 lines of hand-written validation — cheaper than
it looks, and defensible.

**Principle violations.** _SRP:_ `index.ts` mixes composition with three
self-contained state machines (§3.5). _Dependency inversion:_ capabilities reach
past `CapabilityDeps` into `main/` internals — 9 direct imports; `remember-this`
takes `userData` through deps while importing `main/store/memory` directly.
_Least privilege:_ H5 and H7 — an in-flight read outlives its revoke, and the
guard covers one directory instead of the chain.

**Strangler fig.** Every item in §4 is independently shippable; no big-bang.
Order: quick wins → C1 → C3 → generation tags → claims gate → cluster extraction.

**Success metrics.** Sessions surviving an hour without manual intervention (C3);
% of deferred answers delivered to the session that requested them (H4, target
100%, current ~95%); count of `problems.note` calls per class of failure —
currently zero for retention, prompt-load, voice-failure and scrub-exhaustion;
branch coverage on `capabilities/*` (currently 0%, three files); comment claims
covered by `claims.test.ts`.

**Before vs after.**

```
BEFORE                                  AFTER
model ──tool──▶ dispatch                model ──tool──▶ dispatch
                 │ withheld(wornId?)                     │ withheld(sessionPersona)
                 ▼                                       ▼ + re-check at delivery
              handler ──▶ store                       handler ──▶ store
                 │                                       │
ledger ──emit──▶ webContents ─?─▶ any   ledger ──emit(gen)──▶ session[gen] or reported
reconnect: session.created ──▶ 1 timer  reconnect: floor timer ∥ resume ∥ session.created
```

**Assumptions audit.**

| Assumption                                           | How to validate quickly                                                                       |
| ---------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `-s read-only` cannot be overridden by a profile     | Already measured against codex-cli 0.148.0 — **re-measure per upgrade**; the pin is a comment |
| `secure_delete` / `foreign_keys` took effect         | `PRAGMA …` read-back at open — 3 lines (M9)                                                   |
| Fence + `kept.isData` stops stored-content injection | It does not; it reduces. Test with `</kept>` variants                                         |
| Comments describe live guards                        | §1 — ten did not                                                                              |
| The composition root is irreducible                  | §3.5 — 236 lines say otherwise                                                                |

**Compact & optimize.** `shared/ipc.ts` is 1,171 raw lines but **285 code** — judge
it as 285, not as a monolith. Real consolidation available: the two `auth.json`
readers (L7), the `prompts.ts` ↔ `prompts-kept.ts` cycle (one type move), and the
three state clusters (236 lines).

---

## 10. Executive summary

**Verdict.** This is a well-built codebase with an unusual amount of recorded
reasoning, verified-clean layer boundaries, a genuinely excellent dispatch
module, and a directional trust model applied consistently across 285 `unknown`
parameters. Its biggest risk is not any single defect — it is that **the prose
carrying its reasoning has no gate, and ten load-bearing comments now describe
guards that do not exist.** The concrete failures cluster in the realtime voice
layer, where silence is the default failure mode: five separate paths drop work
quietly while every surface reads green.

**Top 3 actions.**

1. **Make the grant panel and dispatch agree on one persona (C1).** A permission
   switch that reports success and does not take effect is the most damaging
   defect here, because it breaks the exact promise the grant system exists to
   make.
2. **Install `uncaughtException`/`unhandledRejection` handlers and wrap
   `voice:report` (H1, H2).** Two small changes that convert "the app exited and
   nobody knows why" into a reported problem, in an app whose own code says a
   packaged build has no console.
3. **Add the `claims.test.ts` gate (§1).** Everything else is one bug; this is the
   mechanism that let ten of them hide behind confident prose, two written today.

**Confidence.**

- §1 stale claims — **High.** Each verified against the code by file and line.
- C1, C2, C3, C4 — **High.** Concrete triggering sequences, verified call sites.
- H4, H5, H10 — **Medium-High.** Reasoning is sound and located; the timing
  windows are inferred from the code rather than observed at runtime.
- §3.5 cluster extraction — **High.** Reference spans measured per binding.
- Coverage figures — **High.** Measured with `vitest run --coverage`.
- Security overall — **Low.** The dedicated pass never completed (§0).
- Edge-case matrix — **Medium.** Assembled from the dispatch and voice
  sub-agents; no dedicated edge-case pass survived.

_What would raise confidence:_ completing the security and edge-case passes;
running the app through a character switch with a live session to confirm C1
end to end; and a runtime probe for the H4 window.

**Paranoid verdict — the single scariest thing.** Not the mic staying live, and
not the lost answers. It is **C1 combined with §1**: a user revokes a
capability, is told in writing that it is in force, and the model keeps using
it — while the codebase's own comment at `shared/grants.ts:40-51` states that
this cannot happen. The defect and the reassurance that it is impossible ship in
the same repository. That is the failure mode this codebase is uniquely exposed
to, because it is the one codebase where the comments are good enough to be
believed.
