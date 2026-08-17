/**
 * Whether what she says is written down, and for how long.
 *
 * ## Why this is not part of `Persona`
 *
 * The same argument memory makes, stated directly: this is
 * state that comes of USING her, not something written in her package. That
 * decides two things at once, and neither works if it lives in the manifest.
 *
 * It has to survive her package being updated. An author shipping v2 of a
 * tutor must not be able to turn somebody's transcript storage back on, and
 * with the policy inside the manifest "update" and "reset their privacy
 * choice" are the same write.
 *
 * And it has to die with her. Ids are DERIVED from names, so `ada` is handed
 * out again once nothing holds it — a new persona inheriting a stranger's
 * retention setting is the same class of fault as inheriting their notes.
 *
 * There is a third consequence worth naming, because it was an open worry
 * until this moved out: a package cannot declare a retention policy. A
 * downloaded persona whose author wrote `keeps: false` would be making a
 * decision on the user's behalf, in a field nobody reads before installing.
 *
 * That holds because `parsePersona` accepts those fields ONLY from a manifest
 * older than the current format, where they are somebody's own setting being
 * carried across. A current manifest carrying them is refused as an unknown
 * field. Without that gate the sentence above was simply untrue: any package
 * could supply them and seed a policy on first load.
 *
 * The type lives in `shared` because the settings window has to render it and
 * main has to enforce it. The FILE lives in `main/store/policy.ts` — the same
 * split every other stored thing here uses.
 */

/** How long history may be kept. */
export interface Policy {
  /**
   * Whether the conversation is written to disk at all.
   *
   * BOTH sides of it. A stored session holds `her` turns and `you` turns, so
   * describing this as "her side" understated what it switches on -- the same
   * mistake the tray and the pane made in words the user could read.
   */
  readonly keeps: boolean
  /**
   * How many days of it to keep. `null` keeps everything.
   *
   * Separate from `keeps` rather than folded in as a zero: "keep nothing" is
   * already said by the switch, and a duration that can also mean "off" is one
   * that turns itself off when somebody drags it too far.
   */
  readonly keepDays: number | null
}

/**
 * What applies when nobody has chosen.
 *
 * Keep, and keep indefinitely. This is what the app did before the switch
 * existed, and turning it off for everyone who never opened the pane would be
 * a silent data change in the other direction. One default governs everyone,
 * including a persona that came from somewhere else; that is deliberately not
 * split, and the cost is carried elsewhere.
 */
/**
 * How long a conversation may be kept, as the values the pane offers.
 *
 * In `shared/` beside the policy rather than in the renderer, because the
 * message table is keyed by them: the two lists were written out separately,
 * so adding a duration meant remembering a file that has no other reason to be
 * opened -- and a translation missing for it is a blank option rather than an
 * error. `forever` is the absence of a limit, expressed as `keepDays: null`.
 */
export const KEEP_DAYS = ['7', '30', '90', 'forever'] as const
export type KeepChoice = (typeof KEEP_DAYS)[number]
/** The numbered ones, which are what the message table has to translate. */
export type KeepDays = Exclude<KeepChoice, 'forever'>

export const DEFAULT_POLICY: Policy = { keeps: true, keepDays: null }

/**
 * What applies when a choice EXISTS and cannot be read.
 *
 * Not the default, and the distinction is the point. Absent means nobody has
 * chosen, so the app's answer applies. Unreadable means somebody's preference
 * is there and unavailable, and resolving it as "keep" would settle an
 * unreadable privacy choice in the one direction that produces data they may
 * have asked not to have.
 */
export const UNREADABLE_POLICY: Policy = { keeps: false, keepDays: null }

/**
 * The two fields somebody wrote, if they are the two fields this understands.
 *
 * Whole-or-nothing rather than field-by-field defaulting: half a policy is a
 * setting the user did not choose, and the caller has a considered answer for
 * "this file is not a policy" that is better than a guessed field.
 */
export function parsePolicy(value: unknown): Policy | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
  const source = value as Record<string, unknown>
  const keeps = source['keeps']
  if (typeof keeps !== 'boolean') return null
  const keepDays = source['keepDays']
  const daysOk =
    keepDays === null ||
    (typeof keepDays === 'number' && Number.isInteger(keepDays) && keepDays >= 1)
  if (!daysOk) return null
  return { keeps, keepDays }
}
