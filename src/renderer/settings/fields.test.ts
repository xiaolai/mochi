import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { descendants, structuralDocument, type FakeNode } from '../../test/structural-dom'
import { type Field } from '../field'
import { paneHandlers, settledView } from '../../test/settings-view'
import { PRONOUNS, label as paneLabel } from '@shared/pronoun'

/**
 * The one assertion that makes a declared field list safe to rely on.
 *
 * ## What breaks without it
 *
 * `Pane.fields` names everything on a pane somebody could search for, and
 * `render` draws it. Those are two lists of the same thing, and two lists of the
 * same thing drift — this repository has the scar twice over, in `panes-says.ts`
 * and in `pronoun-copy.test.ts`.
 *
 * Both directions cost something, and neither is visible by looking at the app:
 *
 * - **Declared, never drawn.** Search offers a result that scrolls to nothing.
 *   The window looks fine; the feature is broken for one entry, and only for
 *   whoever types the word that finds it.
 * - **Drawn, never declared.** The setting exists and search cannot find it.
 *   Nothing at all is wrong on screen. This is the failure that would
 *   accumulate quietly, one new setting at a time, until search is the thing
 *   people stop trusting — which is worse than not having it.
 *
 * So the panes are RENDERED here and the `data-field` anchors read back out of
 * what they produced, rather than either list being taken on trust.
 *
 * ## Why this can be a node test at all
 *
 * `structural-dom.ts` grew `addEventListener` for this — recorded, never fired.
 * Its own comment holds the line: bindings exist so a builder can be
 * constructed, never so behaviour can be asserted. Nothing below presses
 * anything, and the decisions these panes make that ARE worth testing live in
 * `rules/` as pure functions for exactly that reason.
 */

const dom = structuralDocument()

beforeEach(() => {
  vi.stubGlobal('document', dom.document)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

const { PANES } = await import('./panes')
const { MAY_DO } = await import('./pane/may-do')
const { herFields } = await import('../history/sheet/fields')

/*
  `MAY_DO` by name, because it is NOT in `PANES`.

  The grants are per character and live as view III of her page — `panes.ts`
  carries that argument at length. It is still a `Pane` and still holds four
  things somebody searches for, so leaving it out here would leave the one pane
  whose absence from `PANES` already surprised somebody untested.
*/
const ALL = [...PANES, MAY_DO]

/**
 * Every field the window indexes — the panes AND her sheet.
 *
 * `herFields` is not reachable through `PANES`, and that is the point: her sheet
 * is not a pane, so any invariant written over `PANES` silently covers half of
 * what search offers. See `sheet/fields.ts`.
 */
function everyFieldWithPane(): readonly { pane: string; field: Field }[] {
  const view = settledView()
  return [
    ...ALL.flatMap((pane) => pane.fields(view).map((field) => ({ pane: pane.id, field }))),
    ...herFields(null).map((field) => ({ pane: 'her sheet', field })),
  ]
}

function everyField(): readonly Field[] {
  return everyFieldWithPane().map((one) => one.field)
}

/** Every `data-field` in the tree, depth-first — the order a reader meets them. */
function anchorsIn(nodes: readonly FakeNode[]): readonly string[] {
  return nodes
    .flatMap((node) => [node, ...descendants(node)])
    .map((node) => node.attributes.get('data-field'))
    .filter((id): id is string => id !== undefined)
}

describe('what a pane says it holds, and what it draws', () => {
  it.each(ALL.map((pane) => [pane.id, pane] as const))(
    '%s draws exactly the fields it declares, in order',
    (_id, pane) => {
      const view = settledView()
      const drawn = pane.render(view, paneHandlers()) as unknown as readonly FakeNode[]
      /*
        IN ORDER, not as sets.

        A set comparison passes on a pane that declares its fields bottom to top,
        and the order is not cosmetic: search lists results in declaration order,
        so a list that disagrees with the page presents the third setting first
        and reads as a ranking somebody chose.
      */
      expect(anchorsIn(drawn)).toEqual(pane.fields(view).map((one) => one.id))
    },
  )

  it('gives every field in the WINDOW its own id, her sheet included', () => {
    /*
      EVERYTHING SEARCH INDEXES, not just the panes.

      `data-field` is what search scrolls to and the window holds one document,
      so two fields sharing an id send half the results to the wrong page. This
      ran over `PANES` alone — which is not what search indexes: her sheet is in
      the index too, and a collision between one of her ids and a pane's would
      have gone unnoticed by exactly the check written to prevent it.
    */
    const ids = everyField().map((one) => one.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('keeps her sheet’s index and the rendered gate’s manifest in step', () => {
    /*
      THE MANIFEST IS BOUND TO THE INDEX, which it was not.

      `jump-census` in the rendered gate walks her page and compares the drawn
      `data-field` anchors against a list written out in that script. Two lists,
      and the gate only ever compared each of them to the DOM — so deleting an
      entry from `herFields()` left the anchor drawn, the manifest satisfied and
      the check green, while search had silently lost the setting. An audit found
      it, correctly.

      The gate cannot import renderer source: it runs against the BUILT window,
      and importing the source would check the source against itself. So the
      binding is here, where both can be read, and it is what makes the gate's
      manifest mean something.

      `herFields(null)` — the built-in — because a manifest is about which
      sections exist, and that does not vary by character.
    */
    const manifest = readFileSync(
      fileURLToPath(new URL('../../../scripts/check-rendered.mjs', import.meta.url)),
      'utf8',
    )
    const listed = /const hers = \[([^\]]*)\]/.exec(manifest)?.[1] ?? ''
    const inGate = [...listed.matchAll(/'([\w-]+)'/g)].map((one) => one[1])
    expect(inGate.length, 'the gate’s her-page manifest could not be read').toBeGreaterThan(0)
    expect(inGate).toEqual(herFields(null).map((one) => one.id))
  })

  it('leaves no field without a label, in ANY pronoun', () => {
    /*
      EVERY PRONOUN, not just `she`.

      This read `.she` off a `ByPronoun` table, so a label with a filled `she`
      and an empty `he` would ship as a blank row in search for anyone wearing a
      character as `he` — and would pass here. The whole reason these labels are
      tables is that the window is not always about a `she`; a check that only
      ever looks at one of the three is checking the case that was never at risk.
    */
    for (const { pane, field } of everyFieldWithPane()) {
      for (const pronoun of PRONOUNS) {
        const said = paneLabel(field.label, pronoun)
        expect(said.trim(), `${pane} · ${field.id} · ${pronoun}`).not.toBe('')
      }
    }
  })
})
