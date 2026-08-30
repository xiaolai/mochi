/**
 * How old a claim about the machine is, said in words.
 *
 * The readiness card states something that can stop being true without this
 * window hearing: the CLI is checked once at launch and then only when somebody
 * presses the button, so "installed and signed in" may be a fact about a
 * machine as it was an hour ago. B1 draws the age beside the version —
 * "checked 2 minutes ago · v0.148.0" — and that is not decoration. A status with
 * no age asks to be believed indefinitely.
 *
 * Pure, and given `now` rather than reading a clock, for `format.ts`'s reason:
 * a phrase that says "2 minutes ago" about something four hours old still looks
 * plausible, so it has to be testable at chosen instants.
 */

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

/**
 * The version as B1 prints it: `v` and the number, out of whatever the CLI said.
 *
 * `codex --version` prints `codex-cli 0.151.0` and `askVersion` hands the whole
 * trimmed line to the wire, so the raw string carries a product name the card
 * has already said in words. The number is extracted with the same pattern
 * `readiness.ts` uses to compare it — one reading of one string, so the line
 * somebody reads and the comparison that drives "too old" cannot disagree about
 * which number is installed.
 *
 * Null when there is no number in there at all, which includes the literal
 * `unknown version` that `askVersion` falls back to. Printing `vunknown
 * version` would be worse than saying nothing.
 */
export function versionMark(version: string | null | undefined): string | null {
  if (typeof version !== 'string') return null
  const found = /(\d+(?:\.\d+)+)/.exec(version)
  return found === null ? null : `v${found[1] ?? ''}`
}

/**
 * When it was last looked at, and what was found. Null when there is nothing to
 * say — no check has finished and no version came back, which is the state
 * during the second or two after launch.
 *
 * A stamp in the FUTURE drops the age rather than reporting one. It means the
 * clock moved between the check and the read, so the elapsed time is not a
 * number anybody measured; the version is still true and is still printed.
 */
export function checkedLabel(probe: {
  readonly checkedAt: number | null
  readonly now: number
  readonly version: string | null
}): string | null {
  const mark = versionMark(probe.version)
  const age = probe.checkedAt === null ? null : probe.now - probe.checkedAt
  const when = age === null || !Number.isFinite(age) || age < 0 ? null : `checked ${ago(age)}`
  if (when === null) return mark
  return mark === null ? when : `${when} · ${mark}`
}

/** How long ago, at the coarseness the number is actually good for. */
function ago(span: number): string {
  if (span < MINUTE) return 'just now'
  if (span < HOUR) return plural(Math.floor(span / MINUTE), 'minute')
  if (span < DAY) return plural(Math.floor(span / HOUR), 'hour')
  return plural(Math.floor(span / DAY), 'day')
}

function plural(count: number, unit: string): string {
  return `${String(count)} ${unit}${count === 1 ? '' : 's'} ago`
}
