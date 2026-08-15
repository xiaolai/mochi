import { describe, expect, it } from 'vitest'
import {
  CREDENTIAL_SOURCES,
  DEFAULT_CREDENTIAL_SOURCE,
  REMEDIES,
  apiKeyProblem,
  isCredentialSource,
  keyHint,
} from './auth'

const REAL_SHAPE = `sk-proj-${'a'.repeat(40)}`

describe('checking a pasted key', () => {
  it('accepts the shapes OpenAI actually issues', () => {
    // Permissive about the middle on purpose: the format has changed more than
    // once — `sk-`, then `sk-proj-`, at varying lengths — so anything stricter
    // than prefix-and-plausible-length rejects valid keys the day the next
    // variant appears.
    expect(apiKeyProblem(REAL_SHAPE)).toBeNull()
    expect(apiKeyProblem(`sk-${'B'.repeat(48)}`)).toBeNull()
  })

  it('catches the paste mistakes that would otherwise fail at wake time', () => {
    // Each of these would surface fifteen seconds later as a failed session
    // with nothing pointing at the key.
    // Codes, not sentences. The prose lives in the message tables, so this
    // asserts WHICH mistake was recognised rather than how it is worded --
    // which is what the pane needs and what a translation cannot break.
    expect(apiKeyProblem('')).toBe('empty')
    expect(apiKeyProblem('   ')).toBe('empty')
    expect(apiKeyProblem('sk-abc')).toBe('short')
    expect(apiKeyProblem('https://platform.openai.com/api-keys')).toBe('prefix')
    expect(apiKeyProblem('OPENAI_API_KEY=sk-abcdefghijklmnop')).toBe('prefix')
    // A whole line copied out of a terminal, key included.
    expect(apiKeyProblem(`export ${REAL_SHAPE}`)).toBe('whitespace')
  })

  it('refuses an invisible character hiding inside a key', () => {
    // A control character survives a paste, survived this check while it only
    // looked for \\s, and then failed inside `fetch` -- where Node puts the
    // whole header VALUE in the exception message, bearer included. Measured,
    // and the reason `verify.ts` derives nothing from that exception.
    expect(apiKeyProblem(`sk-${'a'.repeat(20)}\u0000tail`)).toBe('whitespace')
    expect(apiKeyProblem(`sk-${'a'.repeat(20)}\u001btail`)).toBe('whitespace')
  })

  it('refuses an implausibly large paste before it copies it', () => {
    // The value arrives over IPC, so its size is not ours to assume, and
    // `trim()` copies the whole string before any check has run.
    expect(apiKeyProblem('x'.repeat(5000))).toBe('long')
  })

  it('tolerates the whitespace a paste adds around it', () => {
    expect(apiKeyProblem(`  ${REAL_SHAPE}\n`)).toBeNull()
  })

  it('refuses something implausibly long', () => {
    expect(apiKeyProblem(`sk-${'a'.repeat(500)}`)).toBe('long')
  })
})

describe('what may be shown of a key', () => {
  it('is the last four characters and nothing else', () => {
    // Enough to tell two keys apart, useless to somebody reading a screen
    // recording. This is the ONLY derivation of a key that ever leaves main.
    const hint = keyHint(`sk-proj-${'x'.repeat(36)}WXYZ`)
    expect(hint).toBe('••••WXYZ')
    expect(hint).not.toContain('sk-')
    expect(hint.length).toBe(8)
  })

  it('never reveals a short key by accident', () => {
    // A key too short to mask would otherwise be printed whole.
    expect(keyHint('sk-1')).toBe('••••')
    expect(keyHint('ab')).toBe('••••')
  })

  it('leaks no more than four characters of any input', () => {
    for (const key of [REAL_SHAPE, 'sk-' + 'z'.repeat(200), 'sk-1234']) {
      const shown = keyHint(key).replace(/•/g, '')
      expect(shown.length, key.slice(0, 6)).toBeLessThanOrEqual(4)
      expect(key.includes(shown)).toBe(true)
    }
  })
})

describe('the credential source', () => {
  it('is one of two, and defaults to the one that needs no secret', () => {
    expect([...CREDENTIAL_SOURCES]).toEqual(['codex', 'apikey'])
    expect(DEFAULT_CREDENTIAL_SOURCE).toBe('codex')
  })

  it('refuses anything it does not recognise', () => {
    // It arrives over IPC, where the type says one thing and the wire says
    // whatever the sender put on it.
    for (const bad of ['', 'CODEX', 'openai', null, 1, {}]) {
      expect(isCredentialSource(bad), JSON.stringify(bad)).toBe(false)
    }
    for (const good of CREDENTIAL_SOURCES) expect(isCredentialSource(good)).toBe(true)
  })
})

describe('remedies', () => {
  it('are the five the message tables are keyed by', () => {
    expect([...REMEDIES]).toEqual(['install', 'reinstall', 'login', 'store-key', 'retry'])
  })

  it('include one that asks for nothing to be changed', () => {
    // `retry` exists because `timed-out` used to be `unusable`, whose remedy is
    // "reinstall". A ten-second deadline is generous for `codex --version` and
    // still reachable on a thrashing machine -- so a busy laptop told the user
    // their working install was broken and to replace it.
    expect(REMEDIES).toContain('retry')
  })

  it('include one that is not about Codex', () => {
    // The three Codex remedies all tell you to do something to the CLI. When
    // the selected source is an API key and none is stored, every one of them
    // is the wrong instruction -- `login` would send somebody to a terminal to
    // fix a text field. This member exists so that advice is unrepresentable.
    expect(REMEDIES).toContain('store-key')
  })
})
