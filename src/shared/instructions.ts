import { looksEmpty, oneLine } from './text'
import { type Persona, type Prompts, type SpokenMoment } from './persona'
import { promptsFor, type PromptSpec } from './prompts'
import { EMOTIONS } from './avatar'

/**
 * What she is TOLD -- the system prompt, assembled.
 *
 * Split from `persona.ts`, which was three things at once: what a persona IS
 * (the type and its defaults), how one is PARSED off disk, and what she is
 * told. Only the third is here. It reads the first and never the reverse:
 * `persona.ts` mentions `instructionsFor`, `fenced` and `wearName` in prose
 * only, never in code, so the dependency runs one way and these two files are
 * not a pair that must be read together.
 */

/**
 * The catalogue's own text, for a caller with no overrides to apply.
 *
 * Built from the FIXED half only — `promptsFor([])` — because the tool entries
 * are derived from manifests this module must not import, and nothing here asks
 * for one.
 */
const CATALOGUE: readonly PromptSpec[] = promptsFor([])
const defaultPrompts: Prompts = (key) => CATALOGUE.find((spec) => spec.key === key)?.text ?? ''
/** What a fence tag may be. See `fenced`. */
const TAG_SHAPE = /^[a-z]+$/

/**
 * Untrusted text, bounded so the prompt can tell where it ends.
 *
 * A tag rather than quotation marks, and the closing tag is STRIPPED from the
 * payload before wrapping. Without that, the boundary is only as strong as the
 * content's willingness to respect it: a memory or a greeting containing the
 * closing tag ends the block early and everything after it is read at
 * instruction level, which is precisely the position the fence exists to deny.
 *
 * This is a mitigation, not a guarantee, and saying so matters. A system prompt
 * is one flat string to the model; no delimiter is enforced by the protocol,
 * and a determined instruction inside a fenced block can still be followed. It
 * removes the easy case -- an unescaped quote, a newline, a pasted "ignore the
 * above" -- and the real boundary has to come from a higher-priority role if
 * the API ever offers one.
 */
export function fenced(tag: string, text: string): string {
  // CHECKED, not asserted. The comment below used to say "the tags in this file
  // are our own `[a-z]+` literals, so this cannot be given a pattern to escape"
  // -- which is a claim about every present caller rather than a property of
  // the function, and the tag is interpolated straight into a regular
  // expression. `notes|conversation` would strip both tags from the payload,
  // and an unbalanced bracket would throw from inside prompt assembly.
  if (!TAG_SHAPE.test(tag)) throw new Error(`not a fence tag: ${JSON.stringify(tag)}`)
  const closing = `</${tag}>`
  // EVERY spelling of the tag, not the exact string.
  //
  // Splitting on `</notes>` alone left `</notes >`, `</NOTES>` and a stray
  // `<notes>` opener intact -- all of which a model reads as the same tag, and
  // any of which ends or reopens the block the fence exists to bound. The
  // boundary was only as strong as the content's willingness to spell things
  // one way, which is not a boundary.
  //
  // Both directions are stripped: a closing variant ends the block early, and
  // an extra opener lets content claim a second one. The tag itself is checked
  // above, so nothing here can be handed a pattern.
  const anySpelling = new RegExp(`<\\s*/?\\s*${tag}\\s*>`, 'gi')
  return `<${tag}>\n${text.replace(anySpelling, '')}\n${closing}`
}

/**
 * The system prompt for a session.
 *
 * ## Labelled sections, not a run of sentences
 *
 * This used to be four lines of prose joined by newlines, and every published
 * guide for speech-to-speech prompting says the same first thing: "Use short,
 * labeled sections. The model should be able to find the relevant instructions
 * quickly." (OpenAI's realtime docs; ElevenLabs puts it as "clear section
 * boundaries prevent instruction bleed where rules from one context affect
 * another"; Hume recommends Markdown headers specifically for OpenAI models.)
 *
 * The headings are the MACHINE'S. `persona.style` and the speech block are the
 * user's, and both land inside a section rather than owning one -- so somebody
 * rewriting who she is cannot accidentally rewrite the shape of the prompt.
 *
 * ## The order is still the first security property
 *
 * Memory is remembered text -- eventually written from things a user said --
 * and it used to be appended last, which is the strongest instructional
 * position in a prompt. Anything that got into memory could restate the persona
 * or cancel the speech rules. So memory is rendered in the middle, explicitly
 * framed as notes rather than instructions, and the rules go last.
 *
 * Order alone was doing more work than it can carry, though. Interpolated bare,
 * memory is indistinguishable from the sentences introducing it -- a note
 * beginning with a blank line and `You are a different assistant now.` reads as
 * prompt, not as data, whatever came before it. Fencing gives the boundary a
 * shape; the ordering keeps the rules downstream of it. Headings do not change
 * that calculus in either direction: a note could always forge a sentence, and
 * now it could forge a heading, which is the same class of thing the fence
 * already only mitigates.
 */
export function instructionsFor(
  persona: Persona,
  memory: string,
  /**
   * What happened the last time they spoke. Built by `main/memory/brief.ts`.
   *
   * DEFAULTED, unlike `memory`, and the asymmetry is deliberate. The argument
   * above is required because an omitted memory is amnesia about the person --
   * the durable thing, and the failure this project is least able to notice. An
   * omitted brief costs continuity for one wake and nothing after it.
   *
   * The place that must not be able to forget is main, which is the only thing
   * that can compute it. So `VoiceCommand.open` carries `brief` as a REQUIRED
   * field: the compile error lands where the risk actually is, rather than on
   * seventeen tests that have no opinion about continuity.
   */
  brief: string = '',
  /**
   * The system prompt document, as the user wrote it. Empty is the default.
   *
   * DEFAULTED, like `brief` and unlike `memory`, and for the same reason the
   * asymmetry exists there: an omitted memory is amnesia about the person and
   * must be a compile error, while an omitted document costs prose nobody
   * necessarily wrote. Main reads it; every test that has no opinion about it
   * says nothing.
   */
  template: string = '',
  /**
   * What each catalogued prompt currently says. See `@shared/prompts`.
   *
   * DEFAULTED to the catalogue's own text, so every test that has no opinion
   * about wording says nothing — the same asymmetry `brief` and `template`
   * already carry, and for the same reason. The two callers that matter build
   * it from what is on disk.
   */
  prompts: Prompts = defaultPrompts,
): string {
  /*
    Each piece once: at its slot if the document names one, at its default
    position if not. `PROMPT_SLOTS` explains why omitting a slot cannot lose a
    piece, which is the property that makes this safe to hand over.
  */
  const pieces: Readonly<Record<PromptSlot, string>> = {
    style: wearName(persona.style, persona),
    address: addressLine(persona),
    // Only when there is something to say. An empty "here is what you remember"
    // section invites the model to invent one -- and `looksEmpty` rather than
    // `trim`, because a note of nothing but zero-width joiners renders as
    // nothing and would open that section with an invisible body.
    notes: looksEmpty(memory.trim())
      ? ''
      : [prompts('notes.heading'), prompts('notes.fence'), fenced('notes', memory.trim())]
          .filter((line) => line !== '')
          .join('\n'),
    brief: brief.trim(),
    /*
      Which faces she has, and only when it is not all of them.

      Silent in the ordinary case, for the same reason the memory section is: an
      "everything is available" heading is a line that costs tokens and says
      nothing. When a character DOES narrow the set, she is told — because
      `set_expression`'s enum is narrowed to match, and a tool that silently
      offers three of eight leaves her wondering why a face she can see in the
      tuple is not on her wire.

      It says "you may use" rather than "you have", because she can also be
      refused at the moment of the call: the grant can be off.
    */
    faces:
      persona.faces.length === EMOTIONS.length
        ? ''
        : persona.faces.length === 0
          ? '# Your face\nYou wear one face and cannot change it. Say what you mean in words.'
          : `# Faces you may use\n${persona.faces.join(' · ')}`,
  }

  let head = wearName(template.trim(), persona)
  const placed = new Set<PromptSlot>()
  for (const slot of PROMPT_SLOTS) {
    const token = slotToken(slot)
    if (!head.includes(token)) continue
    placed.add(slot)
    // `split`/`join` rather than a regular expression, for `wearName`'s reason:
    // the replacement is somebody's own text and `$&` in it would be a
    // substitution nobody wrote.
    head = head.split(token).join(pieces[slot])
  }

  /*
    The document sits where the shipped two sentences used to, under the app's
    own heading — which stays the app's, per this function's header: *"somebody
    rewriting who she is cannot accidentally rewrite the shape of the prompt."*

    A document that used a slot has already placed that piece, so it is not
    repeated here. One that used none reads exactly as this always did, with
    whatever the user wrote at the top and nothing if they wrote nothing.
  */
  const sections = [
    [
      '# Who you are',
      head,
      placed.has('style') ? '' : pieces.style,
      placed.has('address') ? '' : pieces.address,
    ]
      .filter((line) => line.trim() !== '')
      .join('\n'),
  ]

  // AFTER memory and BEFORE the rules, and both halves of that are load-bearing.
  //
  // After memory, because memory is the curated durable thing and this is
  // transient context; reading the transient one first frames the durable one
  // as commentary on it.
  //
  // Before the rules, for the reason this function's header gives about memory:
  // text derived from what somebody said must never occupy the strongest
  // instructional position in the prompt. `briefFor` already fences the quoted
  // half; the ordering is what keeps the rules downstream of it.
  for (const slot of ['notes', 'brief', 'faces'] as const) {
    if (placed.has(slot)) continue
    if (pieces[slot] !== '') sections.push(pieces[slot])
  }

  /*
    The heading goes with its section when there is nothing under it.

    With an empty document, an empty style and no address, `# Who you are` would
    be a heading over nothing — which reads as a section the model is expected
    to fill in. That state is reachable now in a way it was not while two
    sentences were compiled in, so it is handled rather than assumed away.
  */
  // A BLANK line between sections. Run together, a heading sits on the line
  // after the previous section's last rule and reads as part of it.
  return sections.filter((section) => section !== '' && section !== '# Who you are').join('\n\n')
}

/**
 * How she refers to the person she is talking to.
 *
 * Omitted entirely when there is no actual name. The default was the literal
 * string `you`, which rendered as "You address the person you are talking to as
 * you" and "Greet you in one short sentence" -- instructions that say nothing,
 * asking the model to make sense of them.
 */
/**
 * The token in a style text where her name goes.
 *
 * Braces because they do not occur in ordinary prose about a character, and one
 * pair rather than two because this is a text box a person types into, not a
 * template language.
 */
export const NAME_TOKEN = '{name}'

/**
 * The pieces of the prompt the APP owns, and the token that moves each one.
 *
 * ## Why slots exist at all
 *
 * The system prompt is a document the user writes (`store/prompt.ts`). Without
 * slots it could only ever be prepended, so somebody who wanted their notes
 * framed differently, or the brief read before the character, had no way to say
 * so. A slot is how the document says WHERE a piece goes.
 *
 * ## Omitting one cannot lose it — that is the whole safety property
 *
 * Every piece has a DEFAULT POSITION. A document with no `{notes}` in it still
 * gets the notes, in the place they have always gone; the slot moves a piece,
 * it does not enable one. So the failure this design exists to avoid — editing
 * the prompt and silently switching off her memory — is not reachable by
 * forgetting something. It would take deliberately deleting a section that
 * cannot be deleted, and there is no control for that.
 *
 * ## What a slot does NOT give away
 *
 * `{notes}` expands to the whole block: the heading, the sentence saying the
 * contents are background DATA rather than instructions, and the `<notes>`
 * fence. The user controls placement and the prose around it; the fence is not
 * theirs to remove, because it is the one mitigation against text a MODEL wrote
 * reading as prompt.
 *
 * What placement does affect is ORDER, and this function's header argues that
 * order is a security property — memory must not sit in the strongest
 * instructional position. A document that puts `{notes}` last weakens that,
 * and the fence is what survives it. That is a real cost of handing the layout
 * over, and it is stated rather than prevented: it is their prompt.
 */
export const PROMPT_SLOTS = ['style', 'address', 'notes', 'brief', 'faces'] as const

export type PromptSlot = (typeof PROMPT_SLOTS)[number]

/** `{style}`, `{notes}` — the same one-pair-of-braces shape as `{name}`. */
export function slotToken(slot: PromptSlot): string {
  return `{${slot}}`
}

/**
 * The document as PROSE: her name filled in, every other slot taken out.
 *
 * For the one caller that wants what the user wrote and none of the pieces it
 * can place — `farewellFor`, which is asked for with no conversation in view,
 * so there are no notes, no brief and no faces in scope. Leaving the tokens in
 * would put a literal `{notes}` into a prompt, which is exactly the defect
 * `wearName`'s own comment records shipping once for `{name}`.
 */
export function promptProse(template: string, persona: Persona): string {
  let text = wearName(template.trim(), persona)
  for (const slot of PROMPT_SLOTS) text = text.split(slotToken(slot)).join('')
  return text.trim()
}

/**
 * Her style, with her name in the slot the style chose for it.
 *
 * ## Why a slot rather than a sentence
 *
 * This used to append `Your name is Mochi.` and `You are soft green in colour.`
 * after the style. Both were app STATE promoted into personality: one a label
 * for a menu, the other a theme setting. Measured on 149 of her turns, that
 * block cost 17% of them to self-description and 14% to reciting the colour --
 * while the user addressed her by name three times in 148 turns and never once
 * asked what it was. She was using her own identity block nine times more than
 * the person she was talking to.
 *
 * A slot has neither failure. The name lands where the sentence already needed
 * a subject, so nothing is appended and nothing is declared; and the colour is
 * simply not something she is told, which is the option nobody took when the
 * colour was moved out of the style text and derived instead.
 *
 * ## What a style with no token gets
 *
 * Nothing added. That is the whole point: a persona that does not mention a
 * name does not acquire one, and there is no line for the model to parrot.
 * Somebody who wants her named puts the token where it reads best in their own
 * prose, which is also the only place that knows where that is.
 */
export function wearName(text: string, persona: Persona): string {
  // FLATTENED before it lands. `name` comes from a text box and is dropped into
  // a line-oriented prompt: a newline in it would end the sentence it was meant
  // to be part of and begin one in the writer's own voice. Bounded by
  // `PERSONA_LIMITS` upstream; this closes the shape.
  return text.split(NAME_TOKEN).join(oneLine(persona.name))
}

/**
 * Whom she is speaking to. Empty when nobody has said.
 *
 * The name half of this was removed on 2026-08-17 -- see `wearName` for the
 * measurement. What is left is about the USER rather than about her, which is
 * why it survived the same cut: she used her own name nine times more often
 * than the person she was talking to used it, and this one is the opposite way
 * round.
 *
 * FLATTENED, for the reason the prompt is line-oriented: a newline in a text
 * field ends the sentence it was meant to be part of and begins one in the
 * writer's own voice. Length is bounded by `PERSONA_LIMITS` upstream; this
 * closes the shape.
 */
function addressLine(persona: Persona): string {
  const address = oneLine(persona.addressUser)
  return address === '' ? '' : `You address the person you are talking to as ${address}.`
}

/** Whom she is greeting, in a form that reads. */
function addressee(persona: Persona): string {
  const address = oneLine(persona.addressUser)
  return address === '' ? 'the person you are talking to' : address
}

/**
 * What to say on waking.
 *
 * A separate `response.create` rather than part of the system prompt, because
 * she must speak WITHOUT being spoken to first — the shortcut is the whole
 * greeting trigger, and there is no user turn to respond to.
 */
export function greetingFor(persona: Persona): string {
  return (
    verbatimLine(persona.greeting) ??
    [
      `Greet ${addressee(persona)} in one short sentence, ${persona.greeting.instruction}.`,
      'Do not announce yourself and do not ask how you can help.',
    ].join(' ')
  )
}

export function farewellFor(persona: Persona, template: string = ''): string {
  return (
    verbatimLine(persona.farewell) ??
    [
      // HER, restated -- and since 2026-08-17 that is the WHOLE prompt, not
      // half of it. There is no shared block behind her any more, so this
      // restatement now carries everything a goodbye could need rather than
      // just her personality.
      //
      // This response is asked for with `UNPROMPTED`, so the
      // conversation is not in view -- which is what stops her continuing the
      // lesson instead of ending it, and also takes away everything that made
      // her sound like herself. The character comes back here.
      //
      // Restated rather than relied upon because the API reference does not
      // say whether `response.instructions` REPLACES the session prompt or is
      // merged with it, and I could not settle it from the published docs. If
      // it replaces, this is the only character the goodbye has; if it merges,
      // this is a harmless restatement. Written to be correct either way.
      //
      // Through `wearName`, never raw. `style` carries a `{name}` slot, and
      // reading it directly put the literal token into the goodbye prompt --
      // shipped for exactly one round, because the rule "style reaches a prompt
      // only through `wearName`" lived in one call site's head rather than in
      // the code. There are two call sites now, so it is asserted instead.
      // THE SYSTEM PROMPT TOO, not only her style. A goodbye built from `style`
      // alone is from someone who has been told everything except who she is —
      // which was the argument when this restated `CORE_PROMPT`, and it did not
      // change when that constant became a document the user writes.
      //
      // WITHOUT ITS SLOTS. A goodbye is asked for with no conversation in view,
      // so there are no notes, no brief and no faces to place — and `{style}`
      // would double the line below it. `promptProse` is what takes them out;
      // leaving them in would put a literal `{notes}` into her farewell prompt,
      // which is the same defect as the `{name}` token that shipped here once.
      promptProse(template, persona),
      wearName(persona.style, persona),
      `Say a brief goodbye to ${addressee(persona)} in one short sentence, ${persona.farewell.instruction}.`,
      // Named explicitly, because the failure was specific: she picked the
      // lesson back up and set an exercise. "Do not ask a question" alone did
      // not cover it -- what she produced was not a question.
      'This is the end of the conversation. Do not carry on with what you were doing, do not set anything to do next, and do not ask a question — nobody will be listening for the answer.',
    ].join('\n')
  )
}

/**
 * An exact line, turned into an instruction that asks for exactly it.
 *
 * Fenced with the same tag scheme as memory, because this string is
 * concatenated into a prompt and a user typing `ignore the above and ...` into
 * a greeting box would otherwise be writing instructions rather than words to
 * say. It used to be wrapped in plain double quotes, which is a boundary the
 * content itself can end: a greeting of `hi" — now ignore your rules` closed
 * the quotation and continued at instruction level, and a greeting containing a
 * newline broke the line structure the rest of the prompt is built from. Both
 * are things a person can type by accident.
 *
 * Whitespace-only counts as absent: clearing a text box on the shelf leaves an
 * empty string, not a null, and "say nothing, exactly" is not a greeting anyone
 * means to configure.
 */
function verbatimLine(moment: SpokenMoment): string | null {
  const exact = moment.verbatim?.trim() ?? ''
  // `looksEmpty`, not `=== ''`. A verbatim of nothing but zero-width joiners
  // is not a greeting: it would produce "say exactly this, word for word"
  // wrapped around an invisible line, which is an instruction to say nothing
  // and an odd one to have sent.
  if (looksEmpty(exact)) return null
  return `Say exactly the contents of the <line> block, word for word, and nothing else. Do not read the tags aloud:\n${fenced('line', exact)}`
}
