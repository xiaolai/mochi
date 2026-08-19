import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { PERSONA_LIMITS } from '@shared/persona'
import { ASKED_HEADING, MAX_ENTRY_CHARS } from '../../main/memory/summarise'
import { memoryRoot, recall, remember } from '../../main/store/memory'
import { stubDeps } from '../../test/capability-deps'
import { capability } from './capability'

/**
 * The three acceptances from the plan, plus the ones the reused machinery
 * already decides and this capability must not be able to bypass.
 *
 * Every assertion goes through the STORE rather than the return value where it
 * can. What matters about remembering something is that it is on disk after
 * the call, not that the handler said so.
 */

let userData = ''

beforeEach(() => {
  userData = mkdtempSync(join(tmpdir(), 'mochi-remember-'))
})
afterEach(() => {
  rmSync(userData, { recursive: true, force: true })
})

function call(
  note: string,
  overrides: Parameters<typeof stubDeps>[0] = {},
): { status: string; guidance: string } {
  if (capability.kind !== 'immediate') throw new Error('this one answers on the spot')
  const output = capability.handler(
    { note },
    stubDeps({ userData: () => userData, wearing: () => 'loki', ...overrides }),
  )
  return output as { status: string; guidance: string }
}

describe('remember_this', () => {
  it('declares itself, and is built rather than declared', () => {
    // The whole point of the layout. This manifest shipped for weeks with
    // `notBuilt` behind it: she was told she could remember things, tried, and
    // was told she could not. A manifest without a handler no longer typechecks.
    expect(capability.manifest.name).toBe('remember_this')
    expect(capability.kind).toBe('immediate')
    expect(typeof capability.handler).toBe('function')
  })

  it('writes the line under the heading, and it is still there afterwards', () => {
    const answered = call('they take their coffee black')
    expect(answered.status).toBe('saved')
    // Read back through `recall`, which is what a later wake actually calls —
    // so this is the restart, not a claim about one.
    const note = recall(userData, 'loki')
    expect(note).toContain(ASKED_HEADING)
    expect(note).toContain('- they take their coffee black')
  })

  it('keeps a second line under the same heading rather than a second heading', () => {
    call('they take their coffee black')
    call('their sister is called Mei')
    const note = recall(userData, 'loki')
    expect(note.split(ASKED_HEADING)).toHaveLength(2)
    expect(note).toContain('their sister is called Mei')
  })

  it('files under the persona being worn, and nobody else', () => {
    // The note is per character and that is a privacy boundary rather than a
    // tidiness one. A work persona and a personal one sharing a memory is a
    // fault.
    call('they take their coffee black')
    expect(recall(userData, 'loki')).toContain('coffee')
    expect(recall(userData, 'ada')).toBe('')
  })

  it('REFUSES a note that will not fit, rather than truncating the old one', () => {
    // Truncating here would cut what she already knew to make room for the new
    // line, which is the one direction nobody asked for.
    remember(userData, 'loki', 'x'.repeat(PERSONA_LIMITS.memory - 10))
    const before = recall(userData, 'loki')
    const answered = call('they take their coffee black')
    expect(answered.status).toBe('refused')
    expect(answered.guidance).toContain('full')
    // And the old note is untouched — the assertion the refusal exists for.
    expect(recall(userData, 'loki')).toBe(before)
  })

  it('refuses a line naming another character, and does not bypass entryProblem', () => {
    // A note naming another persona is a note trying to reach across the
    // boundary that filing per id exists to hold.
    const answered = call('ada said hello', { otherPersonaIds: () => new Set(['ada']) })
    expect(answered.status).toBe('refused')
    expect(answered.guidance).toContain('another character')
    expect(recall(userData, 'loki')).toBe('')
  })

  it('may describe the worn persona by her own name', () => {
    // The first version of this rule matched every id including the worn one,
    // so "they like mochi with red bean" was refused by an app whose subject is
    // a mochi. Her own id is never in the set she is checked against.
    //
    // WEARING `mochi` and writing `mochi`, so this tests the relationship
    // rather than merely that some unrelated word is not in the set. The set
    // holds another character, and the sentence names the worn one.
    const answered = call('they like mochi with red bean', {
      wearing: () => 'mochi',
      otherPersonaIds: () => new Set(['ada']),
    })
    expect(answered.status).toBe('saved')
    expect(recall(userData, 'mochi')).toContain('red bean')
  })

  it('refuses a path, a URL and shell syntax, which are never facts about a person', () => {
    for (const line of [
      'their notes are in /Users/them/secrets/',
      'they read https://example.com every morning',
      'they always run `rm -rf` first',
    ]) {
      expect(call(line).status, line).toBe('refused')
    }
    expect(recall(userData, 'loki')).toBe('')
  })

  it(`refuses a line past ${MAX_ENTRY_CHARS} characters, the summariser's own ceiling`, () => {
    // The bound is LENGTH, not sentence count — two short sentences inside the
    // ceiling are kept, and the manifest's "one plain sentence" is guidance to
    // the model rather than something checked here. Said plainly so the test
    // does not claim a constraint the code has not got.
    expect(call('a'.repeat(MAX_ENTRY_CHARS + 1)).status).toBe('refused')
    expect(call('a'.repeat(MAX_ENTRY_CHARS)).status).toBe('saved')
    expect(call('They like tea. Their sister is Mei.').status).toBe('saved')
  })

  it('refuses an empty note rather than writing a blank bullet', () => {
    expect(call('   ').status).toBe('refused')
    expect(call('').status).toBe('refused')
    // Not just the empty string: a zero-width space survives flattening, is not
    // `''`, and would be filed as a bullet nobody can see or remove.
    expect(call('\u200b').status).toBe('refused')
    expect(call('\u200d\u2060 \u200b').status).toBe('refused')
    expect(recall(userData, 'loki')).toBe('')
  })

  it('REFUSES when the note cannot be read, and does not overwrite it', () => {
    // The failure this guards is silent and total: `recall` answers "" for a
    // file that could not be parsed as well as for one that is not there, so
    // appending to that "" saves a one-line note over the unreadable file and
    // files "" as the version to undo to. A note nobody can parse may still be
    // recoverable by hand; one that has been overwritten is gone.
    mkdirSync(memoryRoot(userData), { recursive: true })
    const path = join(memoryRoot(userData), 'loki.json')
    const corrupt = '{"notes": "everything she knew about them" TRUNCATED-MID-WRITE'
    writeFileSync(path, corrupt)

    const answered = call('they take their coffee black')
    expect(answered.status).toBe('refused')
    expect(answered.guidance).toContain('could not be read')
    // BYTE FOR BYTE. Anything less would not distinguish "refused" from
    // "rewrote it into something that happens to still be broken".
    expect(readFileSync(path, 'utf8')).toBe(corrupt)
  })

  it('flattens the line, so one note cannot forge a second bullet', () => {
    // The note is a markdown list. A newline in model output would appear as a
    // second remembered fact that nobody asked for.
    call('they like tea\n- they hate coffee')
    const note = recall(userData, 'loki')
    expect(note).toContain('- they like tea - they hate coffee')
    expect(note.split('\n').filter((one) => one.startsWith('- '))).toHaveLength(1)
  })

  it('does not write anything when nobody is worn', () => {
    // There is no note this would belong to, and filing it under a guess would
    // put it in a stranger's memory.
    const answered = call('they take their coffee black', { wearing: () => null })
    expect(answered.status).toBe('refused')
  })

  it('says ALREADY KNOWN rather than saved when nothing was added', () => {
    // Saying "saved" for a write that did not happen is a false statement she
    // then repeats out loud. `noteWith` returns the note untouched when the
    // line is already in it, and asking twice is the obvious way to get there.
    call('they take their coffee black')
    const once = recall(userData, 'loki')
    const answered = call('they take their coffee black')
    expect(answered.status).toBe('already-known')
    expect(answered.guidance).toContain('already')
    // And the undo is not rotated away. `remember` refuses to rotate on an
    // unchanged write, so asking twice cannot cost somebody the one version
    // they can put back — this path does not even reach it.
    expect(recall(userData, 'loki')).toBe(once)
  })

  it('says ALREADY KNOWN for a line that is only part of a longer one', () => {
    // The case nobody would think to ask about: `noteWith` deduplicates by
    // SUBSTRING, so an existing longer sentence suppresses the new line — and
    // the old answer claimed it had been saved under the heading it is not
    // under. Whether that dedup rule is right belongs to `noteWith`; what
    // belongs here is not lying about what happened.
    remember(userData, 'loki', '## About them\n- they take their coffee black in the morning')
    const before = recall(userData, 'loki')
    const answered = call('they take their coffee black')
    expect(answered.status).toBe('already-known')
    expect(recall(userData, 'loki')).toBe(before)
  })
})
