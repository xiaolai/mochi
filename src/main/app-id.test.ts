/**
 * The application id exists twice: here and in `electron-builder.yml`.
 *
 * The comment beside it used to say "there is no packaging configuration yet,
 * so this comment is the note to keep the two in step when there is" — and by
 * the time this was written there was one, saying the same string. A note is
 * not a mechanism; two copies of an identity that disagree give the packaged
 * app a different taskbar identity from the one it sets at runtime, and nothing
 * anywhere would say so.
 */

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { APP_USER_MODEL_ID } from './app-id'

describe('the application id', () => {
  it('matches the one electron-builder packages under', () => {
    const config = readFileSync('electron-builder.yml', 'utf8')
    const declared = /^appId:\s*(\S+)\s*$/m.exec(config)
    expect(declared, 'electron-builder.yml no longer declares an appId').not.toBeNull()
    expect(declared![1]).toBe(APP_USER_MODEL_ID)
  })
})
