import { describe, expect, it } from 'vitest'

import { settledView } from '../../test/settings-view'
import { destinations, matching, type Destination } from './jump'

/**
 * Finding a setting by name, and the orderings that decide whether it is usable.
 *
 * What is worth asserting here is not "does it match" — a substring test either
 * works or is obviously broken — but the RANKING, which is the whole difference
 * between a list somebody reads and one they scroll past. Every case below is a
 * pair where the wrong order is plausible and silently unhelpful.
 */

const ALL = destinations(settledView())

/** What a result list would actually show, for readable assertions. */
function labels(typed: string): readonly string[] {
  return matching(ALL, typed).map((one) => one.label)
}

describe('what can be reached by name', () => {
  it('covers all three places the window keeps settings in', () => {
    /*
      NOT JUST THE MACHINE'S PAGE, and this is the assertion that decides
      whether any of this is worth having.

      A search that finds "Halo" and not "Voice" is worse than none: three
      misses teach somebody it only knows about part of the window, and after
      that they go back to hunting for all of it. Her sheet is `cast`, her
      grants are `permits`, and an index that quietly stopped at `PANES` would
      look complete while missing the settings people hunt for most.
    */
    expect(new Set(ALL.map((one) => one.place))).toEqual(new Set(['cast', 'machine', 'permits']))
  })

  it('reaches her own sheet by the words on it', () => {
    // The half that used to be missing entirely. Each of these is a section
    // heading on her page rather than anywhere in the machine's groups.
    expect(labels('voice')).toContain('Voice')
    expect(labels('appearance')).toContain('Appearance')
    expect(labels('who')).toContain('Who she is')
    expect(labels('bubble')).toContain('Speech bubble')
  })

  it('reaches a drill-down by its door rather than not at all', () => {
    /*
      Her expressions, her notes and her instruction are screens BEHIND a row on
      her sheet. Search takes somebody to the row; going through it would leave
      them on a screen with no memory of how they got there.
    */
    // "What she has kept" is what the row is CALLED; "memory" is what somebody
    // types. This is the keyword doing the only job it has.
    expect(labels('memory')).toContain('What she has kept')
    expect(labels('expressions')).toContain('Her expressions')
    expect(labels('system prompt')).toContain('Her instruction')
  })

  it('carries the group beside every entry', () => {
    // "Rest" and "Workspace" mean nothing on their own in a list of fifty. The
    // group is what tells somebody which of two similar-sounding settings they
    // are about to be taken to, so an entry without one is not offerable.
    for (const one of ALL) expect(one.group.trim(), one.fieldId).not.toBe('')
  })

  it('names a machine group to open for machine entries, and none for hers', () => {
    /*
      The two halves are reached differently and that is not an accident of this
      code: her page is a place, and the machine's page is a place WITH a group
      inside it that has to be opened before the field exists in the document.
      An entry claiming a `paneId` for her page would send the window looking
      for a machine group that is not there.
    */
    for (const one of ALL) {
      if (one.place === 'machine') expect(one.paneId, one.fieldId).not.toBeNull()
      else expect(one.paneId, one.fieldId).toBeNull()
    }
  })
})

describe('the order results come back in', () => {
  it('puts an exact label first, above anything that merely contains it', () => {
    // "Rest" is a label here and a word inside other entries' keywords. Somebody
    // typing the word printed on the screen means the thing it is printed on.
    expect(labels('rest')[0]).toBe('Rest')
  })

  it('finds a setting by a word that is not the first one in its name', () => {
    // Nobody remembers that the web search setting is filed under "Web". They
    // remember it is about searching, and type that.
    expect(labels('search')).toContain('Web search')
  })

  it('finds a setting by what it is about rather than what it is called', () => {
    /*
      The case the keywords exist for, and the one a label-only search fails
      silently: "Rest" is what this repository calls the idle timeout, and
      "sleep" is what everybody else calls it. Typing the sensible word has to
      work or the keywords are decoration.
    */
    expect(labels('sleep')).toContain('Rest')
    expect(labels('timeout')).toContain('Rest')
  })

  it('ranks a labelled hit above a keyword hit for the same word', () => {
    /*
      A WORD THAT IS BOTH, or the assertion means nothing.

      This asserted on "codex", where every match is a label match — so it passed
      under any ordering whatsoever, and the comment above it said so and then
      changed nothing. An audit caught it, correctly.

      "sleep" is the pair that actually exists in this window: it is a KEYWORD of
      "Rest" on the machine's page, and the word does not appear in any label.
      So a synthetic pair is built here instead — the only honest way to check a
      rule about two ranks when the real data has one of them.
    */
    const both = [
      { ...(ALL[0] as Destination), fieldId: 'k', label: 'Nothing', keywords: ['widget'] },
      { ...(ALL[0] as Destination), fieldId: 'l', label: 'Widget', keywords: [] },
    ]
    // Declared keyword-first, so a stable sort that ignored rank would return it
    // first. It has to come SECOND.
    expect(matching(both, 'widget').map((one) => one.fieldId)).toEqual(['l', 'k'])
  })

  it('ranks a whole-word label hit above one buried mid-word', () => {
    // The middle rank, and the one that keeps a result list looking sorted: a
    // word starting a label beats the same letters inside a longer one.
    const both = [
      { ...(ALL[0] as Destination), fieldId: 'inside', label: 'Unsearchable', keywords: [] },
      { ...(ALL[0] as Destination), fieldId: 'start', label: 'Web search', keywords: [] },
    ]
    expect(matching(both, 'search').map((one) => one.fieldId)).toEqual(['start', 'inside'])
  })

  it('narrows as more is typed rather than widening', () => {
    /*
      THE FAILURE THIS PREVENTS is the one that makes people stop typing: with
      any-term matching, "web search" returns everything matching "web" PLUS
      everything matching "search", so the list grows as somebody tries to be
      more specific.
    */
    const one = matching(ALL, 'web')
    const two = matching(ALL, 'web search')
    expect(two.length).toBeLessThanOrEqual(one.length)
    expect(two.map((each) => each.label)).toContain('Web search')
  })

  it('offers nothing at all for an empty query', () => {
    // Not everything. A list of fifty-five under an empty box is a wall, and it
    // teaches somebody that typing narrows a list they never wanted to see.
    expect(matching(ALL, '')).toEqual([])
    expect(matching(ALL, '   ')).toEqual([])
  })

  it('offers nothing for a query that matches nothing', () => {
    expect(matching(ALL, 'xyzzy')).toEqual([])
  })

  it('ignores case in both directions', () => {
    expect(labels('HALO')).toContain('Halo')
    expect(labels('halo')).toContain('Halo')
  })

  it('reaches one of the thirty prompt editors by its own name', () => {
    /*
      The reason any of this was built. These thirty are drawn into one
      scrolling column with no filter, so the ONLY way to reach one has been to
      know roughly where it sits and scroll.
    */
    expect(labels('recall')).toContain('When there is nothing to recall')
  })

  it('keeps the window’s own order among equally good matches', () => {
    /*
      Stability is what stops the list re-sorting itself under somebody who is
      still typing. Two entries that match a word equally well come back in the
      order the window draws them — the only order on screen that means
      anything.
    */
    const drawn = ALL.filter((one) => one.keywords.includes('folder')).map((one) => one.fieldId)
    const found = matching(ALL, 'folder')
      .filter((one) => one.keywords.includes('folder'))
      .map((one) => one.fieldId)
    expect(found).toEqual(drawn)
  })
})
