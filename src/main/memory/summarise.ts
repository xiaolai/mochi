/**
 * Maintaining her note: what she keeps knowing about the person she talks to.
 *
 * ## The model emits FIELDS; this file renders the string
 *
 * `plan.md`'s M9 row already required this -- "what the model writes into
 * memory can only be restricted fields; the schema rejects paths / commands /
 * URLs / other personas' ids" -- and no such schema ever landed. Keeping the
 * store as one string and putting the restriction on the model's OUTPUT
 * satisfies both: a path or a command is rejected before it can reach the
 * string, which is impossible to guarantee if the model hands back prose.
 *
 * The rejections are not about the model being malicious. They are about what a
 * note is FOR. A note is things about a person; a filesystem path in one is
 * either a hallucination or something read out of a delegation answer, and
 * either way it will be read aloud on a later wake as though she knew it.
 *
 * ## Rewrite, not append
 *
 * `remember` is whole-file and its comment gives the argument: an append-only
 * log quietly becomes the implicit accumulation this design exists to avoid.
 * Appending fills 20,000 characters in weeks, after which `recall` silently
 * slices the oldest facts off -- so the memory would degrade by forgetting the
 * things it had held longest, which is the opposite of what anybody means by a
 * memory. The job is document maintenance: merge, promote, demote, drop.
 *
 * ## It runs on the Codex subscription, not on a metered API key
 *
 * The first version called `/v1/responses` with a stored API key, which meant
 * the one path in this app that keeps her memory alive was also the one path
 * that needed a credential most people signing in through Codex do not have --
 * and it billed per sleep. That is backwards: a companion who remembers you is
 * the product, and it should not be the part behind a second paywall.
 *
 * So the transport is `codex exec --output-schema`, which is already built,
 * already measured (findings §8.3: "valid JSON… this is the solution to how do
 * we read Codex's output aloud"), and already authenticated by whatever the
 * user signed in with. Codex's floor of 20-56 seconds is irrelevant here: this
 * runs at sleep, off every latency path, and is never awaited.
 *
 * AGENTS.md rule 1 is untouched. The veto is on Codex WRITING; here it reads a
 * transcript handed to it in a prompt and returns JSON, and main does the
 * writing. `-s read-only` makes a write impossible by mechanism.
 *
 * ## It reads the working set, not the archive
 *
 * So it runs with saving switched off, needs no large read at sleep, and takes
 * "this presence" as its unit -- which is the right one for deciding what was
 * worth keeping.
 *
 * ## It can never block sleep
 *
 * Deadlined and caught. A summariser that hangs must not be able to keep her
 * awake; that is the same failure the delegation hold has from the other side.
 */

import type { Turn } from '../store/turn-row'
import { PERSONA_LIMITS } from '@shared/persona'
import { fenced } from '@shared/instructions'
import { oneLine } from '@shared/text'

/** How many entries any one section may hold. */
export const MAX_ENTRIES = 24

/** How long one entry may be. A sentence, not a paragraph. */
export const MAX_ENTRY_CHARS = 200

/**
 * The sections a note is made of.
 *
 * Closed on purpose: the model chooses what goes in them and never what they
 * are. A free-form document would let one session's summary decide the shape
 * every later session has to fit, and the drift is invisible.
 */
export const SECTIONS = ['about', 'preferences', 'threads', 'subjects'] as const
export type Section = (typeof SECTIONS)[number]

export type NoteFields = Readonly<Record<Section, readonly string[]>>

/** What each section is for, sent to the model and used as the note's headings. */
const HEADINGS: Readonly<Record<Section, string>> = {
  about: 'About them',
  preferences: 'What they like and how they like it',
  threads: 'Things still going on',
  subjects: 'Subjects you have talked about',
}

/**
 * Text a note may not contain, whatever the model thought it was doing.
 *
 * Each one is a class rather than an instance, and each is here because it
 * would be READ ALOUD on a later wake as something she knows:
 *
 * - a path or a URL is either invented or lifted out of a delegation answer;
 * - shell syntax is the one thing in this list that could do something if it
 *   ever reached somewhere that runs it, and nothing here should ever contain
 *   any;
 * - a persona id is how another character's memory is addressed, and a note
 *   naming one is a note trying to reach across the boundary that filing per
 *   id exists to hold.
 */
const FORBIDDEN: ReadonlyArray<{ readonly why: string; readonly pattern: RegExp }> = [
  { why: 'url', pattern: /\b[a-zA-Z][a-zA-Z0-9+.-]*:\/\// },
  { why: 'path', pattern: /(^|\s)(~\/|\.\.\/|\/[\w.-]+\/|[A-Za-z]:\\)/ },
  { why: 'command', pattern: /[`$]\(|\$\{|\bsudo\b|\brm\s+-|\bcurl\b|\bchmod\b/ },
]

/**
 * Why one line may not go into a note, or null when it may.
 *
 * ONE function for two callers: the summariser's whole-note rewrite and the
 * `remember` tool's single line. Both write into the same file and both take
 * their content from a model, so two copies of this rule would be two places
 * for it to be got subtly differently -- and the weaker copy would be the one
 * that mattered.
 */
export function entryProblem(line: string, otherPersonaIds: ReadonlySet<string>): string | null {
  const forbidden = FORBIDDEN.find((rule) => rule.pattern.test(line))
  if (forbidden !== undefined) return forbidden.why
  // Matched WHOLE-WORD, so an ordinary sentence mentioning a word that happens
  // to contain somebody's id is not refused for it -- "adamant" is not "ada".
  // Ids are lowercase ASCII with hyphens, so this cannot collide with
  // punctuation.
  //
  // The rule is about a note ADDRESSING ANOTHER character's storage, and the
  // first version was written blunter than that: it matched every persona id
  // including the worn one. Ids are derived from names and names are ordinary
  // words -- the built-in's id is `mochi`, so "they like mochi with red bean"
  // was refused by an app whose entire subject is a mochi. One collision
  // refuses the WHOLE rewrite, so her memory would have silently stopped
  // updating with the reason visible only in a log.
  //
  // So the caller passes the ids of the OTHER characters, never the one whose
  // note this is. A persona may be described using her own name; she may not be
  // told about somebody else's storage.
  //
  // The residual risk is real and worth stating: two characters, one called
  // `coriander`, and a note about disliking coriander is refused. It errs
  // towards refusing, which for a durable note is the right direction, and the
  // bound that actually holds is that this text is data in a fenced block
  // rather than an address anything resolves.
  const named = line
    .toLowerCase()
    .split(/[^a-z0-9-]+/)
    .find((word) => word !== '' && otherPersonaIds.has(word))
  return named === undefined ? null : 'names-a-persona'
}

/**
 * The heading an explicitly-requested note goes under.
 *
 * Its own section rather than folded into `about`, so the next rewrite can see
 * that a human asked for it. A summariser weighing "should this survive?" ought
 * to treat "they told me to remember it" differently from something it inferred.
 */
export const ASKED_HEADING = '## They asked you to remember'

/**
 * The note with one more line under the asked-for heading.
 *
 * APPENDED rather than rewritten, which is the one place this file departs from
 * "rewrite, not append" -- and deliberately. A person saying "remember that…"
 * out loud expects it to stick NOW, and the next sleep's rewrite is what folds
 * it into the rest. Waiting for that rewrite to record it at all would make the
 * instruction look ignored for the rest of the conversation.
 *
 * Returns null when there is no room, so the caller can tell her rather than
 * silently keeping nothing.
 */
export function noteWith(current: string, line: string): string | null {
  if (current.includes(line)) return current
  const next =
    current === ''
      ? `${ASKED_HEADING}\n- ${line}`
      : current.includes(ASKED_HEADING)
        ? // A REPLACEMENT CALLBACK, not a template. `String.replace` expands
          // `$&`, `$'`, `` $` `` and `$$` inside a replacement STRING -- and
          // `line` is model output, so a note containing `$&` would splice the
          // matched heading back into itself and corrupt durable memory. A
          // callback's return value is taken literally.
          current.replace(ASKED_HEADING, () => `${ASKED_HEADING}\n- ${line}`)
        : `${current}\n\n${ASKED_HEADING}\n- ${line}`
  // Refused rather than truncated. Truncating here would cut the OLD note to
  // fit the new line, which is the one direction nobody asked for.
  return next.length > PERSONA_LIMITS.memory ? null : next
}

export type FieldProblem = { readonly section: Section; readonly why: string }

export type FieldParse =
  | { readonly ok: true; readonly fields: NoteFields }
  | { readonly ok: false; readonly problems: readonly FieldProblem[] }

/**
 * Turn what the model returned into fields, or say what is wrong with it.
 *
 * Reports EVERY problem rather than the first, like every other parser here:
 * one bad entry should not hide the other three.
 *
 * `otherPersonaIds` is every character on this machine EXCEPT the one whose
 * note this is. See `entryProblem` for why her own id is excluded.
 */
export function parseFields(value: unknown, personaIds: ReadonlySet<string>): FieldParse {
  const problems: FieldProblem[] = []
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return { ok: false, problems: [{ section: 'about', why: 'not-object' }] }
  }
  const source = value as Record<string, unknown>
  // How many sections the reply actually carried. `{}` parses cleanly into four
  // empty lists, and an all-empty note is a SUCCESSFUL REWRITE that erases
  // everything she knew -- the single worst outcome this function has, and one
  // that looks identical to a quiet conversation. So a reply that named no
  // section at all is refused rather than believed.
  let seen = 0
  const fields: Record<Section, string[]> = {
    about: [],
    preferences: [],
    threads: [],
    subjects: [],
  }

  for (const section of SECTIONS) {
    const raw = source[section]
    // Absent is an empty section, not a failure. A conversation that produced
    // nothing worth keeping under one heading is ordinary.
    if (raw === undefined || raw === null) continue
    seen += 1
    if (!Array.isArray(raw)) {
      problems.push({ section, why: 'not-a-list' })
      continue
    }
    if (raw.length > MAX_ENTRIES) {
      problems.push({ section, why: 'too-many-entries' })
      continue
    }
    for (const entry of raw as unknown[]) {
      if (typeof entry !== 'string') {
        problems.push({ section, why: 'not-text' })
        continue
      }
      const line = entry.replace(/\s+/g, ' ').trim()
      if (line === '') continue
      if (line.length > MAX_ENTRY_CHARS) {
        problems.push({ section, why: 'too-long' })
        continue
      }
      const why = entryProblem(line, personaIds)
      if (why !== null) {
        problems.push({ section, why })
        continue
      }
      fields[section].push(line)
    }
  }

  if (problems.length > 0) return { ok: false, problems }
  if (seen === 0) return { ok: false, problems: [{ section: 'about', why: 'no-sections' }] }
  return { ok: true, fields }
}

/**
 * The fields as the string the store holds.
 *
 * Rendered HERE rather than by the model, which is the whole point of the
 * split: the headings are the machine's and cannot be rewritten by anything a
 * conversation contained.
 *
 * NOT bounded here, and that is the point rather than an omission. `recall` and
 * `remember` both enforce `PERSONA_LIMITS.memory` already, and a third
 * enforcement point is exactly what this repository has been bitten by before:
 * the checks drift, and the one that fires first decides.
 *
 * What keeps this inside the ceiling is the SCHEMA, upstream of here -- four
 * sections of at most `MAX_ENTRIES` entries of at most `MAX_ENTRY_CHARS`, which
 * cannot reach 20,000 characters however they are filled. `summarise.test.ts`
 * asserts that arithmetic — it builds the worst case out of `MAX_ENTRIES` and
 * `MAX_ENTRY_CHARS` and checks it against `PERSONA_LIMITS.memory` — so a later
 * change to any of the three constants fails there rather than silently
 * starting to truncate somebody's note. The name here said
 * `renderNote.test.ts`, which does not exist; the assertion does, and pointing
 * at the wrong file is how somebody comes to believe it does not.
 */
export function renderNote(fields: NoteFields): string {
  const blocks: string[] = []
  for (const section of SECTIONS) {
    const lines = fields[section]
    if (lines.length === 0) continue
    blocks.push([`## ${HEADINGS[section]}`, ...lines.map((line) => `- ${line}`)].join('\n'))
  }
  return blocks.join('\n\n')
}

export interface SummariseDeps {
  /**
   * Ask for the rewritten fields, however that is done.
   *
   * Injected, so a test never spawns anything and the transport can change
   * without touching a single rule about what may go into a note. Returns
   * whatever JSON came back, or `null` when nothing usable did -- it does not
   * interpret, because interpreting is `parseFields`'s job and there must be
   * exactly one place that decides what a note may contain.
   */
  readonly ask: (prompt: string, schema: object) => Promise<unknown>
  /** Every OTHER persona on this machine. See `entryProblem`. */
  readonly personaIds: ReadonlySet<string>
  /**
   * What `summariser.instruction` currently says. See `@shared/prompts`.
   *
   * Injected rather than read here, for the reason the rest of this module is
   * pure: the wording is the part most likely to be wrong and the part a test
   * can actually hold, and a module that read it off disk could not be handed
   * a different one to check what it produces.
   */
  readonly instruction: string
}

export type SummariseResult =
  /**
   * The rewritten note, and nothing beside it.
   *
   * The subject list the wake brief deferred is NOT returned separately: it is
   * a section of the note, so it already reaches the prompt on every wake, is
   * visible in the settings window, and is editable there. Handing it back a
   * second time would be the same words rendered twice and billed twice, with
   * two places for them to disagree.
   */
  | { readonly ok: true; readonly note: string }
  /** Nothing changes on this path. The previous note stays exactly as it was. */
  | { readonly ok: false; readonly reason: string }

/**
 * The shape the answer must take, handed to `codex exec --output-schema`.
 *
 * Exported because the transport needs it and this module owns it: the schema
 * and the parser that enforces the same bounds must not be able to drift, and
 * they cannot when they sit in one file.
 *
 * The schema is what keeps the note inside `PERSONA_LIMITS.memory` without a
 * third length check anywhere -- see `renderNote`.
 */
export const SUMMARY_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: [...SECTIONS],
  properties: Object.fromEntries(
    SECTIONS.map((section) => [
      section,
      {
        type: 'array',
        items: { type: 'string', maxLength: MAX_ENTRY_CHARS },
        maxItems: MAX_ENTRIES,
      },
    ]),
  ),
}

// The instruction is `summariser.instruction` in the prompt catalogue now,
// so it can be read and rewritten rather than only read in this file.

/**
 * The whole prompt, as one string.
 *
 * One string because that is what `codex exec` takes, and pure because the
 * wording is the part most likely to be wrong and the part a test can actually
 * hold. The transport gets a finished prompt and has no opinion about it.
 *
 * Both untrusted halves are FENCED with the same helper the prompt assembly
 * uses everywhere else. That is a mitigation and not a guarantee, and it is not
 * the only one here: whatever Codex is talked into saying still has to survive
 * `parseFields`, which refuses a path, a URL, shell syntax or another
 * character's id no matter who asked for it. The fence reduces the chance of a
 * bad answer; the parser is what stops one reaching the file.
 */
export function summarisePrompt(
  turns: readonly Turn[],
  currentNote: string,
  instruction: string,
): string {
  return [
    instruction,
    '',
    fenced('notes', currentNote === '' ? '(she has no notes yet)' : currentNote),
    '',
    fenced('conversation', transcriptOf(turns)),
  ].join('\n')
}

/**
 * Ask for a rewritten note. Never throws.
 *
 * Every failure -- a deadline, a missing Codex, malformed JSON, a rejected
 * field -- returns `ok: false`, and the caller leaves the previous note
 * untouched. That asymmetry is deliberate: a note that fails to improve is a
 * non-event, while a note replaced by something half-parsed is a memory
 * quietly corrupted.
 */
export async function summarise(
  turns: readonly Turn[],
  currentNote: string,
  deps: SummariseDeps,
): Promise<SummariseResult> {
  // Nothing said, nothing to think about. Checked first, so a quiet session
  // costs neither a subprocess nor a complaint about configuration.
  if (turns.length === 0) return { ok: false, reason: 'nothing was said' }
  try {
    const answered: unknown = await deps.ask(
      summarisePrompt(turns, currentNote, deps.instruction),
      SUMMARY_SCHEMA,
    )
    // `null` is the transport saying it got nothing usable. Refusing here keeps
    // every "we could not" on one path, so the caller has one rule: on
    // `ok: false`, change nothing.
    if (answered === null) return { ok: false, reason: 'no usable answer came back' }
    const parsed = parseFields(answered, deps.personaIds)
    if (!parsed.ok) {
      // Named, because the alternative is a note that silently stops updating
      // and nobody ever learns which rule keeps rejecting it.
      return {
        ok: false,
        reason: `the notes were refused: ${parsed.problems.map((one) => `${one.section}/${one.why}`).join(', ')}`,
      }
    }
    return { ok: true, note: renderNote(parsed.fields) }
  } catch (error: unknown) {
    // The transport owns its own deadline and its own kill escalation; what
    // reaches here is whatever it could not handle. Caught rather than
    // propagated because this is started from the sleep path with `void`, and
    // an unhandled rejection there is an unhandled rejection in going to sleep.
    return { ok: false, reason: String(error) }
  }
}

/** The conversation as text the model can read. */
function transcriptOf(turns: readonly Turn[]): string {
  return turns
    .map((turn) => `${turn.who === 'her' ? 'Her' : 'Them'}: ${oneLine(turn.text)}`)
    .join('\n')
}
