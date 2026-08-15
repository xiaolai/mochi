/**
 * How she looks: her colour, and how much of the screen she takes.
 *
 * Both apply on the spot rather than gathering into the draft. A swatch and a
 * size slider change something you are looking at, so "unsaved" would mean the
 * screen and the form disagreed about what she looks like.
 */

import { THEME_IDS, paletteFor } from '@shared/theme'
import { SIZE_PERCENT, layoutFor } from '@shared/avatar-layout'
import { format } from '@shared/i18n'
import type { ThemeId } from '@shared/theme'
import type { Persona } from '@shared/persona'
import type { SaveProblem, SettingsSnapshot } from '@shared/ipc'
import { silhouette } from '../../design/silhouette'
import { el, field, slider } from '../form'
import type { Copy } from '../copy'

/** What these controls need the window to do for them. */
export interface ScreenDeps {
  readonly act: (
    what: string,
    run: () => Promise<readonly SaveProblem[] | void>,
    after?: () => void,
  ) => void
  readonly showProblems: (problems: readonly SaveProblem[]) => void
  /** Keep the window's own copies in step once main has ACCEPTED a theme. */
  readonly adoptTheme: (theme: ThemeId, personaId: string) => void
  /** Re-read the snapshot, once the theme reply has been applied. */
  readonly refreshFromMain: () => Promise<void>
}

/**
 * Her colour, as swatches of the thing itself.
 *
 * A `<select>` of colour NAMES would be the smaller change and the wrong one:
 * "Lilac" is a word, and what somebody is choosing is a mochi. Each swatch is
 * painted from the theme's own palette — body, and the shading band beneath it
 * — so the control shows the answer rather than describing it.
 *
 * Radios in a group rather than buttons: this is one choice among several, the
 * arrow keys should move through it, and a screen reader should say so.
 */
export function colourPicker(
  { t, say }: Copy,
  person: Persona,
  snapshot: SettingsSnapshot,
  deps: ScreenDeps,
): HTMLElement {
  const swatches = THEME_IDS.map((id) => {
    const palette = paletteFor(id)
    const input = el('input', {
      type: 'radio',
      name: 'theme',
      class: 'swatch-input',
      id: `theme-${id}`,
      value: id,
    })
    input.checked = id === person.theme
    input.addEventListener('change', () => {
      deps.act('could not set the theme', async () => {
        const saved = await window.mochiSettings.saveTheme(id)
        deps.showProblems(saved.problems)
        // Adopted only if main ACCEPTED it. The local copies used to be
        // written unconditionally, so a refused theme left this window
        // believing she was that colour: the swatch stayed selected, and the
        // next persona save sent the rejected theme back as though it were
        // hers.
        if (saved.problems.length > 0) return
        // Kept in step locally as well. Main now holds the new theme, and a
        // later persona save built from a draft still carrying the old one
        // would quietly put her back.
        //
        // The ID comes back with it, because picking a colour for the BUILT-IN
        // forks her: her id is reserved, so the change is stored against a
        // copy. Taken from this reply rather than from the broadcast that
        // follows, so the window cannot process the two in the wrong order.
        deps.adoptTheme(id, saved.personaId)
        // Then everything else, in an order this window controls. Main
        // deliberately does not broadcast to us here: a snapshot arriving
        // before the reply would park a dirty draft under the persona we are
        // about to leave. Asking afterwards cannot race the answer we already
        // have.
        await deps.refreshFromMain()
      })
    })

    // HER shape, from the geometry that draws her, with the shading band. A
    // rounded rectangle would be a fourth place her likeness is drawn by eye,
    // and it drifts the first time anybody touches a shoulder exponent.
    const chip = silhouette({ ...snapshot.face, ...palette })

    const label = el('label', { class: 'swatch', for: `theme-${id}` }, [
      chip,
      el('span', { class: 'swatch-name' }, [document.createTextNode(t.themeName[id])]),
    ])
    return el('div', { class: 'swatch-cell' }, [input, label])
  })

  return field(
    'theme',
    say(t.colour),
    el('div', { class: 'swatches', role: 'radiogroup' }, swatches),
    t.colourHint,
  )
}

export function appearanceSection(
  { t, say }: Copy,
  snapshot: SettingsSnapshot,
  deps: ScreenDeps,
): HTMLElement {
  // Her real dimensions, not a number retyped into the copy of each locale.
  const body = layoutFor(snapshot.face, 100)
  // The handle is held HERE, by the code that built the control, rather than
  // published into module state for an async callback to find later.
  const size = slider(
    snapshot.sizePercent,
    SIZE_PERCENT,
    (value) => `${value}%`,
    (next) => {
      // Applied on the spot rather than gathered into the draft: this one
      // resizes a window, so "unsaved" would mean the screen and the form
      // disagreed about how big she is. Main resizes immediately and
      // writes the preference on a debounce.
      //
      // RECONCILED against main's answer, which is the accepted value
      // after clamping and may not be what was asked for. Fire-and-forget
      // left the readout asserting a size main had refused, and a
      // rejection here went nowhere at all.
      // Its failure is now SHOWN, not only logged. This was the block
      // that differed: a size that would not save left the slider where
      // the pointer put it and said nothing.
      deps.act('could not set the size', async () => {
        size.accepted(await window.mochiSettings.saveSize(next))
      })
    },
  )
  // No heading of its own. It is a section INSIDE the setup pane now, and the
  // pane titles all four of its blocks from one table so they cannot drift
  // into four different registers.
  return el('div', { class: 'section' }, [
    field(
      'size',
      t.size,
      size.node,
      format(say(t.sizeHint), {
        width: String(Math.round(body.bodyWidth)),
        height: String(Math.round(body.bodyHeight)),
      }),
    ),
  ])
}
