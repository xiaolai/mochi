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
}

/*
  `keepDays` was here, and is gone.

  A number of days to keep, separate from the switch. It was validated,
  defaulted, filed per character and seeded from v1 personas — and read by
  nothing in `src/main`, ever. `Transcripts.pruneBefore` was the other half:
  implemented, transactional, secure-scrubbed, tested, and called by no one.

  Two comments in `transcripts.ts` reasoned carefully about how retention would
  behave, and the website told people their conversations were "kept for as long
  as you say". A feature that exists at every level except the one that runs it
  is the defect `dev-docs/plan-storage.md` is about; this was its largest
  instance.

  `KEEP_DAYS`, `KeepChoice` and `KeepDays` went with it — the durations a pane
  would have offered, placed here so a "message table keyed by them" could not
  drift. No such table was ever written, and no pane ever read the tuple. The
  precaution outlived the thing it was guarding, which is the same shape one
  level up.

  It is removed rather than finished by decision: conversations are kept until
  somebody deletes them. That makes deleting them by hand the whole mechanism
  rather than a promise on top of one, which is why it is being built.
*/

/**
 * What applies when nobody has chosen.
 *
 * Keep, and keep indefinitely. This is what the app did before the switch
 * existed, and turning it off for everyone who never opened the pane would be
 * a silent data change in the other direction. One default governs everyone,
 * including a persona that came from somewhere else; that is deliberately not
 * split, and the cost is carried elsewhere.
 */
export const DEFAULT_POLICY: Policy = { keeps: true }

/**
 * What applies when a choice EXISTS and cannot be read.
 *
 * Not the default, and the distinction is the point. Absent means nobody has
 * chosen, so the app's answer applies. Unreadable means somebody's preference
 * is there and unavailable, and resolving it as "keep" would settle an
 * unreadable privacy choice in the one direction that produces data they may
 * have asked not to have.
 */
export const UNREADABLE_POLICY: Policy = { keeps: false }

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
  /*
    A stored `keepDays` is IGNORED rather than refused.

    Files written before it was removed carry one, and refusing them would turn
    every existing policy unreadable — which `UNREADABLE_POLICY` resolves as
    "record nothing", so a tidy-up would silently stop saving anybody's
    conversations. An unknown key is not a broken file.
  */
  return { keeps }
}
