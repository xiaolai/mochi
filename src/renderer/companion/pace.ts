/**
 * Where in her own sentence she has got to — estimated, and self-correcting.
 *
 * ## Why this cannot simply be read off a frame
 *
 * The service says when an utterance's audio starts and when it stops
 * (`output_audio_buffer.started` / `.stopped`, both carrying `response_id`) and
 * it streams the text far in advance (§56, §57). **Nothing anywhere says which
 * word she is on.** So this is an estimate, and the design question is not how
 * to avoid estimating but how to keep the error small and harmless.
 *
 * ## Three things keep the error small
 *
 * 1. **It advances only while she is making sound.** A pause is the single
 *    biggest source of drift: at a flat rate, two seconds of silence between
 *    paragraphs runs the cursor thirty characters into text she has not said.
 *    The analyser already measures sound for the mouth, so the pause costs
 *    nothing to observe.
 * 2. **The rate is learned, not assumed.** When an utterance finishes, its true
 *    rate is known exactly — the cost of what she said over the sound she made
 *    saying it — so every utterance calibrates the next. §57's measurement is
 *    the seed, not the answer, which matters because the answer depends on the
 *    voice, the language and whatever the service does next year.
 * 3. **It never runs past what has been generated.** The cursor is clamped to
 *    the text in hand, so the failure mode is lagging, never inventing.
 *
 * ## And one thing makes the error harmless
 *
 * The bubble does not hide what she has not said yet. It shows the sentence,
 * dims what is still to come, and underlines the word the cursor is on. A reveal
 * that hides the future turns a half-second of drift into missing words; showing
 * it turns the same drift into an underline that is slightly off, with every
 * word still readable. **The estimate is a reading aid, not a gate.**
 */

/**
 * Seeded from §57 — 15.1 chars/s for English, and a Chinese glyph costing 3.68
 * of those. Wall-clock including her pauses, which is why it is only a seed:
 * this advances during SOUND, and sound is less than wall-clock, so the true
 * figure is higher. One completed utterance replaces it.
 */
const SEED_RATE = 15.1
export const CJK_COST = SEED_RATE / 4.1

/**
 * The band a learned rate must fall in, in cost units per second of sound.
 *
 * Not decoration. `ended()` divides by a measured duration, and a duration near
 * zero — an utterance cut off immediately, a clock that jumped — produces an
 * enormous rate that would then run the cursor to the end of every later
 * sentence. Clamping is what stops one bad sample poisoning the session.
 */
const SLOWEST = 4
const FASTEST = 60

/** How much of the new measurement to believe. Enough to adapt within two or
 * three utterances, little enough that one odd sentence does not swing it. */
const LEARN = 0.35

const CJK = /[⺀-〿぀-ヿ㐀-䶿一-鿿豈-﫿가-힯＀-￯]/u

export function costOf(glyph: string): number {
  return CJK.test(glyph) ? CJK_COST : 1
}

/** Where one word starts and ends around an index. Half-open, like `slice`. */
export interface Span {
  readonly from: number
  readonly to: number
}

/**
 * The word containing `index`, for underlining.
 *
 * "Word" is script-dependent for the same reason wrapping is: Chinese is not
 * space-delimited, so the unit a reader's eye lands on is the glyph. Underlining
 * to the next space in Chinese would underline the rest of the sentence.
 */
export function wordAt(text: string, index: number): Span | null {
  if (text === '' || index < 0) return null
  let at = Math.min(index, text.length - 1)
  // Whitespace belongs to no word, so carry FORWARD to the one she is about to
  // say. Returning null instead is defensible and looks wrong: a space takes
  // about 70ms at her measured rate, so the underline blinks off between every
  // pair of words for exactly long enough to notice.
  while (at < text.length && /\s/u.test(text[at] ?? '')) at += 1
  if (at >= text.length) return null
  const here = text[at] ?? ''
  if (CJK.test(here)) return { from: at, to: at + 1 }

  let from = at
  while (from > 0) {
    const before = text[from - 1] ?? ''
    if (/\s/u.test(before) || CJK.test(before)) break
    from -= 1
  }
  let to = at + 1
  while (to < text.length) {
    const after = text[to] ?? ''
    if (/\s/u.test(after) || CJK.test(after)) break
    to += 1
  }
  return { from, to }
}

export interface Pacer {
  /** Everything generated for this response so far. Replaces, does not append. */
  wrote(text: string): void
  /** Her audio for this response has begun. */
  began(): void
  /**
   * Her audio ended NATURALLY — `output_audio_buffer.stopped`.
   *
   * Two jobs: learn the true rate, and stop. The learning depends entirely on
   * this being the natural end, because that is what makes "she said all the
   * text that was generated" true, and that is the only known quantity to
   * divide by the measured sound.
   *
   * Called without a `began()` it does neither, rather than dividing by a
   * duration nobody measured.
   */
  ended(): void
  /**
   * She was cut off — `output_audio_buffer.cleared`.
   *
   * Stops, and deliberately learns NOTHING. An interrupted utterance said less
   * than was generated, so the same arithmetic would report a rate far too high
   * and then run the cursor to the end of every later sentence. Barge-in is
   * routine here (§17), so this is the common case, not an edge one.
   */
  cut(): void
  /** Advance. `sounding` is the analyser's answer, not a clock's. */
  step(dtSeconds: number, sounding: boolean): void
  /** Start a new utterance. The learned rate deliberately survives this. */
  restart(): void
  /** How far into the text she is estimated to be, as a character index. */
  at(): number
  /** Cost units per second of sound, as currently believed. Observable on purpose. */
  rate(): number
}

export function createPacer(): Pacer {
  let text = ''
  /** Cost consumed so far, and the character index that corresponds to. */
  let spent = 0
  let index = 0
  /**
   * Cost EARNED so far, which is not the same as cost consumed.
   *
   * At sixty frames a second one frame buys about a quarter of a character, so
   * a budget recomputed each frame as `spent + dt * rate` never reaches the
   * cost of a single glyph and the cursor never moves at all. The remainder has
   * to carry. This is the second time that has been got wrong in this file's
   * short history — it was right in the caller and dropped on the way out.
   */
  let budget = 0
  /** Seconds of SOUND since this utterance began. The denominator when learning. */
  let sounded = 0
  let speaking = false
  let rate = SEED_RATE

  /** Total cost of the text in hand, so the cursor can be clamped to it. */
  let total = 0

  function advanceTo(budget: number): void {
    while (index < text.length) {
      const cost = spent + costOf(text[index] ?? '')
      if (cost > budget) break
      spent = cost
      index += 1
    }
  }

  return {
    wrote(next: string) {
      // Recomputed rather than accumulated: the caller holds the authoritative
      // string, and two places appending to two copies is how they diverge.
      text = next
      total = 0
      for (const glyph of text) total += costOf(glyph)
    },
    began() {
      speaking = true
    },
    ended() {
      // `total`, NOT how far the cursor got. The cursor got exactly
      // `rate * sounded` by construction, so dividing THAT by the sound would
      // hand back the rate it started with and learn precisely nothing — a loop
      // that looks closed and is open. What is actually known at a natural end
      // is that she said all of it.
      //
      // Guarded on a measurable duration: `ended` can arrive for an utterance
      // that barely sounded, and dividing by that is where an absurd rate comes
      // from. The clamp catches whatever the guard does not.
      if (speaking && sounded > 0.5 && total > 0) {
        const measured = total / sounded
        const believable = Math.min(FASTEST, Math.max(SLOWEST, measured))
        rate = rate * (1 - LEARN) + believable * LEARN
      }
      // She finished, so she said all of it — whatever the estimate believed.
      // This is the one moment the true position is known, and not taking it
      // leaves the last clause dimmed while the bubble fades out over it.
      if (speaking) {
        index = text.length
        budget = total
        spent = total
      }
      speaking = false
    },
    cut() {
      speaking = false
    },
    step(dtSeconds: number, sounding: boolean) {
      if (!speaking || !sounding) return
      sounded += dtSeconds
      // Clamped to the text in hand. Lagging is a smaller fault than pointing at
      // a word she has not been given yet.
      budget = Math.min(total, budget + dtSeconds * rate)
      advanceTo(budget)
    },
    restart() {
      text = ''
      spent = 0
      index = 0
      budget = 0
      sounded = 0
      total = 0
      speaking = false
    },
    at: () => index,
    rate: () => rate,
  }
}
