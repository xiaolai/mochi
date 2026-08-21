import { mkdtempSync, rmSync } from 'node:fs'
import { readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { createConversation } from './conversation'
import { keepsFor, readPolicy, writePolicy } from './policy'
import { createTranscripts } from './transcripts'

/**
 * "Save new conversations" — the switch behind the last clause of the promise.
 *
 * The website says conversations are written locally and kept until deleted,
 * *"or not written at all"*. `Policy.keeps` was the mechanism for that last
 * part and had no control, so the clause was false.
 *
 * ## Why the naming is tested and not only the behaviour
 *
 * Calling this "retention" is what let the old sentence lie for months. A
 * privacy switch whose scope has to be inferred gets inferred in the unsafe
 * direction, by somebody who wanted their words gone.
 */
let userData = ''

beforeEach(() => {
  userData = mkdtempSync(join(tmpdir(), 'mochi-keeps-'))
})

afterEach(() => {
  rmSync(userData, { recursive: true, force: true })
})

function fileATurn(): number {
  const transcripts = createTranscripts(userData)
  try {
    const talk = createConversation({
      transcripts,
      keeps: (id) => keepsFor(userData, id, new Map()),
    })
    talk.wear('ada')
    talk.file('you', 'something worth remembering')
    talk.end()
    return transcripts.sessions('ada').length
  } finally {
    transcripts.close()
  }
}

describe('turning the saving of conversations off', () => {
  it('stops new ones being written', () => {
    expect(fileATurn()).toBe(1)
    writePolicy(userData, 'ada', { keeps: false })
    expect(fileATurn()).toBe(1)
  })

  it('survives a restart', () => {
    writePolicy(userData, 'ada', { keeps: false })
    expect(readPolicy(userData, 'ada').keeps).toBe(false)
    expect(keepsFor(userData, 'ada', new Map())).toBe(false)
  })

  it('leaves the conversations already there alone', () => {
    // The property the note on the control promises. Turning the switch off is
    // not a delete, and a switch that quietly deleted would be the worst
    // surprise this app could produce.
    expect(fileATurn()).toBe(1)
    writePolicy(userData, 'ada', { keeps: false })

    const transcripts = createTranscripts(userData)
    try {
      expect(transcripts.sessions('ada')).toHaveLength(1)
      expect(transcripts.turns('ada', transcripts.sessions('ada')[0]!.token)).not.toHaveLength(0)
    } finally {
      transcripts.close()
    }
  })

  it('is on unless somebody has said otherwise', () => {
    // Turning it off for everyone who never opened the sheet would be a silent
    // data change in the other direction.
    expect(keepsFor(userData, 'ada', new Map())).toBe(true)
  })
})

describe('the control that sets it', () => {
  const shelf = readFileSync(join(process.cwd(), 'src', 'renderer', 'history', 'shelf.ts'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^[ \t]*\/\/.*$/gm, '')

  it('says NEW conversations, not "retention"', () => {
    expect(shelf).toContain("'Save new conversations'")
    expect(shelf).not.toContain('Retention')
  })

  it('says in as many words that it deletes nothing', () => {
    expect(shelf).toContain('does not delete the ones already here')
    expect(shelf).toContain('Archive')
  })

  it('is actually written when the sheet sends it', () => {
    /*
      Found by mutation, not by review: deleting the policy write from
      `shelf:save` left every test green. The switch would have moved, said
      "Saved", and done nothing -- written, sent, never applied, which is the
      exact defect this whole plan exists to remove.

      Read from source because the handler is `ipcMain.handle` in a module that
      cannot be imported outside Electron. Comments are stripped, so the
      paragraph above cannot satisfy it.
    */
    const main = readFileSync(join(process.cwd(), 'src', 'main', 'index.ts'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^[ \t]*\/\/.*$/gm, '')

    const handler = main.slice(main.indexOf("ipcMain.handle('shelf:save'"))
    const body = handler.slice(0, handler.indexOf('\n})'))
    expect(body).toContain("typeof asked.keeps === 'boolean'")
    expect(body).toContain('writePolicy(userData, asked.id, { keeps: asked.keeps })')
    // Before the manifest write, so a failing manifest cannot leave the switch
    // showing one thing and the store holding another.
    expect(body.indexOf('writePolicy')).toBeLessThan(body.indexOf('savePersonaTo'))
  })

  it('crosses the boundary, which its plan entry did not allow for', () => {
    // There was no policy value in `ShelfView` at all, so the files the plan
    // listed could not have carried this. Codex raised it; it was right.
    const ipc = readFileSync(join(process.cwd(), 'src', 'shared', 'ipc.ts'), 'utf8')
    expect(ipc).toContain('readonly keeps: boolean')
    expect(ipc).toContain('readonly keeps?: boolean')
  })
})
