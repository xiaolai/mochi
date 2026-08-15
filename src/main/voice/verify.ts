/**
 * Does this credential actually work?
 *
 * The shape check in `shared/auth.ts` proves a key LOOKS like a key. That is
 * worth having — it catches a pasted URL immediately — and it proves nothing
 * about whether OpenAI will accept it. A revoked key, a key from the wrong
 * organisation and a key with a typo in the middle all pass the shape check and
 * all fail at the moment somebody speaks to her, fifteen seconds into a wake,
 * with the failure surfacing as "she cannot reach a voice".
 *
 * So the settings window can ask. One round trip to the cheapest authenticated
 * endpoint there is: `GET /v1/models` returns 200 for a usable key and 401 for
 * anything else, bills nothing, and creates no session.
 *
 * ## What a 200 does and does not prove
 *
 * That the key authenticates — not that it may open a Realtime session. A
 * project key scoped to exclude Realtime answers this endpoint happily and
 * fails at the wake. The honest alternative is minting an ephemeral Realtime
 * key, which is a heavier call on a path somebody is watching, and would spend
 * quota to answer a question asked from a settings pane. So this checks the
 * credential and says "Working", which is true of the credential; a scope
 * problem still surfaces at the first wake, with the session's own error.
 *
 * In MAIN, necessarily. The renderer has no key and its `connect-src` has no
 * `api.openai.com` in it, both deliberately — see `credential.ts`.
 */

/** Bounded, because every network call on a path a person is waiting on is. */
const TIMEOUT_MS = 10_000

const MODELS_URL = 'https://api.openai.com/v1/models'

export type KeyVerdict =
  | { readonly kind: 'ok' }
  /**
   * The service answered and refused the CREDENTIAL. 401 or 403 only.
   *
   * Narrowed deliberately. Every non-2xx used to land here, so a 429 or a 500
   * told the user their key was refused — and the action that suggests is to
   * go and get a new key, which is wrong and costs them one. A rate limit says
   * the key is fine and you asked too often.
   */
  | { readonly kind: 'rejected'; readonly status: number }
  /** The service answered, but about itself rather than about the key. */
  | { readonly kind: 'unavailable'; readonly status: number }
  /**
   * No answer: offline, a proxy in the way, DNS, a timeout.
   *
   * Carries no detail, deliberately. Everything available here is derived from
   * an exception raised by a request that had a bearer in its headers.
   */
  | { readonly kind: 'unreachable' }

/**
 * Ask OpenAI whether it knows this key.
 *
 * Distinguishes REJECTED from UNREACHABLE, and the difference is the whole
 * value: one means fix your key, the other means fix your network, and telling
 * somebody to re-paste a perfectly good key because their proxy is down is the
 * kind of advice that costs an hour. In mainland China without a proxy this
 * call simply does not complete, which is the ordinary case here rather than an
 * exotic one.
 */
export async function verifyApiKey(key: string): Promise<KeyVerdict> {
  try {
    const response = await fetch(MODELS_URL, {
      method: 'GET',
      headers: { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    // The body is CANCELLED, never merely ignored. Nothing here reads it -- the
    // status is the whole answer -- and an unread body holds its connection
    // open and goes on downloading, which for `/v1/models` is a list of every
    // model the account can see. Cancelling frees both immediately.
    await response.body?.cancel()
    if (response.ok) return { kind: 'ok' }
    // Only these two are statements about the credential.
    return response.status === 401 || response.status === 403
      ? { kind: 'rejected', status: response.status }
      : { kind: 'unavailable', status: response.status }
  } catch {
    // NOTHING derived from the exception. The comment that used to sit here
    // asserted that `fetch` puts the URL in the message and not the headers,
    // so `String(error)` was safe. That is false, and measurably so:
    //
    //   Bearer sk-aaaa…\nX-Evil: 1
    //   -> TypeError: Headers.append: "Bearer sk-aaaa… X-Evil: 1" is an
    //      invalid header value.
    //
    // Node puts the whole header VALUE in the message for a malformed one, so
    // the bearer lands in whatever logs the detail. `apiKeyProblem` rejects
    // whitespace before storage, which makes it hard to reach — and "hard to
    // reach" is not the guarantee the comment claimed. A fixed string cannot
    // leak, and the caller only ever distinguishes unreachable from rejected.
    console.error('[auth] the key check could not reach OpenAI')
    return { kind: 'unreachable' }
  }
}
