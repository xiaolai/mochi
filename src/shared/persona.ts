/**
 * Who she is, and who she thinks you are.
 *
 * Data, like the face. A wake opens a NEW session every time, which is what
 * makes this cheap: there is no long-lived session holding a stale character,
 * so switching persona is just a different string on the next wake. That is the
 * whole mechanism behind a tutor mode, a language partner, or anything else
 * with its own purpose and manner — they are this object, not a code path.
 *
 * The cost of a session per wake is that nothing is remembered unless it is
 * injected. That is a feature rather than a gap: memory becomes an explicit,
 * inspectable string instead of an implicit accumulation in somebody's context
 * window.
 *
 * Memory is NOT a field here. It is produced by USING a persona, while
 * everything in this file is what a persona IS -- and the two have different
 * lifetimes: a persona can be replaced by a newer version of itself, and the
 * memory has to survive that. So it is stored beside the app, keyed by `id`,
 * and reaches the prompt as an argument to `instructionsFor`. That argument is
 * REQUIRED rather than defaulted: an omitted one is amnesia, and amnesia that
 * compiles is the failure this project is least able to notice.
 */

/**
 * The voices the Realtime API accepts.
 *
 * Listed rather than inferred, so adding one is a deliberate edit and a wrong
 * one is a compile error. If the service adds a voice, this is the single line
 * that has to change.
 */
import { EMOTIONS, type Emotion } from './avatar'
import type { ByPronoun, Pronoun } from './pronoun'

/** What `instructionsFor` reads a catalogued prompt with. */
export type Prompts = (key: string) => string

import { DEFAULT_THEME, type Theme } from './theme'

export const VOICE_NAMES = [
  'alloy',
  'ash',
  'ballad',
  'coral',
  'echo',
  'sage',
  'shimmer',
  'verse',
  'cedar',
  'marin',
] as const
export type VoiceName = (typeof VOICE_NAMES)[number]

/**
 * The two the service's own guidance singles out for realtime.
 *
 * ## What this claims, and what it does not
 *
 * It is a pointer at somebody else's recommendation, not a verdict of ours.
 * §25's "What is NOT established" is explicit that **latency and quality are
 * entirely unmeasured here** — nobody in this project has listened to ten voices
 * and ranked them, and a mark that implied otherwise would be inventing a
 * measurement. So the pane says who recommends them rather than that they sound
 * better, and this comment is the reason the wording is careful.
 *
 * The one corroborating fact measured on this machine: §24 §3 captured the
 * service's own `session.created` defaults, and its default output voice is
 * `marin` — one of these two.
 *
 * ## Listed, never derived
 *
 * The same discipline as the tuple above: it is not "the last two of
 * `VOICE_NAMES`", which is an ordering accident that any insertion would break
 * silently. `satisfies` is what makes a name that is not a real voice a compile
 * error rather than a dot on a pill that does not exist.
 */
export const RECOMMENDED_VOICES = ['cedar', 'marin'] as const satisfies readonly VoiceName[]

/**
 * A line she speaks at a moment the app chooses, rather than in reply to you.
 *
 * Two fields, because the two ways of specifying one are genuinely different
 * and both are wanted. `instruction` is handed to the model, so she phrases it
 * fresh every time and it never sounds canned; `verbatim` is the exact words,
 * for anyone who wants the same greeting every morning.
 *
 * `verbatim: null` rather than an optional field. This project compiles with
 * `exactOptionalPropertyTypes`, and more to the point an absent key and an
 * empty string would be two spellings of "no override" -- one of which the
 * shelf would produce by clearing a text box.
 */
export interface SpokenMoment {
  /** What she should convey. Always present; the fallback when there is no override. */
  readonly instruction: string
  /** Exact words, or null to let her phrase it. */
  readonly verbatim: string | null
}

/**
 * What this build of mochi can read.
 *
 * Bumped for any change an OLDER build would misread, and adding a field is
 * one of them: unknown fields are REFUSED here, not ignored, so a manifest
 * carrying something new does not load at all on a build that predates it.
 * The two rules only make sense together -- the version is what turns "this
 * file is unreadable" into "this file is newer than me".
 *
 * ## 2 — retention left the manifest
 *
 * `keeps` and `keepDays` moved to `@shared/policy`, filed under her id. That
 * is a REMOVED field, which is the case this number exists for: a build that
 * still expects them reads a manifest written here, finds neither, and fills
 * `keeps: true` -- silently ignoring an opt-out that now lives in a file it
 * has never heard of. Refusing the file is the right answer for that build,
 * and the version is what lets it give one.
 *
 * v1 manifests still load here. `savePersonaTo` stamps this number on the way
 * out, so a file edited by this build stops claiming to be readable by one
 * that would misread it.
 */
export const PERSONA_FORMAT = 4

export interface Persona {
  /**
   * Which shape of the format this was written in.
   *
   * Required BECAUSE unknown fields are now refused. Those two rules only
   * work together: without a version, the first field ever added makes every
   * persona on disk unreadable by the build that wrote them, and the loader's
   * only options are to guess or to reject everything. With one, an older
   * file is recognised as older and read on its own terms.
   *
   * A file from a NEWER build is refused rather than half-read. Loading it
   * would mean silently dropping whatever that build added -- and then saving
   * it back, writing the loss to disk. Refusing costs the user an upgrade
   * message; half-reading costs them the fields.
   */
  readonly version: number
  readonly id: string
  /** What she calls herself. */
  readonly name: string
  /** What she calls you. */
  readonly addressUser: string
  /**
   * Which words the interface uses for her.
   *
   * Lives on the persona rather than in the app's settings because it belongs
   * to the character, exactly as `voice` and `name` do -- switching to a tutor
   * persona called 老师 should not leave the tray saying "Wake her" because a
   * global preference was set months ago for somebody else.
   */
  readonly pronoun: Pronoun
  /**
   * Her colour.
   *
   * On the persona for the same reason `pronoun` and `voice` are: it belongs to
   * the CHARACTER. Switching to a tutor persona should bring her own colour
   * with her rather than leaving whatever was chosen for somebody else — which
   * is also what the design's shelf model says, where a character owns its
   * face.
   *
   * An id, not a palette. The colours are derived in `theme.ts`, so a stored
   * persona cannot carry a palette that has since been retuned, and adding a
   * theme does not require rewriting anybody's file.
   */
  readonly theme: Theme
  /**
   * Her voice on the wire. Named per persona, because it is part of the
   * character.
   *
   * A closed union rather than a string. The value goes straight out as an
   * OpenAI Realtime voice identifier, so a typo used to compile, ship, and then
   * fail the session remotely -- the furthest possible point from the mistake.
   */
  readonly voice: VoiceName
  /**
   * Whether her words are shown beside her while she speaks.
   *
   * Per character and OFF by default, which is the v1 design's call and worth
   * keeping: a bubble is words over somebody's desktop, and a companion that
   * subtitles itself by default has decided for them.
   */
  readonly bubble: boolean
  /**
   * Which side of her those words sit on. `auto` is "wherever it fits".
   *
   * ## It moved here from `preferences.json`, and the old argument is overruled
   *
   * `readBubbleSide` used to hold it app-level, on the grounds that it is "a
   * fact about this screen and this desk, not about who she is. Wearing
   * somebody else should not move her speech to the other side." That reads
   * well and it split one feature across two tabs: WHETHER she shows words is
   * this character's (`bubble`, directly above), and WHERE they went was
   * everybody's — so a character with the bubble off still had a live side
   * control governing nothing anybody could see.
   *
   * ## There is no "nobody has been asked", and there was for one commit
   *
   * This was `BubbleSide | null`, so a character nobody had touched could fall
   * back to the app-level value the field replaced. It made the control lie:
   * every untouched persona showed the same inherited side, so a setting
   * advertised as per-character behaved globally until somebody changed it —
   * which is the behaviour the move was meant to end, reintroduced invisibly.
   *
   * A control has to show a value somebody could have set, and that value has
   * to be the one in force. Three states where a person can perceive one is not
   * a model, it is a place for them to be wrong. So: one state, defaulting to
   * `auto`, which is what almost everybody wants and what the setting it
   * replaces was already set to.
   */
  readonly bubbleSide: BubbleSide
  /**
   * How big she is drawn, overriding what her face declares. Null to accept it.
   *
   * The FACE already says a size — that is what stopped it being a code change.
   * What was missing is somebody being able to disagree with it without editing
   * a file by hand, which is the exact thing the face format exists to prevent
   * one level up. Per character rather than per install, because the value it
   * overrides is per character: a tiny sprite and a large figure want different
   * answers, and one global number would fight whichever face it did not suit.
   */
  readonly size: number | null
  /**
   * Character and manner, sent as `session.instructions`.
   *
   * Two constraints belong here that text chat never needs: no emoji and no
   * markdown. Both get READ ALOUD — a list turns into "asterisk", and the model
   * will not avoid them on its own.
   */
  readonly style: string
  /**
   * Which avatar file she wears, or null for the built-in mochi.
   *
   * A REFERENCE, not a face. The face is validated in main and reaches the
   * renderer through `Appearance`; storing one here would put a second copy of
   * the geometry inside every persona, and a persona written before the avatar
   * was retuned would carry the old shape forever.
   *
   * The value is a filename STEM -- `blueberry` for `blueberry.json`. Avatars
   * are already identified by filename (see `parseFaceSpec`, where `name` is
   * explicitly a label rather than an identity), so this reuses identity that
   * exists rather than inventing a second scheme.
   *
   * The asymmetry with `id` is deliberate and has a mechanism behind it: a
   * persona's id keys its MEMORY, so a rename there orphans data. An avatar
   * owns nothing, so a stale reference costs only a fallback and a report.
   *
   * Constrained to the same grammar as `id` because it is joined into a path.
   * Safe by construction beats sanitised: there is no `..`, no separator and no
   * dot in the grammar, so no caller has to remember to strip them.
   */
  readonly avatarId: string | null
  /**
   * Which of her eight faces this character uses, in `EMOTIONS` order.
   *
   * All of them unless the manifest narrows it. She is offered `set_expression`
   * with exactly this list as its enum, so a face left out is not merely
   * discouraged — it is never on the wire and she cannot reach for it.
   */
  readonly faces: readonly Emotion[]
  /** How she says hello when she wakes. */
  readonly greeting: SpokenMoment
  /** How she signs off before going back to sleep. */
  readonly farewell: SpokenMoment
  // Retention -- whether what is said gets written down, and for how long --
  // deliberately is NOT here. It lives in `@shared/policy`, filed under her id
  // beside her memory, because it is state that comes of USING her rather than
  // something written in her package: it must survive her package being
  // updated, and it must die with her. Keeping it in the manifest also let a
  // package author decide, in a field nobody reads before installing, whether
  // somebody's conversations are written to disk.
}

export const DEFAULT_PERSONA: Persona = {
  version: PERSONA_FORMAT,
  id: 'mochi',
  name: 'Mochi',
  // Empty rather than the word "you": there is no name until somebody sets one,
  // and a placeholder that reads as a name produces "Greet you".
  addressUser: '',
  // The spike's choice, which is as good a starting point as any and is a
  // persona property rather than a global setting.
  voice: 'ballad',
  // Off, per the design. `PERSONA_FIELDS` is derived from this object, so
  // adding it here is also what stops `bubble` reading as an unknown field.
  bubble: false,
  bubbleSide: 'auto',
  // Null: accept whatever her face declares.
  size: null,
  pronoun: 'she',
  theme: DEFAULT_THEME,
  // Character only -- and the speech rules are part of that character rather
  // than a layer under it. There is no `SPOKEN_OUTPUT_RULES` and no
  // machine-level default behind every persona: how she speaks is written into
  // `CORE_PROMPT` below and composed with `style`, so a persona that wants a
  // different manner says so instead of fighting one.
  //
  // NO COLOUR AND NO SPECIES, and both absences are deliberate.
  //
  // Colour was here as "small green mochi", broke the moment somebody picked
  // sky or lilac, and was moved out to be derived from the theme instead. That
  // fix took the second-best option: measured across 149 of her turns, 14% of
  // them recited the colour back, because being told what she looks like is an
  // invitation to describe it. She has no need to know, so she is not told.
  //
  // "Mochi" as a species went the same way. It made the name and the creature
  // the same word, so renaming her forced a choice between "a small Loki"
  // and a separate declarative sentence -- and the separate sentence is what
  // cost 17% of her turns to self-description. "A small companion" needs
  // neither, and reads correctly for a persona that is not a mochi at all.
  // What she LOOKS like is the avatar's job, and the avatar already does it.
  //
  // `{name}` is a slot, not an appended line. See `wearName`.
  //
  // AND THE SPEECH RULES, because there is no longer anywhere else for them.
  // They used to be a machine-level default sitting behind every persona, and
  // that is the wrong place for them: how she speaks is character, not
  // installation. A tutor wants one language always; a companion wants the
  // language it heard. Those are different characters, not different machines.
  //
  // What survived the cut, and why the rest did not:
  //
  // - Length: REMOVED, at the user's instruction, after being defended twice
  //   and reworded once. The defence was that it shapes the default experience
  //   -- which is taste, and taste is the product owner's. The evidence that
  //   was mine to give had already gone the other way: every reply to a
  //   long-story request in the archive ran 5 to 12 sentences, so the rule was
  //   never what stopped her, and the thing it was protecting turned out not to
  //   need protecting.
  //
  //   The baseline it leaves, for whoever compares: with the rule, her turns
  //   ran median 2 sentences, 55% at two or fewer, p90 of 5, longest 22.
  // - Unclear audio: kept. The only item in OpenAI's realtime guide backed by
  //   a measurement -- they report `unintelligible` beating `inaudible`.
  // - Language: REMOVED at the user's instruction. OpenAI's guide says to write
  //   one explicitly, and the failure it names -- switching on ACCENT rather
  //   than on words -- has happened to this user four times: "Do you remember
  //   the last section?" asked in English, answered in Chinese.
  //
  //   All four were 13-15 August, and NONE on the 16th across ten sessions.
  //   That looks like the rule working and is not evidence of it: this
  //   repository was initialised on the 16th, so those conversations came from
  //   a different codebase with a different model and a different session
  //   config. The archive spans the change; git cannot see across it.
  //
  //   So it is removed on the honest position rather than on a proven one, and
  //   it lives in the seed where restoring it is one line. What to watch: an
  //   English question answered in Chinese.
  // - "Speaking aloud, not writing" and "no emoji or markdown": DROPPED. Zero
  //   occurrences in 149 real turns, and the one injection path that could
  //   have carried markdown cannot: `runDelegation` sends `spoken` only, which
  //   `--output-schema` constrains to a sentence, while `detail` never leaves
  //   main's console. Those rules were defending the voice model against the
  //   Codex agent's output, which structurally cannot reach it.
  //
  // THE SEED, not the floor. `CORE_PROMPT` carries her identity and the honesty
  // line unconditionally; everything here is a starting point somebody may
  // rewrite or clear. That split is what stops one edit freezing the whole
  // prompt against every later improvement -- see `CORE_PROMPT`.
  style: [
    'You have opinions of your own and you offer them, and you are talking with someone rather than serving them.',
    'Answer only what you heard clearly. If it was unintelligible, say so and ask for it again.',
  ].join(' '),
  avatarId: null,
  /*
    All eight. `PERSONA_FIELDS` is derived from this object, so listing it here
    is also what stops `faces` reading as an unknown field — the same mechanism
    the comment on `bubble` above describes.
  */
  faces: EMOTIONS,
  greeting: {
    instruction: 'as though they just came back',
    verbatim: null,
  },
  farewell: {
    instruction: 'warm, not formal',
    verbatim: null,
  },
}

/**
 * Bounds on the free-text fields.
 *
 * Not tidiness. Every one of these strings is concatenated into a system prompt
 * and sent over the wire on every wake, so an unbounded field is an unbounded
 * request: paste a novel into `style` and each session carries it, billed, on
 * every reconnect. The numbers are generous for anything a person types on
 * purpose and refuse what only a paste or a bug produces.
 */

export const PERSONA_LIMITS = {
  id: 64,
  name: 60,
  addressUser: 60,
  style: 4000,
  /**
   * Not a field of a persona -- the bound for whatever stores memory.
   *
   * Kept here because the REASON is the same as for every other entry: the
   * string is concatenated into a system prompt and sent on every wake, so an
   * unbounded one is an unbounded request.
   *
   * ENFORCED by `store/memory.ts`, in both `recall` and `remember`. The note
   * here used to say the store that would enforce it was not built -- it has
   * been for some time, and a comment claiming a limit is unenforced is worse
   * than none: it invites the next person to add a second check.
   */
  memory: 20_000,
  instruction: 300,
  verbatim: 300,
} as const

/**
 * Every side her words can be asked to sit on.
 *
 * Here rather than in `store/worn.ts`, which is main-only: this is a persona
 * field now, and her sheet in the renderer draws the choice.
 *
 * `auto` is the ABSENCE of a preference among the four, not a fifth place — a
 * side that will not fit is never honoured, so `auto` is what everything falls
 * back to anyway. It is in the list because somebody has to be able to choose
 * it back.
 */
export const BUBBLE_SIDES = ['auto', 'above', 'below', 'left', 'right'] as const
export type BubbleSide = (typeof BUBBLE_SIDES)[number]

/**
 * What the sides are called to a person, in the ONE place both surfaces read.
 *
 * "Above her" rather than "above", because the choice is about where she speaks
 * from and not about a corner of a box. The tray menu has said it this way for
 * a long time; her sheet invented a blunter set — `above`, `left` — the moment
 * it grew the same control, so one setting was named two ways in two places.
 *
 * `auto` is a sentence rather than a word for the same reason: it is not a
 * fifth direction, it is the absence of a preference among the four, and
 * "wherever it fits" says that where "auto" leaves somebody guessing.
 */
export const SIDE_NAMES: Readonly<Record<BubbleSide, ByPronoun>> = {
  auto: { she: 'Wherever it fits', he: 'Wherever it fits', it: 'Wherever it fits' },
  above: { she: 'Above her', he: 'Above him', it: 'Above it' },
  below: { she: 'Below her', he: 'Below him', it: 'Below it' },
  left: { she: 'To her left', he: 'To his left', it: 'To its left' },
  right: { she: 'To her right', he: 'To his right', it: 'To its right' },
}
