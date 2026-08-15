import { afterEach, describe, expect, it, vi } from 'vitest'
import { verifyApiKey } from './verify'

const original = globalThis.fetch
afterEach(() => {
  globalThis.fetch = original
})

const answer = (status: number): void => {
  globalThis.fetch = vi.fn(async () => Promise.resolve(new Response(null, { status })))
}

describe('verifying a key against OpenAI', () => {
  it('accepts a key the service recognises', async () => {
    answer(200)
    expect(await verifyApiKey('sk-whatever')).toEqual({ kind: 'ok' })
  })

  it('distinguishes REFUSED from UNREACHABLE', async () => {
    // The distinction is the whole value. One means fix your key, the other
    // means fix your network -- and telling somebody to re-paste a perfectly
    // good key because their proxy is down costs an hour. From mainland China
    // without a proxy this call simply does not complete, so unreachable is the
    // ordinary case here rather than an exotic one.
    answer(401)
    expect(await verifyApiKey('sk-whatever')).toEqual({ kind: 'rejected', status: 401 })

    globalThis.fetch = vi.fn(async () =>
      Promise.reject(new Error('getaddrinfo ENOTFOUND api.openai.com')),
    )
    const verdict = await verifyApiKey('sk-whatever')
    expect(verdict.kind).toBe('unreachable')
  })

  it('reads only 401 and 403 as statements about the credential', async () => {
    // This assertion used to be `{ kind: 'rejected', status: 429 }`, under a
    // test named "so 429 is not read as a bad key" -- the number was attached
    // and the VERDICT still said refused, which is the part the pane renders.
    // The advice that follows a refusal is "go and issue a new key", and doing
    // that because OpenAI was busy for a minute costs a working credential.
    for (const status of [401, 403]) {
      answer(status)
      expect(await verifyApiKey('sk-whatever'), String(status)).toEqual({
        kind: 'rejected',
        status,
      })
    }
    for (const status of [429, 500, 502, 503]) {
      answer(status)
      expect(await verifyApiKey('sk-whatever'), String(status)).toEqual({
        kind: 'unavailable',
        status,
      })
    }
  })
  it('sends the key as a bearer and nowhere else', async () => {
    let seen: { url: string; init: RequestInit } | null = null
    globalThis.fetch = async (url, init) => {
      const href = url instanceof URL ? url.href : url instanceof Request ? url.url : url
      seen = { url: href, init: init ?? {} }
      return new Response(null, { status: 200 })
    }
    await verifyApiKey('sk-secret-value')

    expect(seen).not.toBeNull()
    const call = seen as unknown as { url: string; init: RequestInit }
    // Not in the URL: a key in a query string lands in every proxy log between
    // here and there.
    expect(call.url).toBe('https://api.openai.com/v1/models')
    expect(call.url).not.toContain('sk-secret')
    expect((call.init.headers as Record<string, string>)['Authorization']).toBe(
      'Bearer sk-secret-value',
    )
  })

  it('never puts the key in the failure it returns', async () => {
    // A bearer inside a thrown fetch error is a bearer in a log file.
    globalThis.fetch = vi.fn(async () => Promise.reject(new Error('connect ETIMEDOUT')))
    const verdict = await verifyApiKey('sk-secret-value')
    expect(JSON.stringify(verdict)).not.toContain('sk-secret-value')
  })

  it('gives up rather than hanging on a dead network', async () => {
    // Bounded, because somebody is watching a spinner.
    let signal: AbortSignal | null = null
    globalThis.fetch = async (_url, init) => {
      signal = init?.signal ?? null
      return new Response(null, { status: 200 })
    }
    await verifyApiKey('sk-whatever')
    expect(signal).toBeInstanceOf(AbortSignal)
  })
})

describe('the verdict cannot carry the key', () => {
  it('returns no detail at all from a thrown request', async () => {
    // Measured, not assumed. The comment this replaces claimed `fetch` puts the
    // URL in a thrown message and not the headers. It does not:
    //
    //   Bearer sk-aaaa…\nX-Evil: 1
    //   -> TypeError: Headers.append: "Bearer sk-aaaa… X-Evil: 1" is an
    //      invalid header value.
    //
    // Every field of an unreachable verdict is therefore fixed text.
    globalThis.fetch = async () => {
      throw new TypeError('Headers.append: "Bearer sk-secret-value" is an invalid header value.')
    }
    const verdict = await verifyApiKey('sk-secret-value')
    expect(verdict).toEqual({ kind: 'unreachable' })
    expect(JSON.stringify(verdict)).not.toContain('sk-secret')
    expect(JSON.stringify(verdict)).not.toContain('Bearer')
  })
})
