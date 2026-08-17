import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { describeProblem, exchangeSdp, mintEphemeralKey, readBearer } from './credential'

let home = ''
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'mochi-cred-'))
})
afterEach(() => {
  rmSync(home, { recursive: true, force: true })
})

function writeAuth(value: unknown): void {
  mkdirSync(home, { recursive: true })
  writeFileSync(join(home, 'auth.json'), JSON.stringify(value))
}

const GOOD = {
  tokens: { access_token: 'a-token', refresh_token: 'r', account_id: 'acc' },
  last_refresh: '2026-08-12T15:20:31.131382Z',
}

/** A `fetch` that answers once, with whatever the test says. */
function answering(status: number, body: string): typeof globalThis.fetch {
  return async () => new Response(body, { status })
}

describe('reading the credential off disk', () => {
  it('reads the token and the refresh date, and prints neither', () => {
    writeAuth(GOOD)
    const read = readBearer(home)
    expect(read.ok).toBe(true)
    if (!read.ok) return
    expect(read.value.token).toBe('a-token')
    expect(read.value.lastRefresh).toBe('2026-08-12T15:20:31.131382Z')
  })

  it('tells a missing sign-in apart from a broken file', () => {
    // Different remedies. "Run codex to sign in" is wrong advice for a file that
    // is there and corrupt.
    expect(readBearer(join(home, 'nowhere'))).toEqual({
      ok: false,
      problem: { kind: 'no-auth-file', path: join(home, 'nowhere', 'auth.json') },
    })

    mkdirSync(home, { recursive: true })
    writeFileSync(join(home, 'auth.json'), 'not json at all')
    const broken = readBearer(home)
    expect(broken.ok).toBe(false)
    if (broken.ok) return
    expect(broken.problem.kind).toBe('unreadable')
  })

  it('treats a file with no access token as no token, not as no file', () => {
    writeAuth({ tokens: {}, last_refresh: 'x' })
    const read = readBearer(home)
    expect(read.ok).toBe(false)
    if (read.ok) return
    expect(read.problem.kind).toBe('no-token')
  })

  it('survives a file with no last_refresh', () => {
    writeAuth({ tokens: { access_token: 't' } })
    const read = readBearer(home)
    expect(read.ok).toBe(true)
    if (!read.ok) return
    expect(read.value.lastRefresh).toBeNull()
  })
})

describe('minting an ephemeral key', () => {
  const bearer = { token: 't', lastRefresh: '2026-07-31T13:27:59.572850Z' }

  it('returns the key and the model it was minted for', async () => {
    const read = await mintEphemeralKey({
      bearer,
      fetch: answering(200, JSON.stringify({ value: 'ek_abc' })),
    })
    expect(read).toEqual({ ok: true, value: { key: 'ek_abc', model: 'gpt-realtime-2.1' } })
  })

  it('calls a 401 a stale token, and carries the date that explains it', async () => {
    // §51. The file parses, the account is right, and the service says no. That
    // is not "logged out", and telling somebody to sign in again is wrong advice
    // for a machine that is signed in.
    const read = await mintEphemeralKey({ bearer, fetch: answering(401, 'nope') })
    expect(read).toEqual({
      ok: false,
      problem: { kind: 'stale-token', lastRefresh: '2026-07-31T13:27:59.572850Z' },
    })
  })

  it('keeps other refusals distinct from staleness', async () => {
    const read = await mintEphemeralKey({ bearer, fetch: answering(500, 'boom') })
    expect(read).toEqual({
      ok: false,
      problem: { kind: 'refused', status: 500, body: 'boom' },
    })
  })

  it('reports an unreachable service rather than throwing out of a session open', async () => {
    const failing = (async () => {
      throw new Error('getaddrinfo ENOTFOUND')
    }) as typeof globalThis.fetch
    const read = await mintEphemeralKey({ bearer, fetch: failing })
    expect(read.ok).toBe(false)
    if (read.ok) return
    expect(read.problem.kind).toBe('unreachable')
  })

  it('refuses a 200 that carries no key', async () => {
    // §24: the mint endpoint validates nothing and will answer 200 to a model
    // that cannot exist. A success status is not a key.
    const read = await mintEphemeralKey({ bearer, fetch: answering(200, '{}') })
    expect(read.ok).toBe(false)
    if (read.ok) return
    expect(read.problem.kind).toBe('unreadable')
  })
})

describe('exchanging the offer', () => {
  const minted = { key: 'ek', model: 'gpt-realtime-2.1' } as const

  it('accepts the 201 the service actually sends', async () => {
    const read = await exchangeSdp({ offer: 'v=0...', minted, fetch: answering(201, 'v=0 answer') })
    expect(read).toEqual({ ok: true, value: 'v=0 answer' })
  })

  it('also accepts a 200, so a status change does not take the app down', async () => {
    const read = await exchangeSdp({ offer: 'v=0...', minted, fetch: answering(200, 'answer') })
    expect(read.ok).toBe(true)
  })

  it('reports anything else with the body, which is where the reason is', async () => {
    const read = await exchangeSdp({ offer: 'v=0', minted, fetch: answering(400, 'bad sdp') })
    expect(read).toEqual({
      ok: false,
      problem: { kind: 'refused', status: 400, body: 'bad sdp' },
    })
  })
})

describe('what the user is told', () => {
  it('names the fix for a stale token, which is not "sign in"', () => {
    const said = describeProblem({ kind: 'stale-token', lastRefresh: '2026-07-31T13:27:59Z' })
    expect(said).toContain('run `codex` once')
    expect(said).toContain('2026-07-31')
    expect(said).not.toContain('sign in')
  })

  it('does say "sign in" when there is genuinely no credential', () => {
    expect(describeProblem({ kind: 'no-auth-file', path: '/x/auth.json' })).toContain('sign in')
    expect(describeProblem({ kind: 'no-token' })).toContain('sign in')
  })
})
