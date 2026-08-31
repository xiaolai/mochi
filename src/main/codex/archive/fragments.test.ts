import { describe, expect, it } from 'vitest'

import {
  canonicalHeaderText,
  headerFragments,
  itemFragment,
  PASTED_CHARS,
  placeOf,
} from './fragments'
import type { HeaderRow, SpokenRow } from './read'

/**
 * The two attribution rules, as cases rather than as paragraphs.
 *
 * Everything here is about who gets credited with a sentence, which is the
 * safety property of the whole feature: voice gives the listener no citation to
 * check, so a wrong attribution is not correctable by the person hearing it.
 */

function header(over: Partial<HeaderRow> = {}): HeaderRow {
  return {
    id: 'one',
    title: '',
    firstUserMessage: '',
    preview: '',
    cwd: '/work/mochi',
    source: 'cli',
    threadSource: null,
    createdAtMs: 1_700_000_000_000,
    updatedAtMs: 1_700_000_100_000,
    ...over,
  }
}

/** The encoding measured on this machine, tags and speaker labels intact. */
const DELEGATION = `<realtime_delegation>
  <input>Attention to you, and it should be work, but it doesn't</input>
  <transcript_delta>user:  the sentinel the person said
assistant:  the sentinel the tool said
user:  and one more from the person
</transcript_delta>
</realtime_delegation>`

describe('there is one header text, not three', () => {
  it('prefers first_user_message', () => {
    expect(
      canonicalHeaderText(
        header({ firstUserMessage: 'the real one', preview: 'a copy', title: 'a copy' }),
      ),
    ).toBe('the real one')
  })

  it('falls back to preview, then to title', () => {
    expect(canonicalHeaderText(header({ preview: 'the preview', title: 'the title' }))).toBe(
      'the preview',
    )
    expect(canonicalHeaderText(header({ title: 'the title' }))).toBe('the title')
  })

  it('indexes one document even when all three columns hold the same text', () => {
    /*
      MEASURED: `preview` equals `first_user_message` in 9,293 rows and differs
      in none, and `title` equals it in 9,079 of 9,099. Indexing all three would
      enter every document three times and skew ranking toward threads that
      happen to have more columns filled.
    */
    const same = 'we decided to use the smaller typeface'
    const fragments = headerFragments(
      header({ firstUserMessage: same, preview: same, title: same }),
    )
    expect(fragments).toHaveLength(1)
    expect(fragments[0]?.text).toBe(same)
  })

  it('contributes nothing for a thread with no text at all', () => {
    expect(headerFragments(header())).toEqual([])
  })
})

describe('an opening remark and a pasted document are different claims', () => {
  it('calls a short opening an opening', () => {
    const fragments = headerFragments(header({ firstUserMessage: 'why is the build looping' }))
    expect(fragments[0]?.kind).toBe('opening')
  })

  it('calls a long one a paste, so she does not say "you said this at the start"', () => {
    // 4,411 of 9,093 header values are over this length and the longest is
    // 148,357. They are files somebody pasted, not things anybody said.
    const fragments = headerFragments(header({ firstUserMessage: 'x'.repeat(PASTED_CHARS + 1) }))
    expect(fragments[0]?.kind).toBe('pasted')
  })
})

describe('the voice blob has two speakers', () => {
  // `thread_source: 'realtime_voice'` is what Codex sets on a thread that came
  // from a voice session, and it is what separates the record from a document
  // describing one. The F4 thread on the measured machine carries it.
  const fragments = headerFragments(
    header({ firstUserMessage: DELEGATION, threadSource: 'realtime_voice' }),
  )

  it('splits it into per-speaker pieces rather than one document', () => {
    expect(fragments.length).toBeGreaterThan(3)
  })

  it('attributes the user lines to them and the assistant lines to Codex', () => {
    const said = new Map(fragments.map((one) => [one.text.trim(), one.who]))
    expect(said.get('the sentinel the person said')).toBe('them')
    expect(said.get('the sentinel the tool said')).toBe('codex')
    expect(said.get('and one more from the person')).toBe('them')
  })

  it('never reports an assistant line as something the person said', () => {
    /*
      THE DEFECT THIS EXISTS FOR. Indexed whole, a search matching the assistant
      half of this blob would come back attributed to the person — and she would
      say "you said" about a sentence a tool wrote.
    */
    const theirs = fragments.filter((one) => one.who === 'them').map((one) => one.text)
    expect(theirs.join('\n')).not.toContain('the sentinel the tool said')
  })

  it('leaves the unlabelled input attributed to nobody', () => {
    // `<input>` is very probably the person's words and carries no speaker
    // label. "Very probably" is not what `who` claims.
    const input = fragments.find((one) => one.text.includes('Attention to you'))
    expect(input?.who).toBe('unknown')
  })

  it('keeps an unrecognisable delegation whole rather than dropping it', () => {
    // "I could not read that" and "there was nothing in it" are the distinction
    // the whole feature is arranged around, so a blob this build cannot parse
    // stays in the index attributed to nobody.
    const odd = headerFragments(
      header({ firstUserMessage: '<realtime_delegation>?!</x>', threadSource: 'realtime_voice' }),
    )
    expect(odd).toHaveLength(1)
    expect(odd[0]?.who).toBe('unknown')
    expect(odd[0]?.text).toContain('?!')
  })

  it('does not treat a pasted document that MENTIONS the tag as a delegation', () => {
    /*
      This matched on `includes`, so a document quoting the encoding — an
      example in a design note, a bug report about it — was split on its
      `user:`/`assistant:` lines and classified as an `opening` however long it
      was. A 40 KB paste would have been presented to her as a remark.
    */
    const pasted = `${'here is the encoding we were discussing. '.repeat(120)}
      <realtime_delegation><transcript_delta>user:  an example line
assistant:  and its reply</transcript_delta></realtime_delegation>
      ${'and here is why it matters. '.repeat(120)}`
    const fragments = headerFragments(header({ firstUserMessage: pasted }))
    expect(fragments).toHaveLength(1)
    expect(fragments[0]?.kind).toBe('pasted')
  })

  it('does not split a well-formed wrapper on a thread that is not a voice one', () => {
    /*
      THE TAGS ALONE CANNOT TELL the record from a description of it.

      A pasted XML document bounded by the wrapper — an example in a design note,
      a bug report quoting one — would otherwise be split, and its example lines
      attributed to real speakers. Codex's own `thread_source` is what says a
      thread actually came from a voice session.
    */
    const fragments = headerFragments(header({ firstUserMessage: DELEGATION, threadSource: 'cli' }))
    expect(fragments).toHaveLength(1)
    expect(fragments[0]?.who).toBe('unknown')
    // Whole, so nothing is lost and nothing is attributed.
    expect(fragments[0]?.text).toContain('the sentinel the tool said')
  })

  it('keeps a document that OPENS like one whole, and blames nobody for it', () => {
    /*
      THE DIRECTION THE FIRST FIX BROKE.

      Anchoring both ends stopped a half-formed wrapper being recognised at all,
      so it fell through to the ordinary path and was attributed to the PERSON —
      `assistant:` lines included. That is the misattribution this file exists to
      prevent, arriving through the fix for something else.

      Opens like one and does not close like one: kept whole, split by nothing,
      and attributed to nobody.
    */
    const half = `<realtime_delegation><transcript_delta>user:  a line
assistant:  a reply the person did not write
${'and then a great deal more pasted text. '.repeat(120)}`
    const fragments = headerFragments(
      header({ firstUserMessage: half, source: 'cli', threadSource: 'realtime_voice' }),
    )
    expect(fragments).toHaveLength(1)
    expect(fragments[0]?.who).toBe('unknown')
    // Still long enough to be a paste, and still says so.
    expect(fragments[0]?.kind).toBe('pasted')
    // And nothing was split off and blamed on the person.
    expect(fragments[0]?.text).toContain('a reply the person did not write')
  })

  it('gives every piece its own key, so they do not collide in the index', () => {
    expect(new Set(fragments.map((one) => one.itemId)).size).toBe(fragments.length)
  })
})

describe('a thread nobody started', () => {
  it('attributes an ordinary opening to the person', () => {
    expect(headerFragments(header({ firstUserMessage: 'hello', source: 'exec' }))[0]?.who).toBe(
      'them',
    )
  })

  it('refuses to attribute a sub-agent spawn to the person', () => {
    // About sixty rows on the measured machine carry a JSON blob in `source`.
    // Their opening message was written by another agent.
    const spawned = headerFragments(
      header({ firstUserMessage: 'go and check the tests', source: '{"subagent":{}}' }),
    )
    expect(spawned[0]?.who).toBe('unknown')
  })
})

describe('one projected turn', () => {
  function spoken(over: Partial<SpokenRow> = {}): SpokenRow {
    return {
      threadId: 'one',
      turnId: 't1',
      itemId: 'i1',
      ordinal: 1,
      createdAtMs: 1_700_000_000_000,
      who: 'them',
      text: 'what did we decide about the fonts',
      ...over,
    }
  }

  it('becomes a fragment that says it was actually said', () => {
    const fragment = itemFragment(spoken())
    expect(fragment?.kind).toBe('said')
    expect(fragment?.who).toBe('them')
    expect(fragment?.turnId).toBe('t1')
  })

  it('is dropped when there is nothing readable in it', () => {
    // An empty document in an FTS index is a hit that can never be quoted.
    expect(itemFragment(spoken({ text: '' }))).toBeNull()
    expect(itemFragment(spoken({ text: '   \n ' }))).toBeNull()
  })
})

describe('where a conversation happened', () => {
  it('is the repository name, which is what somebody says out loud', () => {
    expect(placeOf('/Users/them/work/smartcube-web-bluetooth')).toBe('smartcube-web-bluetooth')
    expect(placeOf('/Users/them/work/mochi/')).toBe('mochi')
  })

  it('is empty when Codex recorded no directory', () => {
    // Not invented. The payload says "an earlier Codex conversation" instead.
    expect(placeOf('')).toBe('')
    expect(placeOf('/')).toBe('')
  })

  it('handles a windows-shaped path, because cwd is whatever Codex stored', () => {
    expect(placeOf('C:\\work\\mochi')).toBe('mochi')
  })
})
