// @vitest-environment happy-dom
/**
 * The sound section, as somebody with the problem meets it.
 *
 * The setting that matters here is named after the SITUATION -- speakers or
 * earphones -- rather than after the mechanism, because "half duplex" is the
 * accurate term and nobody whose companion keeps interrupting herself would
 * search for it.
 */

import { describe, expect, it, beforeEach, vi } from 'vitest'
import { DEFAULT_SOUND, type Sound } from '@shared/sound'
import { messagesFor } from '@shared/i18n'
import { forPronoun } from '@shared/pronoun'
import type { SettingsSnapshot } from '@shared/ipc'
import { soundSection } from './sound'
import type { Copy } from '../copy'

const copy: Copy = {
  t: messagesFor('en').settings,
  locale: 'en',
  pronoun: 'she',
  say: (table) => forPronoun(table, 'she'),
}

const saved: Sound[] = []

beforeEach(() => {
  saved.length = 0
  Object.defineProperty(window, 'mochiSettings', {
    value: {
      saveSound: (sound: Sound) => {
        saved.push(sound)
        return Promise.resolve([])
      },
    },
    configurable: true,
  })
})

function render(sound: Sound = DEFAULT_SOUND, loopbackHeard: boolean | null = null): void {
  const deps = {
    act: (_: string, run: () => Promise<unknown>) => void run(),
    showProblems: vi.fn(),
  }
  document.body.replaceChildren(
    soundSection(copy, { sound, loopbackHeard } as SettingsSnapshot, deps),
  )
}

function pick(id: string, value: string): void {
  const node = document.getElementById(id) as HTMLSelectElement
  node.value = value
  node.dispatchEvent(new Event('change'))
}

describe('the sound section', () => {
  it('works it out by default, and still lets somebody say', () => {
    render()
    const options = [
      ...document.querySelectorAll<HTMLOptionElement>('#sound-listening option'),
    ].map((o) => o.value)
    // Auto FIRST and chosen. A setting somebody must change every time they
    // plug earphones in is a setting nobody maintains; the two manual answers
    // exist because a measurement can be wrong, not as the normal path.
    expect(options).toEqual(['auto', 'speaker', 'earphones'])
    expect((document.getElementById('sound-listening') as HTMLSelectElement).value).toBe('auto')
  })

  it('turns earphones into keeping the microphone open', () => {
    render()
    pick('sound-listening', 'earphones')
    expect(saved).toEqual([{ ...DEFAULT_SOUND, listening: 'earphones' }])
  })

  it('sends the whole block, so one change cannot drop the others', () => {
    // Every control here writes the entire `Sound`. A partial write would let
    // changing the eagerness quietly reset the setting somebody came to this
    // pane to fix.
    render({ listening: 'earphones', echoCancellation: false, eagerness: 'high' })
    pick('sound-eagerness', 'low')
    expect(saved).toEqual([{ listening: 'earphones', echoCancellation: false, eagerness: 'low' }])
  })

  it('shows the stored state rather than the defaults', () => {
    render({ listening: 'earphones', echoCancellation: false, eagerness: 'high' })
    expect((document.getElementById('sound-listening') as HTMLSelectElement).value).toBe(
      'earphones',
    )
    expect((document.getElementById('sound-aec') as HTMLSelectElement).value).toBe('off')
    expect((document.getElementById('sound-eagerness') as HTMLSelectElement).value).toBe('high')
  })

  it('shows what it heard, so an automatic decision is not a mystery', () => {
    // A judgement nobody can see is one nobody can tell from a malfunction --
    // and this one decides whether you can interrupt her.
    const t = messagesFor('en').settings
    render(DEFAULT_SOUND, null)
    expect(document.querySelector('.sound-heard')?.textContent).toBe(
      forPronoun(t.soundHeardNothing, 'she'),
    )
    render(DEFAULT_SOUND, true)
    expect(document.querySelector('.sound-heard')?.textContent).toBe(
      forPronoun(t.soundHeardEcho, 'she'),
    )
    render(DEFAULT_SOUND, false)
    expect(document.querySelector('.sound-heard')?.textContent).toBe(
      forPronoun(t.soundHeardClear, 'she'),
    )
  })

  it('shows nothing heard when the person has answered for themselves', () => {
    // Under a manual answer there is no judgement to show, and printing one
    // would suggest the measurement is still deciding something.
    render({ ...DEFAULT_SOUND, listening: 'earphones' }, true)
    expect(document.querySelector('.sound-heard')).toBeNull()
    render({ ...DEFAULT_SOUND, listening: 'speaker' }, false)
    expect(document.querySelector('.sound-heard')).toBeNull()
  })

  it('recommends earphones whatever is set', () => {
    // Said once, on every path: the setting picks the least-bad behaviour for
    // a speaker, and earphones remove the problem instead of managing it.
    for (const listening of ['auto', 'speaker', 'earphones'] as const) {
      render({ ...DEFAULT_SOUND, listening }, null)
      expect(document.querySelector('.sound-advice')?.textContent, listening).toBe(
        forPronoun(messagesFor('en').settings.soundPrefer, 'she'),
      )
    }
  })

  it('says these land on the next wake', () => {
    // They are read when a session OPENS -- two are getUserMedia constraints
    // and one is a session.update field -- so a person who changes one
    // mid-conversation and hears nothing change has been told why.
    render()
    expect(document.querySelector('.sound-when')?.textContent).toBe(
      forPronoun(messagesFor('en').settings.soundNextWake, 'she'),
    )
  })
})
