/**
 * Memory is per persona, bounded, and never a reason not to start.
 *
 * The isolation test is the one that matters most: a work persona and a
 * personal one sharing notes is a fault, not an untidiness, and it is exactly
 * the failure that keeping memory inside `Persona` would have made possible.
 */

import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { PERSONA_LIMITS } from '@shared/persona'
import { MEMORY_DIR, memoryRoot, recall, remember } from './memory'

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
