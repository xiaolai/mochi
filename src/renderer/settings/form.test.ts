// @vitest-environment happy-dom
/**
 * Which control a field's label actually names.
 *
 * Three shapes arrive here and they need three answers: a bare control names
 * itself, a composite one hands the name to the control inside it, and a GROUP
 * cannot be named by `for` at all. Getting the third wrong killed a swatch
 * silently -- see `panes/screen.test.ts` -- and the obvious fix for it would
 * have broken the second.
 */

import { describe, expect, it } from 'vitest'
import { el, field, fieldProblem, forgetDrafts, select, textInput } from './form'

function controlFor(wrap: HTMLElement): HTMLElement | null {
  document.body.replaceChildren(wrap)
  const label = wrap.querySelector('label')
  return label?.control ?? null
}

describe('a select opens on the value it was given', () => {
  it('chooses the current one, wherever it sits in the list', () => {
    // Three options with the wanted one LAST is the case that failed. Marking
    // the option on the way in leaves the select to recompute its choice on
    // each insertion, and the answer depends on how many were already there --
    // an algorithm rather than a statement. The app had no three-option select
    // until the sound section, so nothing had ever exercised it.
    for (const wanted of ['low', 'auto', 'high'] as const) {
      const node = select(
        ['low', 'auto', 'high'] as const,
        (v) => v,
        wanted,
        () => undefined,
      )
      document.body.replaceChildren(node)
      expect(node.value, `asked for ${wanted}`).toBe(wanted)
    }
  })

  it('reports the new value when somebody changes it', () => {
    const seen: string[] = []
    const node = select(
      ['on', 'off'] as const,
      (v) => v,
      'on',
      (next) => seen.push(next),
    )
    document.body.replaceChildren(node)
    node.value = 'off'
    node.dispatchEvent(new Event('change'))
    expect(seen).toEqual(['off'])
  })
})

describe('a field names the control a reader would click', () => {
  it('names a bare control directly', () => {
    const input = el('input', { type: 'text' })
    expect(controlFor(field('name', 'Name', input))).toBe(input)
    expect(input.id).toBe('name')
  })

  it('reaches into a composite and names the control inside it', () => {
    // The size slider and the key field: a wrapping div holding the real
    // control plus a readout or some buttons. `for` on the div names nothing,
    // and a screen reader announced these as an unlabelled slider and an
    // unlabelled text box.
    const input = el('input', { type: 'range' })
    const wrap = el('div', {}, [input, el('span', {}, [document.createTextNode('100%')])])
    expect(controlFor(field('size', 'Size', wrap))).toBe(input)
  })

  it('still reaches in when the composite holds several controls', () => {
    // The key field is an input AND two buttons. A rule of "only reach in when
    // there is exactly one control" would read as the safe fix here and would
    // silently un-label this one.
    const input = el('input', { type: 'password' })
    const composite = el('div', {}, [input, el('button', {}), el('button', {})])
    expect(controlFor(field('key', 'API key', composite))).toBe(input)
  })

  it('leaves a control that already has an id of its own', () => {
    // The defect, at its own level. Renaming this one would break whatever
    // already points at `mine` -- for the swatches, its own visible label.
    const owned = el('input', { type: 'radio', id: 'mine' })
    const group = el('div', {}, [owned])
    field('theme', 'Colour', group)
    expect(owned.id).toBe('mine')
  })

  it('names a radiogroup by reference, touching nothing inside it', () => {
    const first = el('input', { type: 'radio', id: 'theme-moss' })
    const group = el('div', { role: 'radiogroup' }, [first])
    const wrap = field('theme', 'Colour', group)
    document.body.replaceChildren(wrap)

    expect(first.id).toBe('theme-moss')
    const named = group.getAttribute('aria-labelledby')
    expect(named).toBeTruthy()
    expect(document.getElementById(named ?? '')?.textContent).toBe('Colour')
    // And the group itself still answers to the field id, which is what
    // callers were promised.
    expect(group.id).toBe('theme')
  })
})

/**
 * The commit rules at control level.
 *
 * There is no Save button any more, so these events ARE the save. Each case
 * below is a way the sheet used to lose an edit or invent one.
 */
describe('a box commits when you leave it', () => {
  function mount(hold: string, value: string): [HTMLInputElement, string[]] {
    const sent: string[] = []
    const input = textInput(hold, value, (next) => sent.push(next))
    document.body.replaceChildren(field(hold, 'Label', input))
    return [input, sent]
  }

  it('sends nothing while you are still typing', () => {
    const [input, sent] = mount('a/name', 'Mochi')
    input.value = 'Mochi '
    input.dispatchEvent(new Event('input'))
    input.value = 'Mochi 2'
    input.dispatchEvent(new Event('input'))
    // Per keystroke would be a catalog re-read and an IPC round trip each, and
    // a prompt field handed to her half-typed.
    expect(sent).toEqual([])
  })

  it('sends once when the box is left', () => {
    const [input, sent] = mount('b/name', 'Mochi')
    input.value = 'Ada'
    input.dispatchEvent(new Event('input'))
    input.dispatchEvent(new Event('blur'))
    expect(sent).toEqual(['Ada'])
  })

  it('does not send a value nobody changed', () => {
    const [input, sent] = mount('c/name', 'Mochi')
    input.dispatchEvent(new Event('blur'))
    input.dispatchEvent(new Event('change'))
    expect(sent).toEqual([])
  })

  it('sends the ORIGINAL value back when it is typed again', () => {
    // The bug this rule exists for. A persona save is not broadcast, so nothing
    // repaints and the node lives on holding the value it was built with.
    // Comparing against that: Mochi → Ada → Mochi sends only the first change,
    // and she stays Ada on disk while the box in front of you says Mochi.
    const [input, sent] = mount('d/name', 'Mochi')
    input.value = 'Ada'
    input.dispatchEvent(new Event('blur'))
    input.value = 'Mochi'
    input.dispatchEvent(new Event('blur'))
    expect(sent).toEqual(['Ada', 'Mochi'])
  })

  it('does not send twice for one departure', () => {
    // `change` and `blur` both fire when a box is left with the keyboard.
    const [input, sent] = mount('e/name', 'Mochi')
    input.value = 'Ada'
    input.dispatchEvent(new Event('change'))
    input.dispatchEvent(new Event('blur'))
    expect(sent).toEqual(['Ada'])
  })
})

describe('what a box holds across a repaint', () => {
  it('keeps text that has not been stored yet', () => {
    // A broadcast rebuilds the pane from main's snapshot. Without the hold,
    // whatever was on screen is gone -- to a repaint the user did not cause and
    // could not see coming.
    const first = textInput('f/name', 'Mochi', () => undefined)
    document.body.replaceChildren(first)
    first.value = 'Ad'
    first.dispatchEvent(new Event('input'))

    const second = textInput('f/name', 'Mochi', () => undefined)
    expect(second.value).toBe('Ad')
  })

  it('lets go once the stored value has caught up', () => {
    const first = textInput('g/name', 'Mochi', () => undefined)
    document.body.replaceChildren(first)
    first.value = 'Ada'
    first.dispatchEvent(new Event('input'))

    // The round trip completed: main now holds Ada, so the hold is spent.
    expect(textInput('g/name', 'Ada', () => undefined).value).toBe('Ada')
    // And a later repaint with a value from somewhere else is not overridden.
    expect(textInput('g/name', 'Coach', () => undefined).value).toBe('Coach')
  })

  it('files text under the CHARACTER, not the box', () => {
    // The tray can switch persona with this window open. A key of
    // `name` alone would show A's half-typed name on B's sheet, then commit it
    // to B on the next blur -- which is the bug the whole-sheet draft store was
    // written to prevent, one field down.
    const mine = textInput('ada/name', 'Ada', () => undefined)
    document.body.replaceChildren(mine)
    mine.value = 'Ad'
    mine.dispatchEvent(new Event('input'))

    expect(textInput('coach/name', 'Coach', () => undefined).value).toBe('Coach')
    // Switching back brings it home.
    expect(textInput('ada/name', 'Ada', () => undefined).value).toBe('Ad')
  })

  it('throws it away when somebody asks for exactly that', () => {
    const box = textInput('h/name', 'Mochi', () => undefined)
    document.body.replaceChildren(box)
    box.value = 'Ad'
    box.dispatchEvent(new Event('input'))

    forgetDrafts(['h/name'])
    expect(textInput('h/name', 'Mochi', () => undefined).value).toBe('Mochi')
  })

  it('forgets only the holds it was named', () => {
    for (const hold of ['i/name', 'i/address']) {
      const box = textInput(hold, 'stored', () => undefined)
      document.body.replaceChildren(box)
      box.value = 'typed'
      box.dispatchEvent(new Event('input'))
    }
    forgetDrafts(['i/name'])
    expect(textInput('i/name', 'stored', () => undefined).value).toBe('stored')
    expect(textInput('i/address', 'stored', () => undefined).value).toBe('typed')
  })
})

describe('a field says why it will not save, beside itself', () => {
  function row(): HTMLInputElement {
    const input = textInput('j/name', 'Mochi', () => undefined)
    document.body.replaceChildren(field('name', 'Name', input, 'A hint.'))
    return input
  }

  it('names the reason and marks the control', () => {
    const input = row()
    fieldProblem('name', 'Name cannot be empty.')
    const note = document.querySelector('.field-error')
    expect(note?.textContent).toBe('Name cannot be empty.')
    expect(input.getAttribute('aria-invalid')).toBe('true')
    // Named, not merely coloured: red alone says nothing to a screen reader.
    // BOTH, in reading order. The hint says what the control is for and the
    // error says why this value will not save; a control can be described by
    // the two at once, and which one survives must not depend on which code
    // ran last.
    expect(input.getAttribute('aria-describedby')).toBe(`name-hint ${String(note?.id)}`)
  })

  it('sits above the hint, because it outranks it', () => {
    row()
    const texts = [...document.querySelectorAll('.field-error, .field-hint')].map(
      (node) => node.className,
    )
    expect(texts).toEqual(['field-hint'])
    fieldProblem('name', 'Name cannot be empty.')
    expect(
      [...document.querySelectorAll('.field-error, .field-hint')].map((node) => node.className),
    ).toEqual(['field-error', 'field-hint'])
  })

  it('clears everything it set', () => {
    const input = row()
    fieldProblem('name', 'Name cannot be empty.')
    fieldProblem('name', null)
    expect(document.querySelector('.field-error')).toBeNull()
    expect(input.hasAttribute('aria-invalid')).toBe(false)
    // Everything IT set, and nothing else. Clearing the error used to drop the
    // attribute outright, which silenced the field's hint too — permanently,
    // and only for the readers who depend on it being announced.
    expect(input.getAttribute('aria-describedby')).toBe('name-hint')
  })

  it('replaces rather than stacks', () => {
    row()
    fieldProblem('name', 'first')
    fieldProblem('name', 'second')
    expect(document.querySelectorAll('.field-error')).toHaveLength(1)
    expect(document.querySelector('.field-error')?.textContent).toBe('second')
  })

  it('does nothing at all for a control that is not on screen', () => {
    document.body.replaceChildren()
    expect(() => fieldProblem('gone', 'anything')).not.toThrow()
  })
})

/**
 * A hint that is drawn but not announced is a hint for everyone except the
 * people who most need the control described — and one of these says "the
 * microphone stays open and the session keeps billing".
 */
describe('a hint is announced, not only drawn', () => {
  it('points the control at it', () => {
    document.body.replaceChildren(
      field('sound-eagerness', 'When she answers', el('input'), 'How readily a pause ends a turn.'),
    )
    const input = document.getElementById('sound-eagerness')!
    expect(document.querySelector('.field-hint')?.id).toBe('sound-eagerness-hint')
    expect(input.getAttribute('aria-describedby')).toBe('sound-eagerness-hint')
  })

  /**
   * `labelable` declines to rename a control that already answers to an id,
   * and returns the wrapper instead. The label was written before that was
   * known, so it named the wrapper — and `for` on a `<div>` focuses nothing
   * and announces nothing.
   */
  it('names a control that came with its own id, without stealing it', () => {
    const inner = el('input', { id: 'theme-moss' })
    const wrapper = el('div', {}, [inner])
    document.body.replaceChildren(field('theme', 'Her colour', wrapper))

    // The id it arrived with is untouched, so whatever points at it still does.
    expect(inner.id).toBe('theme-moss')
    // And it is named by reference rather than left anonymous.
    expect(inner.getAttribute('aria-labelledby')).toBe('theme-label')
    expect(document.querySelector('label')?.id).toBe('theme-label')
    expect(document.querySelector('label')?.hasAttribute('for')).toBe(false)
  })
})

/**
 * A draft is kept until the store catches up with it. "Catches up" has to mean
 * what the store actually did, not what was typed: callers canonicalise before
 * storing — a box holding only spaces is stored as empty — so a raw comparison
 * never matched for those values and the draft outlived its own round trip,
 * reappearing on every repaint and resubmitting on every later blur.
 */
describe('a draft converges with a canonicalised value', () => {
  it('is dropped once the store holds the trimmed form of it', () => {
    const first = textInput('greeting', '', () => {})
    document.body.replaceChildren(first)
    first.value = '   '
    first.dispatchEvent(new Event('input'))
    first.dispatchEvent(new Event('blur'))

    // The store canonicalised it to empty. Rebuilding with that stored value is
    // the round trip completing.
    const second = textInput('greeting', '', () => {})
    expect(second.value, 'the whitespace draft survived its own commit').toBe('')
  })

  it('still keeps a draft the store has not caught up with', () => {
    const first = textInput('name', 'Mochi', () => {})
    document.body.replaceChildren(first)
    first.value = 'Ada'
    first.dispatchEvent(new Event('input'))

    // A repaint arriving before the save landed must not revert the box.
    const second = textInput('name', 'Mochi', () => {})
    expect(second.value).toBe('Ada')
  })
})
