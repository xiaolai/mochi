/**
 * A wall clock on every line the app prints, in both processes.
 *
 * ## What was wrong with the log before this
 *
 * The renderer stamped `+50846ms` from the moment the SESSION opened -- which
 * resets on every reconnect -- and the main process stamped nothing at all: 15
 * prefixes across roughly 114 call sites, none of them timestamped. So
 * `[memory] codex exited with 1` and `[voice +152597ms] taken at teardown`
 * could not be ordered against each other, and the two processes interleave on
 * one stream. Reading a real conversation meant inferring order from position,
 * which is a guess dressed as evidence.
 *
 * Both offsets are kept, not replaced. The relative one is what makes a single
 * session readable -- "she was audible 7.2 seconds" is a subtraction you do by
 * eye -- and the wall clock is what joins the two processes and separates one
 * `pnpm dev` run from the next.
 *
 * ## Why this WRAPS console rather than offering a helper
 *
 * A helper is a convention, and the requirement here is "every line". A
 * convention is forgotten exactly at the call site somebody adds while chasing
 * a bug at midnight -- which is the line that most needed a timestamp. Wrapping
 * makes an unstamped line unreachable rather than discouraged.
 *
 * The cost, stated rather than discovered: this is action at a distance. Code
 * that calls `console.log` gets behaviour it did not ask for, and anything
 * parsing this app's stdout sees a prefix. Both are acceptable for a process we
 * own end to end, and neither would be acceptable in a library.
 *
 * ## What "every line" actually means, exactly
 *
 * ONE stamp per console EVENT, at its head -- not per physical output line. A
 * message containing a newline, or an `Error` whose stack is printed by the
 * console itself, produces continuation lines with no clock of their own; they
 * belong to the stamped line above them.
 *
 * Prefixing every physical line was tried and rejected on the content: she is
 * logged verbatim, transcripts contain newlines, and a clock spliced into the
 * middle of a quoted string corrupts the thing being logged in order to
 * describe it. Ordering does not need it either -- an event carries a clock at
 * its head and a continuation line visibly carries none, so nothing has to be
 * inferred from position.
 */

/**
 * `2026-08-16T19:40:33.412+08:00`. Local time, because the reader is at this
 * machine -- but the whole of it, because the reader is at this machine for
 * DAYS.
 *
 * A time-only stamp was the first version and it cannot order the log of a
 * resident process: `00:00:01.000` sorts before `23:59:59.000` from the evening
 * before, and an autumn daylight-saving fall-back prints the same local hour
 * twice with no way to tell the passes apart. The date fixes the first and the
 * UTC offset fixes the second, so this is ISO 8601 rather than something
 * shorter and locally invented.
 *
 * Fixed width, deliberately: 29 characters for every value the format can take,
 * so the column can be read down. That is the whole reason the offset is
 * spelled `+00:00` rather than collapsing to `Z` at UTC.
 */
export function stamp(at: Date): string {
  const pad = (value: number, width = 2): string => String(value).padStart(width, '0')
  const date = `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`
  const time = `${pad(at.getHours())}:${pad(at.getMinutes())}:${pad(at.getSeconds())}.${pad(at.getMilliseconds(), 3)}`
  // `getTimezoneOffset` counts minutes BEHIND UTC, so its sign is the opposite
  // of the one ISO 8601 prints. Getting this backwards is invisible in the
  // half of the world it was written in.
  const behind = at.getTimezoneOffset()
  const sign = behind <= 0 ? '+' : '-'
  const minutes = Math.abs(behind)
  return `${date}T${time}${sign}${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`
}

/**
 * The grammar of a line that already carries a wall clock at its head.
 *
 * ONE definition, exported, because there were two and they had already
 * drifted: `renderer-entry.ts` carried its own copy that required a literal
 * space and a payload, so a timestamp-only line was tagged in FRONT of its
 * clock and then stamped a second time by main. Two copies of a grammar is two
 * grammars.
 */
const STAMP_HEAD =
  /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}[+-]\d{2}:\d{2})(?:[ \t]([\s\S]*))?$/

/** A message split into the clock it arrived with and the rest of it, or `null`. */
export interface StampedLine {
  readonly at: string
  readonly rest: string
}

/** The clock at the head of a line and what follows it, or `null` if it has none. */
export function splitStamp(message: string): StampedLine | null {
  const found = STAMP_HEAD.exec(message)
  if (found === null) return null
  return { at: found[1] ?? '', rest: found[2] ?? '' }
}

/** Whether a line already carries a wall clock at its head. */
export function isStamped(message: string): boolean {
  return STAMP_HEAD.test(message)
}

/** The three console methods that carry this app's own narration. */
const WRAPPED = ['log', 'warn', 'error'] as const

export type LogLevel = (typeof WRAPPED)[number]

type Method = (...args: unknown[]) => void

/**
 * One installation, as a single record with an identity.
 *
 * Two loose flags (`__mochiStamped` plus `__mochiUnstamp`) could disagree: the
 * boolean alone made `installLogStamp` return a silent no-op that claimed
 * success, so the process ran unstamped while every caller believed otherwise.
 * A record is either present and complete or absent.
 *
 * `wrappers` is what makes uninstall lifecycle-safe. Without it, cleanup
 * restored whatever it had captured over whatever happened to be there -- so an
 * uninstall called after a reinstall put the FIRST installation's originals
 * back over the second's wrappers, and deleted the second's marker.
 */
interface Installation {
  readonly token: symbol
  readonly originals: ReadonlyMap<LogLevel, Method>
  readonly wrappers: ReadonlyMap<LogLevel, Method>
  readonly uninstall: () => void
}

/**
 * Where the record lives.
 *
 * On the CONSOLE object, not in a module-level variable: Vite can hold two
 * copies of a module and there is only ever one console. A registered symbol
 * rather than a string key, so the two copies agree on it and nothing else in
 * the process can collide with it by accident.
 */
const RECORD = Symbol.for('mochi.log.installation')

function host(): Record<string | symbol, unknown> {
  return globalThis.console as unknown as Record<string | symbol, unknown>
}

function isInstallation(value: unknown): value is Installation {
  if (typeof value !== 'object' || value === null) return false
  const record = value as Partial<Installation>
  return (
    typeof record.token === 'symbol' &&
    record.originals instanceof Map &&
    record.wrappers instanceof Map &&
    typeof record.uninstall === 'function'
  )
}

/** The installation currently owning the console, if this process has one. */
function current(): Installation | null {
  const found = host()[RECORD]
  if (found === undefined) return null
  if (!isInstallation(found)) {
    // Loud, because the quiet version of this shipped: a marker without a
    // usable uninstall returned a no-op, and the process logged unstamped for
    // the rest of its life while `installLogStamp` reported success.
    throw new Error('console carries a mochi log marker that is not an installation record')
  }
  return found
}

/**
 * Prefix every `console.log`/`warn`/`error` with the wall clock.
 *
 * Idempotent by construction: a second call with the wrapper already installed
 * returns the same uninstall and wraps nothing further. Two installs would
 * double-stamp, and the renderer entry point is the kind of module that gets
 * imported twice during a hot reload.
 *
 * Returns the uninstall so a test can assert the wrapping and then leave the
 * console as it found it -- a suite that permanently rewrites `console` in the
 * first file to import it is a suite whose later failures print wrong.
 */
export function installLogStamp(now: () => Date = () => new Date()): () => void {
  const existing = current()
  if (existing !== null) return existing.uninstall

  const target = host()
  const originals = new Map<LogLevel, Method>()
  const wrappers = new Map<LogLevel, Method>()
  const token = Symbol('mochi.log.installation')

  for (const method of WRAPPED) {
    const before = target[method] as Method
    const wrapper = (...args: unknown[]): void => {
      before.call(globalThis.console, ...withStamp(stamp(now()), args))
    }
    originals.set(method, before)
    wrappers.set(method, wrapper)
    target[method] = wrapper
  }

  const record: Installation = {
    token,
    originals,
    wrappers,
    uninstall: (): void => {
      // Idempotent, and safe after somebody else installed: this is not the
      // active record, so there is nothing here that belongs to us.
      if (host()[RECORD] !== record) return
      const ours = WRAPPED.every((method) => target[method] === wrappers.get(method))
      if (!ours) {
        // Refuse rather than clobber. Restoring here would delete a later
        // component's wrapper, which is the failure this check exists for.
        const before = originals.get('warn')
        before?.call(globalThis.console, `${stamp(now())} [log] console was rewrapped; left as is`)
        return
      }
      for (const [method, before] of originals) target[method] = before
      delete target[RECORD]
    },
  }
  target[RECORD] = record
  return record.uninstall
}

/**
 * Where the stamp goes, given what the caller passed.
 *
 * PREPENDED to a leading string rather than pushed in front of it, because
 * `console.log` treats its first string argument as a FORMAT: passing the clock
 * as a new first argument made `console.log('value=%s', value)` print
 * `19:40:33.412 value=%s value` instead of substituting. Every placeholder in
 * the app broke silently the day stamping arrived.
 *
 * Anything else -- an object, an `Error`, nothing at all -- takes the clock as a
 * separate argument, which is what the console formats it as anyway.
 */
function withStamp(at: string, args: readonly unknown[]): unknown[] {
  if (args.length > 0 && typeof args[0] === 'string') return [`${at} ${args[0]}`, ...args.slice(1)]
  return [at, ...args]
}

/**
 * Write a line that already carries a clock, without adding a second one.
 *
 * PROVENANCE, not inference. The first version sniffed every message for
 * something timestamp-shaped and skipped stamping it, which meant any ordinary
 * text of that shape -- a transcript of somebody reading a time out loud, a
 * pasted log -- silently escaped stamping and was then read as though it had
 * come from the other process. Only the forwarder knows a line is forwarded, so
 * only the forwarder gets to say so.
 *
 * Writes through the ORIGINAL method, so the wrapper never sees it. With no
 * installation active this is an ordinary console call.
 */
export function writeForwarded(level: LogLevel, line: string): void {
  const record = current()
  const write = record?.originals.get(level) ?? (host()[level] as Method)
  write.call(globalThis.console, line)
}

/**
 * A short name for one launch of the app, so pasted logs can be told apart.
 *
 * Not a UUID: this is read by a person comparing two runs in a scrollback, and
 * six characters is enough to see at a glance that two lines belong to
 * different launches. It is not a key and nothing looks it up.
 */
export function runName(at: Date, random: () => number = Math.random): string {
  const pad = (value: number): string => String(value).padStart(2, '0')
  const noise = Math.floor(random() * 46_656)
    .toString(36)
    .padStart(3, '0')
  return `${pad(at.getMonth() + 1)}${pad(at.getDate())}-${noise}`
}
