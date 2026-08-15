import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { createCanvas } from '@napi-rs/canvas'
import { describe, expect, it } from 'vitest'
import { LOCALE_TAGS, messagesFor } from '@shared/i18n'
import { PRONOUNS, forPronoun } from '@shared/pronoun'

/**
 * The label column is a fixed width, so a translation can outgrow it.
 *
 * `.field` uses one fixed column precisely so controls line up down the window
 * however long a translation runs — which trades a wrapping label for a
 * misaligned form, and takes the wrap. It shipped at 11ch against a widest
 * label of 11.1ch, so "Refer to them as" wrapped onto a second line and left
 * "as" hanging under a select that stayed aligned to the first line. Nothing
 * caught it because nothing measured it; it was found by looking at a
 * screenshot.
 *
 * Text is measured with a real metric rather than counted in characters:
 * "Refer to them as" and "或者固定说" are 16 and 5 characters and nearly the
 * same width, so a character count answers the wrong question entirely.
 *
 * The measurement is approximate and knowingly so. This runs against a generic
 * sans, while the app renders in Archivo, which is wider — so the assertion
 * carries an explicit margin rather than pretending to be exact. What it
 * reliably catches is the thing that actually happens: somebody adds a locale,
 * or a pronoun rewords a label, and it no longer fits.
 */
const TOKENS = readFileSync(fileURLToPath(new URL('./tokens.css', import.meta.url)), 'utf8')

/** The declared column width, read from the token rather than restated. */
function labelColumnCh(): number {
  const match = /--label-col:\s*([\d.]+)ch/.exec(TOKENS)
  expect(match, 'the sheet no longer declares a ch-based label column').not.toBeNull()
  return Number(match![1])
}

/**
 * Every string that lands in the label column, across locales and pronouns.
 *
 * Built from the real message tables, so a new LOCALE is covered the day it is
 * added rather than the day somebody remembers to list it here. The set of
 * labels is still listed by hand, which is this guard's soft spot and worth
 * naming: three of them -- the credential source, the key, her colour -- had
 * been sitting in the column unmeasured, and the omission is invisible because
 * a label nobody sweeps simply never fails.
 *
 * Anything passed to `field()` belongs here. Anything NOT in a `.field`
 * deliberately does not: the shortcut labels are sentences rather than names
 * ("Wake them, or let them sleep" is 19.6ch) and live in their own list for
 * exactly that reason -- see `panes/shortcuts.ts`.
 */
function labels(): readonly string[] {
  const all: string[] = []
  for (const tag of LOCALE_TAGS) {
    const t = messagesFor(tag).settings
    all.push(t.name, t.addressUser, t.size, t.voice, t.verbatim)
    all.push(t.authSource, t.authKeyLabel, t.soundEcho)
    // The delegation pane's labels. Added when that pane was, because a label
    // nobody sweeps simply never fails -- which is the soft spot this file's
    // own comment names, and it is only a soft spot while somebody keeps
    // forgetting to widen it.
    all.push(
      t.delegationModel,
      t.delegationEffort,
      t.delegationTrigger,
      t.delegationSearch,
      t.delegationTrust,
      t.delegationPrompt,
      t.spokenRules,
      t.personaStyle,
    )
    for (const pronoun of PRONOUNS) {
      all.push(forPronoun(t.pronoun, pronoun), forPronoun(t.instruction, pronoun))
      all.push(forPronoun(t.colour, pronoun))
      all.push(forPronoun(t.soundListening, pronoun), forPronoun(t.soundTurn, pronoun))
    }
  }
  return all
}

function widthInCh(text: string): number {
  const ctx = createCanvas(8, 8).getContext('2d')
  ctx.font = '13px sans-serif'
  return ctx.measureText(text).width / ctx.measureText('0').width
}

/**
 * Every string that appears ON a button.
 *
 * Listed by hand like `labels()` above, and with the same soft spot: an
 * unswept label simply never fails. Both lists are the reason the guards
 * exist, so both are worth keeping honest.
 */
function buttons(): readonly string[] {
  const all: string[] = []
  for (const tag of LOCALE_TAGS) {
    const t = messagesFor(tag).settings
    all.push(
      t.personaWear,
      t.personaAdd,
      t.personaDelete,
      t.personaDeleteCancel,
      t.personaRestore,
      t.useDefault,
      t.personaReveal,
      t.authCheck,
      t.authKeySave,
      t.authKeyClear,
      // The kept pane, which this list had never covered -- nine labels in a
      // shipped pane that the floor had therefore never been measured against.
      // Its danger buttons are REPLACED IN PLACE when armed, so a confirm
      // wider than its resting label shoves the buttons beside it sideways on
      // the first click.
      t.keptForget,
      t.keptForgetConfirm,
      t.keptForgetNotes,
      t.keptForgetOne,
      t.keptForgetAll,
      t.keptForgetAllConfirm,
      t.keptExport,
      t.keptImport,
      t.keptBack,
    )
  }
  return all
}

describe('the button width floor', () => {
  /** The declared floor, in `ch`, read from the token rather than restated. */
  function floorCh(): number {
    const match = /--button-min:\s*calc\(([\d.]+)ch/.exec(TOKENS)
    expect(match, 'the sheet no longer declares --button-min in ch').not.toBeNull()
    return Number(match![1])
  }

  it('is wide enough that ordinary labels do not stretch it', () => {
    // A button wider than the floor is a button that broke the row it sits in.
    // These are the labels that appear beside each other -- Save by Revert,
    // Wear by Delete -- and a row whose widths track word lengths reads as
    // ragged rather than as a set.
    const floor = floorCh()
    const over = buttons()
      .map((text) => ({ text, ch: widthInCh(text) * 1.15 }))
      .filter((label) => label.ch > floor)
      .map((label) => `${label.text} needs ~${label.ch.toFixed(1)}ch`)
    expect(over, `button floor is ${floor}ch:\n${over.join('\n')}`).toEqual([])
  })

  it('is not so wide that a two-character button becomes a slab', () => {
    // The other direction, and the reason this is a FLOOR rather than one
    // width for everything: 「保存」 is 2.7ch. Sizing every button for the
    // longest sentence in either language leaves most of them mostly empty.
    const floor = floorCh()
    const widest = Math.max(...buttons().map((text) => widthInCh(text) * 1.15))
    expect(floor - widest, `widest button label is ~${widest.toFixed(1)}ch`).toBeLessThan(4)
  })

  it('leaves the destructive confirmation longer on purpose', () => {
    // "Delete for good?" is deliberately NOT in the swept list. It is the one
    // button whose job is to be read rather than aimed at, and letting it grow
    // past its neighbours is the point -- a confirm that matches the button
    // beside it is a confirm you can hit by muscle memory.
    const confirm = messagesFor('en').settings.personaDeleteConfirm
    expect(widthInCh(confirm) * 1.15).toBeGreaterThan(floorCh())
  })
})

describe('the field label column', () => {
  /**
   * How much wider the real typeface may be than the one measured here.
   *
   * Not a fudge factor chosen to make the test pass: 11ch held a label
   * measuring 11.1ch here and still wrapped in Archivo, so the true stack is at
   * least ~10% wider than this metric. 1.15 keeps a margin beyond that.
   */
  const TYPEFACE_MARGIN = 1.15

  it('fits every label in every locale, for every pronoun', () => {
    const column = labelColumnCh()
    const tooWide = labels()
      .map((text) => ({ text, ch: widthInCh(text) * TYPEFACE_MARGIN }))
      .filter((label) => label.ch > column)
      .map((label) => `${label.text} needs ~${label.ch.toFixed(1)}ch`)
    expect(tooWide, `label column is ${column}ch:\n${tooWide.join('\n')}`).toEqual([])
  })

  it('is not wider than it needs to be', () => {
    // The other direction. A column with 5ch of slack pushes every control
    // right for no reason, and a fixed column nobody re-measures only ever
    // grows.
    const column = labelColumnCh()
    const widest = Math.max(...labels().map((text) => widthInCh(text) * TYPEFACE_MARGIN))
    expect(column - widest, `widest label is ~${widest.toFixed(1)}ch`).toBeLessThan(3)
  })
})

/**
 * Two buttons in one section must not read the same.
 *
 * The width guard cannot see this: shortening a label to fit is exactly what
 * produces it. Both of these sit in "Her conversations", separated by one hint
 * paragraph, and the whole point -- quoted in `kept.ts` between them --
 * is that they are separate actions: clearing what she remembers must not be a
 * way to lose the history, nor the reverse. Two buttons reading "Delete" there
 * is that confusion, arrived at by trying to fix a different one.
 */
describe('buttons that sit together say different things', () => {
  it.each(LOCALE_TAGS)('%s keeps the two kept-pane deletions apart', (tag) => {
    const t = messagesFor(tag).settings
    expect(t.keptForget).not.toBe(t.keptForgetNotes)
  })

  /** The armed label replaces the resting one IN PLACE, so both must fit. */
  it.each(LOCALE_TAGS)('%s keeps a confirm no wider than the floor', (tag) => {
    const t = messagesFor(tag).settings
    const floor = Number(/--button-min:\s*calc\(([\d.]+)ch/.exec(TOKENS)![1])
    for (const confirm of [t.keptForgetConfirm, t.keptForgetAllConfirm]) {
      // A confirm wider than the floor grows the button on the first click and
      // shoves its neighbours sideways -- which is what the floor is for.
      expect(widthInCh(confirm) * 1.15, confirm).toBeLessThanOrEqual(floor)
    }
  })
})
