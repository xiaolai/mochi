// @vitest-environment happy-dom
/**
 * The pane that says what is on disk.
 *
 * Its two halves: whether text is written and for how long
 * are HERS, and where the file is and how big it is are this machine's. The
 * tests below are mostly about the destructive half, because that is the part
 * where being wrong costs something that cannot be undone.
 */

import { readFileSync } from 'node:fs'
import { describe, expect, it, beforeEach, vi } from 'vitest'
import { DEFAULT_PERSONA, type Persona } from '@shared/persona'
import { messagesFor } from '@shared/i18n'
import { forPronoun } from '@shared/pronoun'
import type { SettingsSnapshot } from '@shared/ipc'
import type { Policy } from '@shared/policy'
import type { KeptTurn } from '@shared/ipc'
import { keptPane, resetKeptBrowsing, sizeOf } from './kept'
import type { Copy } from '../copy'

const t = messagesFor('en').settings
const copy: Copy = {
  t,
  locale: 'en',
  pronoun: 'she',
  say: (table) => forPronoun(table, 'she'),
}

const calls: string[] = []
let stored: Policy[] = []
let armed: string | null = null
/** Pending `readSession` replies, when a test wants to control the timing. */
let held: (() => void)[] | null = null

/** What each conversation says, so a landing reply can be told from the other. */
function turnsFor(token: string): readonly KeptTurn[] {
  return token === 'two'
    ? [{ at: 9_010, who: 'her' as const, text: 'the second conversation' }]
    : [
        { at: 1_010, who: 'you' as const, text: 'hello' },
        { at: 1_020, who: 'her' as const, text: 'hello back' },
      ]
}

beforeEach(() => {
  calls.length = 0
  stored = []
  armed = null
  held = null
  resetKeptBrowsing()
  Object.defineProperty(window, 'mochiSettings', {
    value: {
      savePolicy: (policy: Policy) => {
        stored.push(policy)
        return Promise.resolve([])
      },
      forgetTranscripts: () => {
        calls.push('hers')
        return Promise.resolve([])
      },
      forgetMemory: () => {
        calls.push('notes')
        return Promise.resolve([])
      },
      forgetEverything: () => {
        calls.push('everything')
        return Promise.resolve([])
      },
      // Real rows, not empty lists. A conformance check over a pane that
      // rendered nothing would pass while checking nothing.
      listSessions: () =>
        Promise.resolve([
          { token: 'one', startedAt: 1_000, endedAt: 2_000, turns: 2 },
          { token: 'two', startedAt: 9_000, endedAt: 9_500, turns: 1 },
        ]),
      // Deferred when a test asks for it, so a response can land AFTER the
      // reader has moved on -- which is the only way to exercise the guards
      // that drop a stale one.
      readSession: (token: string) =>
        held === null
          ? Promise.resolve(turnsFor(token))
          : new Promise<readonly KeptTurn[]>((resolve) => {
              held?.push(() => {
                resolve(turnsFor(token))
              })
            }),
      searchTranscripts: () =>
        Promise.resolve([{ token: 'one', at: 1_010, who: 'you' as const, text: 'hello' }]),
      forgetSession: () => Promise.resolve([]),
      exportTranscripts: () => {
        calls.push('export')
        return Promise.resolve([])
      },
      importTranscripts: () => Promise.resolve({ kind: 'cancelled' as const }),
    },
    configurable: true,
  })
})

function render(
  policy: Policy = { keeps: true, keepDays: null },
  kept = { sessions: 3, turns: 40 },
  persona: Persona = DEFAULT_PERSONA,
): void {
  const snapshot = {
    persona,
    policy,
    memory: '',
    kept: { ...kept, bytes: 2048, where: '/tmp/mochi/transcripts.db' },
  } as SettingsSnapshot
  document.body.replaceChildren(
    ...keptPane(
      copy,
      snapshot,
      {
        act: (_: string, run: () => Promise<unknown>) => void run(),
        showProblems: vi.fn(),
      },
      {
        is: (what) => armed === what,
        arm: (what) => {
          armed = what
        },
        disarm: () => {
          armed = null
        },
      },
      () => {
        render(policy, kept, persona)
      },
    ),
  )
}

function press(text: string): void {
  const button = [...document.querySelectorAll('button')].find((b) => b.textContent === text)
  expect(button, `no button reading "${text}"`).toBeDefined()
  button?.click()
}

/** Let the pane's fetches land, so the list and a transcript are on screen. */
async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0))
}

describe('it uses the design system rather than inventing one', () => {
  /** Every class the two stylesheets define. */
  const defined = new Set(
    [
      // Read from the repository root rather than relative to this module:
      // Vitest serves the renderer over an http origin, so `import.meta.url`
      // is not a file URL here.
      readFileSync('src/renderer/settings/settings.css', 'utf8'),
      readFileSync('src/renderer/design/controls.css', 'utf8'),
    ]
      .join('\n')
      .match(/\.[a-z][a-z0-9-]*/g)
      ?.map((one) => one.slice(1)) ?? [],
  )

  it('emits no class the stylesheet has never heard of', async () => {
    // The check that would have caught the whole of this pane shipping
    // unstyled. It was written with invented names -- `kept-list`, `kept-row`,
    // `kept-turn` -- none of which existed in any stylesheet, so the browser
    // drew its defaults: bulleted list, boxed buttons, and two adjacent spans
    // with nothing between them. Types, tests and the build were all green,
    // because nothing here had ever been rendered.
    render()
    await settle()
    const used = new Set<string>()
    const collect = (): void => {
      for (const node of document.querySelectorAll('[class]')) {
        for (const one of node.classList) used.add(one)
      }
    }
    collect()
    // The list must actually have a row, or this check covers an empty pane.
    expect(document.querySelector('.kept-row')).not.toBeNull()

    // And the transcript, which only exists once a conversation is opened.
    document.querySelector<HTMLButtonElement>('.kept-row')?.click()
    await settle()
    collect()
    expect(document.querySelector('.kept-turn')).not.toBeNull()

    expect([...used].filter((one) => !defined.has(one))).toEqual([])
  })

  it('would notice a class the stylesheet does not define', () => {
    // The check on the check. Without this, a `defined` set that accidentally
    // matched everything would leave the test above passing for ever while
    // proving nothing -- which is the exact shape of the failure it exists to
    // catch.
    expect(defined.has('kept-row')).toBe(true)
    expect(defined.has('kept-row-invented-just-now')).toBe(false)
  })
})

describe('the conversation list', () => {
  it('follows the worn persona’s pronoun, like every other line', () => {
    // It said "Searches only her conversations" under a heading reading
    // "Conversations with him", because the hint reached into the table with
    // `.she` instead of going through `say`. The pronoun belongs to the
    // persona; nothing in this window is allowed to pick one for itself.
    const his: Copy = {
      t,
      locale: 'en',
      pronoun: 'he',
      say: (table) => forPronoun(table, 'he'),
    }
    document.body.replaceChildren(
      ...keptPane(
        his,
        {
          persona: DEFAULT_PERSONA,
          policy: { keeps: true, keepDays: null },
          memory: '',
          kept: { sessions: 0, turns: 0, bytes: 0, where: '/tmp/x.db' },
        } as SettingsSnapshot,
        { act: (_: string, run: () => Promise<unknown>) => void run(), showProblems: vi.fn() },
        { is: () => false, arm: () => undefined, disarm: () => undefined },
        () => undefined,
      ),
    )
    expect(document.body.textContent).toContain(t.keptSearchScope.he)
    expect(document.body.textContent).not.toContain(t.keptSearchScope.she)
  })

  it('keeps the moment and the count in separate cells', async () => {
    // They were adjacent spans with no stylesheet, so the row rendered as
    // `10:39 AM34 things said`. The gap that separates them is in the CSS, so
    // what this can pin is the shape it needs: two cells, each with its own
    // text, rather than one run-on string.
    render()
    await settle()
    const when = document.querySelector('.kept-row-when')?.textContent ?? ''
    const what = document.querySelector('.kept-row-what')?.textContent ?? ''
    expect(when).not.toBe('')
    expect(what).not.toBe('')
    expect(when).not.toContain(what)
  })
})

describe('the keeping policy', () => {
  it('offers keeping and not keeping, and edits the persona', () => {
    render()
    const node = document.getElementById('kept-on') as HTMLSelectElement
    expect(node.value).toBe('on')
    node.value = 'off'
    node.dispatchEvent(new Event('change'))
    // Stored on the spot. It is not a persona field any more (it is
    // used-state), and a privacy switch that waits for a Save button has a
    // failure mode where somebody believes storage is off while it is on --
    // which is exactly what this pane shipped with.
    expect(stored).toEqual([{ keeps: false, keepDays: null }])
  })

  it('hides the duration when nothing is being kept', () => {
    // A greyed control for a policy that cannot apply is a question with no
    // answer. Off means the row is not there.
    render({ keeps: false, keepDays: null })
    expect(document.getElementById('kept-days')).toBeNull()
    render({ keeps: true, keepDays: null })
    expect(document.getElementById('kept-days')).not.toBeNull()
  })

  it('never offers a duration that means off', () => {
    // The switch already says "keep nothing". A duration that also means it is
    // one that turns itself off when somebody drags it too far.
    render()
    const options = [...document.querySelectorAll<HTMLOptionElement>('#kept-days option')].map(
      (o) => o.value,
    )
    expect(options).toEqual(['7', '30', '90', 'forever'])
    expect((document.getElementById('kept-days') as HTMLSelectElement).value).toBe('forever')
  })

  it('turns a chosen duration into days, and forever into null', () => {
    render()
    const node = document.getElementById('kept-days') as HTMLSelectElement
    node.value = '30'
    node.dispatchEvent(new Event('change'))
    expect(stored).toEqual([{ keeps: true, keepDays: 30 }])

    render({ keeps: true, keepDays: 30 })
    const back = document.getElementById('kept-days') as HTMLSelectElement
    expect(back.value).toBe('30')
    back.value = 'forever'
    back.dispatchEvent(new Event('change'))
    expect(stored.at(-1)).toEqual({ keeps: true, keepDays: null })
  })
})

describe('deleting', () => {
  it('takes two presses, never one', () => {
    // Both of these end something that cannot be recovered. A single click on
    // a button somebody meant to read is the whole reason arming exists.
    render()
    press(t.keptForget)
    expect(calls, 'the first press deleted something').toEqual([])
    press(t.keptForgetConfirm)
    expect(calls).toEqual(['hers'])
  })

  it('keeps her delete and the machine delete separate', () => {
    // Two different scopes, and the wider one is not reachable by pressing the
    // narrower one twice.
    render()
    press(t.keptForgetAll)
    press(t.keptForgetAllConfirm)
    expect(calls).toEqual(['everything'])
  })

  it('arms only the button that was pressed', () => {
    render()
    press(t.keptForget)
    // The other one is still asking, not confirming.
    expect([...document.querySelectorAll('button')].map((b) => b.textContent)).toContain(
      t.keptForgetAll,
    )
  })
})

describe('browsing conversations', () => {
  it('shows a conversation when its row is opened', async () => {
    render()
    await settle()
    document.querySelector<HTMLButtonElement>('.kept-row')?.click()
    await settle()
    expect(document.body.textContent).toContain('hello back')
  })

  it('goes back to the list, and the list is still there', async () => {
    render()
    await settle()
    document.querySelector<HTMLButtonElement>('.kept-row')?.click()
    await settle()
    press(t.keptBack)
    await settle()
    expect(document.querySelector('.kept-row')).not.toBeNull()
    expect(document.querySelector('.kept-turn')).toBeNull()
  })

  it('clears the hits when the search box is emptied', async () => {
    // Emptying a search is not a search for nothing. Leaving the hits up would
    // show a filtered view with nothing on screen explaining the filter.
    render()
    await settle()
    const box = document.getElementById('kept-search') as HTMLInputElement
    box.value = 'hello'
    box.dispatchEvent(new Event('change'))
    await settle()
    expect(document.querySelector('.kept-row')).not.toBeNull()

    box.value = ''
    box.dispatchEvent(new Event('change'))
    await settle()
    expect(document.querySelector('.kept-row')).not.toBeNull()
  })

  it('drops what is on screen when the worn persona changes', async () => {
    // The scope confusion this pane avoids, arriving as a stale frame rather
    // than as a query: one character's conversations under another's name.
    render()
    await settle()
    expect(document.querySelector('.kept-row')).not.toBeNull()

    render(
      { keeps: true, keepDays: null },
      { sessions: 3, turns: 40 },
      {
        ...DEFAULT_PERSONA,
        id: 'someone-else',
      },
    )
    expect(document.querySelector('.kept-turn')).toBeNull()
  })
})

describe('replies that land after the reader has moved on', () => {
  it('does not paint one conversation’s turns under another', async () => {
    // Opening A then B before A's reply lands. The guard used to check only
    // the persona, so A's words appeared under B -- same character, wrong
    // conversation, and nothing on screen saying so.
    held = []
    render()
    await settle()
    const rows = [...document.querySelectorAll<HTMLButtonElement>('.kept-row')]
    rows[0]?.click()
    await settle()
    rows[1]?.click()
    await settle()

    // The SECOND reply first, then the first. That order is the hazard: a slow
    // request for A landing after a fast one for B. Releasing them in order
    // instead would leave B's turns on screen whether or not anything guarded
    // it, and the test would pass while checking nothing -- verified by
    // deleting the guard and watching it stay green.
    for (const release of [...held].reverse()) release()
    await settle()

    expect(document.body.textContent).toContain('the second conversation')
    expect(document.body.textContent).not.toContain('hello back')
  })

  it('drops a reply that belongs to the persona who was worn before', async () => {
    // The scope confusion, arriving late rather than as a query.
    held = []
    render()
    await settle()
    document.querySelector<HTMLButtonElement>('.kept-row')?.click()
    await settle()

    render(
      { keeps: true, keepDays: null },
      { sessions: 0, turns: 0 },
      {
        ...DEFAULT_PERSONA,
        id: 'someone-else',
      },
    )
    for (const release of held) release()
    await settle()

    expect(document.body.textContent).not.toContain('hello back')
  })
})

describe('the three deletions are independent', () => {
  it('does not disturb the conversations when her notes go', async () => {
    // One shared cleanup meant deleting NOTES collapsed the open conversation
    // and refetched the list. These are separate actions,
    // and that has to hold for the view as well as the disk.
    render()
    await settle()
    document.querySelector<HTMLButtonElement>('.kept-row')?.click()
    await settle()
    expect(document.querySelector('.kept-turn')).not.toBeNull()

    press(t.keptForgetNotes)
    press(t.keptForgetConfirm)
    await settle()

    expect(calls).toEqual(['notes'])
    expect(document.querySelector('.kept-turn')).not.toBeNull()
  })

  it('clears the conversations on screen when they are deleted', async () => {
    render()
    await settle()
    document.querySelector<HTMLButtonElement>('.kept-row')?.click()
    await settle()

    press(t.keptForget)
    press(t.keptForgetConfirm)
    await settle()

    // Back to the list, and nothing from the deleted set still rendered.
    expect(calls).toEqual(['hers'])
    expect(document.querySelector('.kept-turn')).toBeNull()
  })

  it('needs a fresh two presses for the next delete', async () => {
    // The arming was set and never consumed, so a fired delete stayed armed
    // and the next visit offered "Delete for good?" as a single press.
    render()
    await settle()
    press(t.keptForget)
    press(t.keptForgetConfirm)
    await settle()

    const labels = [...document.querySelectorAll('button')].map((b) => b.textContent)
    expect(labels).toContain(t.keptForget)
    expect(labels).not.toContain(t.keptForgetConfirm)
  })
})

describe('what it tells you about the file', () => {
  it('says plainly that it is not encrypted', () => {
    render()
    expect(document.body.textContent).toContain(t.keptPlain)
  })

  it('shows where it is, so it can be found and copied', () => {
    render()
    expect(document.body.textContent).toContain('/tmp/mochi/transcripts.db')
  })

  it('says when there is nothing yet rather than showing two zeroes', () => {
    render({ keeps: true, keepDays: null }, { sessions: 0, turns: 0 })
    expect(document.querySelector('.kept-count')?.textContent).toBe(t.keptNothing)
  })

  it('sizes bytes into something a person can picture', () => {
    expect(sizeOf(0)).toBe('0 B')
    expect(sizeOf(999)).toBe('999 B')
    expect(sizeOf(2048)).toBe('2 KB')
    expect(sizeOf(5 * 1024 * 1024)).toBe('5.0 MB')
  })
})
