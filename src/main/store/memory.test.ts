/**
 * Memory is per persona, bounded, and never a reason not to start.
 *
 * The isolation test is the one that matters most: a work persona and a
 * personal one sharing notes is a fault, not an untidiness, and it is exactly
 * the failure that keeping memory inside `Persona` would have made possible.
 */

import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { PERSONA_LIMITS } from '@shared/persona'
import { MEMORY_DIR, memoryRoot, previousNote, recall, remember } from './memory'

function workspace(): string {
  return mkdtempSync(join(tmpdir(), 'mochi-memory-'))
}

describe('recall', () => {
  it('is empty for a persona nobody has talked to, and says nothing about it', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(recall(workspace(), 'tutor')).toBe('')
    // Not an error. Reporting "no notes yet" the same way as "her memory could
    // not be read" would put a warning in front of every new character.
    expect(warn).not.toHaveBeenCalled()
    warn.mockRestore()
  })

  it('keeps two personas apart', () => {
    const dir = workspace()
    remember(dir, 'tutor', 'They are learning Rust.')
    remember(dir, 'coach', 'Prefers mornings.')

    expect(recall(dir, 'tutor')).toBe('They are learning Rust.')
    expect(recall(dir, 'coach')).toBe('Prefers mornings.')
  })

  it('survives a corrupt note rather than refusing to start', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const dir = workspace()
    mkdirSync(memoryRoot(dir), { recursive: true })
    writeFileSync(join(memoryRoot(dir), 'tutor.json'), '{ half a file')

    expect(recall(dir, 'tutor')).toBe('')
    // Said, though. Starting without her memory is the right call; doing it
    // silently is what leaves somebody wondering why she has forgotten them.
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })

  it('truncates rather than dropping a memory that outgrew the bound', () => {
    const dir = workspace()
    remember(dir, 'tutor', 'x'.repeat(PERSONA_LIMITS.memory + 500))
    // The bound exists to stop an unbounded request going out on every wake.
    // Discarding her whole memory would be a worse answer to that than
    // keeping what fits.
    expect(recall(dir, 'tutor')).toHaveLength(PERSONA_LIMITS.memory)
  })
})

describe('the path is built from an id, so the id has to be one', () => {
  it('refuses to turn something outside the grammar into a path', () => {
    // This function is where an id becomes a PATH. The grammar already makes
    // traversal unrepresentable; this is the assertion that notices if the
    // grammar is ever loosened, rather than letting it become a traversal.
    for (const hostile of ['../../etc/passwd', 'a/b', 'Tutor', '']) {
      expect(() => recall(workspace(), hostile), hostile).toThrow()
      expect(() => remember(workspace(), hostile, 'x'), hostile).toThrow()
    }
  })

  it('writes inside the memory folder and nowhere else', () => {
    const dir = workspace()
    remember(dir, 'tutor', 'note')
    expect(memoryRoot(dir)).toBe(join(dir, MEMORY_DIR))
    expect(recall(dir, 'tutor')).toBe('note')
  })
})

describe('the version a write replaces', () => {
  function fresh(): string {
    return mkdtempSync(join(tmpdir(), 'mochi-memory-'))
  }

  it('is nothing before anything has ever been written', () => {
    // `null`, not `''`. The two used to be one value and that is what made the
    // first rewrite the only one nobody could undo -- see below.
    expect(previousNote(fresh(), 'ada')).toBe(null)
  })

  it('is the BLANK note the first write replaced, not nothing at all', () => {
    // The distinction `null` exists for. A persona whose memory was empty when
    // the first summary ran does have a previous note, and it is blank -- so
    // collapsing "there is no previous" into `''` hid the undo for exactly the
    // rewrite somebody is most likely to want back: the one that first put
    // words in her mouth.
    const dir = fresh()
    remember(dir, 'ada', 'first')
    expect(recall(dir, 'ada')).toBe('first')
    expect(previousNote(dir, 'ada')).toBe('')
  })

  it('is the note the write replaced', () => {
    const dir = fresh()
    remember(dir, 'ada', 'first')
    remember(dir, 'ada', 'second')
    expect(recall(dir, 'ada')).toBe('second')
    expect(previousNote(dir, 'ada')).toBe('first')
  })

  it('is one step deep, not a log', () => {
    // Deeper would be a second archive with no retention policy and no delete
    // button, beside one that has both.
    const dir = fresh()
    for (const note of ['one', 'two', 'three']) remember(dir, 'ada', note)
    expect(recall(dir, 'ada')).toBe('three')
    expect(previousNote(dir, 'ada')).toBe('two')
  })

  it('makes restoring itself undoable', () => {
    // Writing the previous note back through `remember` means the note it
    // replaces becomes the new previous -- so pressing undo twice returns to
    // where you started rather than losing a version.
    const dir = fresh()
    remember(dir, 'ada', 'original')
    remember(dir, 'ada', 'rewritten')
    remember(dir, 'ada', previousNote(dir, 'ada') ?? '')
    expect(recall(dir, 'ada')).toBe('original')
    expect(previousNote(dir, 'ada')).toBe('rewritten')
  })

  it('survives a file that is not JSON, like recall does', () => {
    const dir = fresh()
    mkdirSync(memoryRoot(dir), { recursive: true })
    writeFileSync(join(memoryRoot(dir), 'ada.json'), 'not json at all')
    expect(previousNote(dir, 'ada')).toBe(null)
  })

  it('bounds what it hands back, like recall does', () => {
    const dir = fresh()
    mkdirSync(memoryRoot(dir), { recursive: true })
    writeFileSync(
      join(memoryRoot(dir), 'ada.json'),
      JSON.stringify({ notes: 'x', previous: 'y'.repeat(PERSONA_LIMITS.memory * 2) }),
    )
    expect(previousNote(dir, 'ada')?.length).toBe(PERSONA_LIMITS.memory)
  })
})

describe('refusing to overwrite what it could not read', () => {
  it('throws rather than replacing a note that will not parse', () => {
    const userData = workspace()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    // The rollback value this stores is the previous note. Read through
    // `recall`, a file that exists and cannot be parsed yields "" — so the
    // write would replace something possibly recoverable by hand and record
    // "nothing" as the version to go back to.
    mkdirSync(memoryRoot(userData), { recursive: true })
    const path = join(memoryRoot(userData), 'loki.json')
    const corrupt = '{"notes": "everything she knew" TRUNCATED'
    writeFileSync(path, corrupt)

    expect(() => remember(userData, 'loki', 'something new')).toThrow(/refusing/)
    expect(readFileSync(path, 'utf8')).toBe(corrupt)
    warn.mockRestore()
  })

  it('writes normally when there is simply nothing there yet', () => {
    // Absent is not unreadable, and a persona nobody has talked to is the
    // ordinary case rather than a problem.
    const userData = workspace()
    expect(() => remember(userData, 'loki', 'the first thing')).not.toThrow()
    expect(recall(userData, 'loki')).toBe('the first thing')
  })
})

describe('one step back', () => {
  it('is null until something has actually been rewritten', () => {
    // Null and "it used to be empty" are different answers, and the window
    // disables its undo on the first. Collapsing them would make the very first
    // rewrite the one that cannot be undone.
    const userData = workspace()
    expect(previousNote(userData, 'loki')).toBeNull()
    remember(userData, 'loki', 'the first thing')
    expect(previousNote(userData, 'loki')).toBe('')
  })

  it('round-trips: what the window puts back is what was there before', () => {
    // The whole undo, stated end to end rather than as two half-assertions.
    const userData = workspace()
    remember(userData, 'loki', 'they take their coffee black')
    remember(userData, 'loki', 'something a model decided instead')
    const back = previousNote(userData, 'loki')
    expect(back).toBe('they take their coffee black')
    if (back === null) return
    remember(userData, 'loki', back)
    expect(recall(userData, 'loki')).toBe('they take their coffee black')
    // And the undo is itself undoable, which is what makes pressing it safe.
    expect(previousNote(userData, 'loki')).toBe('something a model decided instead')
  })

  it('survives clearing, so forgetting everything is not final', () => {
    const userData = workspace()
    remember(userData, 'loki', 'months of accumulated notes')
    remember(userData, 'loki', '')
    expect(recall(userData, 'loki')).toBe('')
    expect(previousNote(userData, 'loki')).toBe('months of accumulated notes')
  })
})
