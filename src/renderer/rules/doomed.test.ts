import { describe, expect, it } from 'vitest'
import { confirmation, saidOf, wordsFor, type Doomed } from './doomed'

/**
 * The shape of the only irreversible action in the app.
 *
 * There is no undo, deliberately: an undo buffer is a second copy of the thing
 * somebody just asked to destroy. The confirmation IS the undo, so its
 * properties are the safety, and they are exercised rather than assumed.
 *
 * ## What this replaced
 *
 * These rules were held by a test that read `history/main.ts` off disk and
 * asserted the ORDER of two assignments inside it — that `doomed = about`
 * appeared within one function, that `doomed = null` came before
 * `deleteThem(about)`. Right about the rules, and able to survive nothing: the
 * moment either moved, the test described a file that no longer matched.
 *
 * D2 — that the question is a separate surface rather than an armed control —
 * cannot be checked here at all. It is a claim about modality, focus and
 * Escape, none of which a pure function has, so it stays a check on the window.
 */
const words = { asks: 'Delete 2 conversations?', because: 'This cannot be undone.' }

describe('D1 · a confirmation acts on a snapshot', () => {
  const some: Doomed = { kind: 'some', id: 'mochi', tokens: ['a', 'b'], ...words }

  it('hands back what it was opened about', () => {
    const sure = confirmation()
    sure.ask(some)
    expect(sure.answer()).toEqual(some)
  })

  it('is not asking anything until it is asked', () => {
    expect(confirmation().asking()).toBeNull()
  })

  it('answers a SECOND press with nothing', () => {
    // A double-click, a key repeat, a click landing before the surface closes.
    // The snapshot is dropped as it is handed over — the property arming cannot
    // have, since arming re-reads live state on the second press.
    const sure = confirmation()
    sure.ask(some)
    expect(sure.answer()).toEqual(some)
    expect(sure.answer()).toBeNull()
  })

  it('drops the snapshot when the question is dismissed', () => {
    // Escape and cancelling both come through here. A snapshot left behind
    // would be available to a LATER confirmation, which is the same defect as
    // acting on live state arriving from the other direction.
    const sure = confirmation()
    sure.ask(some)
    sure.drop()
    expect(sure.asking()).toBeNull()
    expect(sure.answer()).toBeNull()
  })

  it('does not notice the selection changing under it', () => {
    // The whole of D1 in one case: the tokens handed back are the ones the
    // question was asked about, whatever has happened since.
    const sure = confirmation()
    const tokens = ['a', 'b']
    sure.ask({ kind: 'some', id: 'mochi', tokens: [...tokens], ...words })
    tokens.push('c')
    expect(sure.answer()).toEqual({ kind: 'some', id: 'mochi', tokens: ['a', 'b'], ...words })
  })

  it('carries the SENTENCE, not just the target', () => {
    // Worded at answer time instead, a character switch while the question
    // waited made it describe one character over a deletion aimed at another's
    // id. The sentence is the whole of what the person answering can see.
    const sure = confirmation()
    sure.ask({
      kind: 'hers',
      id: 'loki',
      who: 'gone',
      asks: 'Delete every conversation with him?',
      because: 'Everything he was told.',
    })
    const answered = sure.answer()
    expect(answered?.asks).toBe('Delete every conversation with him?')
    expect(answered?.because).toBe('Everything he was told.')
  })

  it('replaces one question with another rather than stacking them', () => {
    const sure = confirmation()
    sure.ask(some)
    sure.ask({ kind: 'everything', ...words })
    expect(sure.answer()).toEqual({ kind: 'everything', ...words })
  })
})

describe('D3 · the question names its scope', () => {
  const said = { hers: 'Delete every conversation with her?', hersWhy: 'Everything she was told.' }

  it('never says a bare "are you sure"', () => {
    // The three deletions differ by two orders of magnitude in what they take,
    // and a question that does not say which is one answered by habit.
    for (const about of [
      { kind: 'some', tokens: ['a'] },
      { kind: 'hers' },
      { kind: 'everything' },
    ] as const) {
      const { asks, because } = wordsFor(about, said)
      expect(asks.toLowerCase()).not.toContain('are you sure')
      expect(because).not.toBe('')
    }
  })

  it('counts what it is about, and says one as a word', () => {
    expect(wordsFor({ kind: 'some', tokens: ['a'] }, said).asks).toBe('Delete this conversation?')
    expect(wordsFor({ kind: 'some', tokens: ['a', 'b', 'c'] }, said).asks).toBe(
      'Delete 3 conversations?',
    )
  })

  it('says out loud that the widest one reaches characters that are gone', () => {
    // The one deletion whose scope is bigger than the window showing it.
    expect(wordsFor({ kind: 'everything' }, said).because).toContain('no longer here')
  })

  it('takes her pronoun from the caller rather than saying "her"', () => {
    // A he/him character was told his own conversations would be deleted with
    // "her" in the sentence. The words come from the pronoun table, not here.
    expect(wordsFor({ kind: 'hers' }, said).asks).toBe(said.hers)
  })
})

describe('what the window says about the answer', () => {
  it('reports the count MAIN removed, not the count that was chosen', () => {
    // A conversation can have gone in another window since. "3 deleted" when 2
    // went is a small lie in the one place people check.
    expect(
      saidOf(
        { gone: 2, pending: false },
        { kind: 'some', id: 'm', tokens: ['a', 'b', 'c'], ...words },
      ),
    ).toBe('2 conversations deleted.')
  })

  it('falls back to the count asked for when main did not say', () => {
    expect(
      saidOf({ gone: null, pending: false }, { kind: 'some', id: 'm', tokens: ['a'], ...words }),
    ).toBe('One conversation deleted.')
  })

  it('says deleted and not-yet-scrubbed as the different things they are', () => {
    const still = saidOf(
      { gone: 1, pending: true },
      { kind: 'some', id: 'm', tokens: ['a'], ...words },
    )
    expect(still).toContain('One conversation deleted.')
    expect(still).toContain('still being cleared')
  })

  it('uses the sentence the caller gave for hers, so the pronoun survives', () => {
    expect(
      saidOf(
        { gone: 4, pending: false },
        { kind: 'hers', id: 'm', who: 'All of his are gone.', ...words },
      ),
    ).toBe('All of his are gone.')
  })
})
