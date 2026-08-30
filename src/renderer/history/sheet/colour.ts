/**
 * What every section of her sheet is built from: a heading, and a row of
 * choices where exactly one is current.
 *
 * Below the sections rather than beside them. `shelf.ts` holds the ORDER the
 * sections appear in and imports each one; each one needs this vocabulary, so
 * leaving it in `shelf.ts` would have made every section import the file that
 * imports it.
 */

import { SAYS } from '../shelf-says'
import { element } from '../../element'
import { faceTile } from './face-tile'
import { type ShelfHandlers, section } from './row'
import { type ShelfCharacter, type ShelfView } from '@shared/history-window'
import { forPronoun } from '@shared/pronoun'
import { THEME_IDS, applyTheme } from '@shared/theme'
/**
 * Her colour, drawn as her.
 *
 * Eight swatches, each one HER at that theme rather than a square of paint:
 * the theme changes a face, so the face is what a person is choosing between.
 * `applyTheme` is the same function main applies when it resolves her, so the
 * swatch cannot show a colour the app would not use.
 *
 * An avatar FILE wins, and the section says so rather than offering swatches
 * that do nothing — see `resolveFaceFor`, which applies a theme only over the
 * built-in because `parseFaceSpec` requires all five colour fields and those
 * are somebody's deliberate choices.
 */
export function colourSection(
  view: ShelfView,
  worn: ShelfCharacter,
  handlers: ShelfHandlers,
): HTMLElement {
  if (view.faceSource !== null) {
    const said = element('p', 'note', forPronoun(SAYS.colourAuthored, view.pronoun))
    return section('Appearance', view.faceSource, said)
  }
  /*
    Named a file and did not get it, so there is nobody to paint.

    Each swatch is HER at that colour rather than a square of paint, which is
    the whole reason this grid is faces -- and with no face the grid would be
    eight built-in mochis standing in for her, beside a card the same view has
    just drawn as a dashed hole for saying she has none. See `SettingsPersona.face`.
  */
  if (worn.face === undefined) {
    const said = element('p', 'note bad', forPronoun(SAYS.colourMissing, view.pronoun))
    return section('Appearance', worn.avatarId ?? 'missing', said)
  }

  const grid = element('div', 'themes')
  for (const id of THEME_IDS) {
    const swatch = element('button', 'theme')
    swatch.type = 'button'
    swatch.title = id
    swatch.setAttribute('aria-current', String(id === worn.theme))
    swatch.append(faceTile(applyTheme(worn.face, id), 40))
    swatch.addEventListener('click', () => {
      if (id !== worn.theme) handlers.save({ id: worn.id, theme: id })
    })
    grid.append(swatch)
  }
  /*
    A hue of her own is SHOWN, not silently rounded to the nearest swatch.

    `Persona.theme` may be a `CustomTheme` object that no swatch can express, in
    which case `listPersonas` sends null. Lighting one of the eight would claim
    a value that is not stored, and clicking away from it would be the only way
    to find out it was never selected.
  */
  const body: HTMLElement[] = [grid]
  if (worn.theme === null) {
    body.push(element('p', 'note', forPronoun(SAYS.ownHue, view.pronoun)))
  }
  /*
    WHAT THE ROW DOES, which nothing on this screen said.

    Eight faces in a row with one of them in focus is a control whose meaning has
    to be inferred from the focus ring, and the consequence — that only SHE
    changes — is the half nobody can infer at all. v1's theme retinted the
    window, so somebody who used that build presses a swatch, sees the window
    stay grey, and reads a change that landed as one that did not.
  */
  body.push(element('p', 'note', forPronoun(SAYS.themeNote, view.pronoun)))
  /*
    The hint is which appearance she is WEARING, not where her file is.

    A1 puts the theme's own name there — "mint" — because the hint beside a
    heading answers "which one is in force", and a path answers a question the
    apparatus column is already answering.
  */
  return section('Appearance', worn.theme ?? forPronoun(SAYS.ownAppearance, view.pronoun), ...body)
}
