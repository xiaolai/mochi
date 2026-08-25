/**
 * When to open the next session, given when this one expires.
 *
 * ## Why this is a schedule and not a recovery
 *
 * A session lasts an hour and **says so on its first frame** (§21), and §53 held
 * two of them to the end and found the announced deadline honoured to within one
 * second, twice. So there is nothing to detect: the drop is not an event to react
 * to, it is a time that is already known.
 *
 * That distinction is the whole feature. Reconnecting *after* the drop means she
 * goes silent, comes back, and the user saw it. Reconnecting before it means the
 * user never knows. §53 also established what the drop looks like when it does
 * arrive — an `error` frame with `code: "session_expired"`, then a data-channel
 * abort — so a late reconnect is recoverable, just audible.
 *
 * ## The numbers are measured, and the test says so
 *
 * `SETUP_MS` is not a guess. §48 and §50 timed the full open — mint, then
 * `POST /v1/realtime/calls`, then ICE, then the data channel — across twelve
 * runs on two machines and two networks. The worst was 5.8s. The two HTTPS round
 * trips are the variable part and cannot be overlapped, because the POST needs
 * the key the mint returns.
 *
 * A test asserts the constant still covers that worst observed run, so lowering
 * it means facing the measurement rather than editing a number.
 */

/** Worst full-open observed across §48 (7 runs) and §50 (5 runs), rounded up. */
export const SETUP_MS = 6_000

/**
 * Slack on top of setup.
 *
 * Small on purpose. §53 measured the deadline being kept to a second, so this is
 * not covering an uncertain expiry — it covers a machine that was asleep, a
 * timer that fired late, and one retry of a mint that took the long end of its
 * range.
 */
export const MARGIN_MS = 9_000

/**
 * How long after a session opens to reconnect when it never announced a
 * deadline.
 *
 * ## Why a floor is needed at all
 *
 * Everything above assumes `expires_at` arrives. It rides `session.created`,
 * the first frame — so a session that dies *before* that frame announces
 * nothing, and the scheduler that only ever runs on the announcement never
 * runs at all. There was exactly one trigger, and it was downstream of the
 * thing most likely to fail.
 *
 * The failure is silent and total: no timer is set, so she does not come back
 * on her own. Nothing is logged, because nothing happened. From the outside it
 * is indistinguishable from a quiet room.
 *
 * ## Why 50 minutes
 *
 * The service's session lifetime is an hour (§21, §53). This is that hour less
 * ten minutes, which is far more slack than the ~15s `SETUP_MS + MARGIN_MS`
 * the announced path uses — deliberately, because this path is running blind.
 * It is a backstop, not a schedule: whenever `expires_at` does arrive, the
 * precise timer replaces this one and this number stops mattering.
 *
 * Erring early is nearly free (one extra reconnect, unnoticeable) and erring
 * late is a session that drops audibly, so the asymmetry points down.
 */
export const FLOOR_MS = 50 * 60 * 1_000

export type Schedule =
  /** Set a timer for this many milliseconds. */
  | { readonly kind: 'in'; readonly ms: number }
  /** The moment has passed; open now. `overdueMs` is how late, for the log. */
  | { readonly kind: 'now'; readonly overdueMs: number }
  /**
   * The deadline cannot be used. NEVER silently treated as "never reconnect":
   * a session with no usable expiry still dies in an hour, and a caller that
   * quietly scheduled nothing would find out when she stopped talking.
   */
  | { readonly kind: 'unusable'; readonly why: string }

export function whenToReconnect(input: {
  /** Absolute Unix **seconds**, exactly as `session.created` sends it. */
  readonly expiresAt: number
  /** Milliseconds since the epoch. Injected so this stays a pure function. */
  readonly now: number
  readonly setupMs?: number
  readonly marginMs?: number
}): Schedule {
  const { expiresAt, now } = input
  const setupMs = input.setupMs ?? SETUP_MS
  const marginMs = input.marginMs ?? MARGIN_MS

  if (!Number.isFinite(expiresAt)) return { kind: 'unusable', why: 'expires_at is not a number' }
  if (!Number.isFinite(now)) return { kind: 'unusable', why: 'the clock is not a number' }
  if (expiresAt <= 0) return { kind: 'unusable', why: 'expires_at is not a real instant' }
  if (!Number.isFinite(setupMs) || !Number.isFinite(marginMs) || setupMs < 0 || marginMs < 0) {
    return { kind: 'unusable', why: 'the budget is not a usable duration' }
  }

  // `expires_at` is seconds; everything else here is milliseconds. Getting this
  // wrong by a factor of a thousand schedules the reconnect either an hour ago
  // or six weeks from now, and both look like a plausible number in a log.
  const deadline = expiresAt * 1_000
  const at = deadline - setupMs - marginMs
  const ms = at - now

  // `Math.abs`, not `-ms`. At the exact boundary `-ms` is `-0`, which is a
  // different value from `0` to `Object.is` and to anything that formats it —
  // a log line reading `overdue by -0ms` is a bug report waiting to happen.
  return ms > 0 ? { kind: 'in', ms } : { kind: 'now', overdueMs: Math.abs(ms) }
}
