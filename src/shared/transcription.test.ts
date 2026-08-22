import { describe, expect, it } from 'vitest'
import {
  MOST_LANGUAGES,
  OFFERED_LANGUAGES,
  TRANSCRIPTION_MODEL,
  isLanguageCode,
  readLanguages,
  transcriptionConfig,
} from './transcription'

/**
 * What the user said, turned into text — the settings half.
 *
 * The model is a constant and the languages are somebody's choice, so these
 * cover two different kinds of failure: a wire value that silently changed, and
 * a stored choice that does not survive being read back.
 */

describe('the model she is transcribed by', () => {
  it('is the committed-turn one, named rather than implied', () => {
    // Pinned so a swap is a deliberate edit with a test to change, not a typo
    // in a session literal nothing can construct. `whisper-1` was what this
    // shipped with and is the oldest of the set; `gpt-live-transcribe` sells
    // low-latency deltas this application has no consumer for.
    expect(TRANSCRIPTION_MODEL).toBe('gpt-transcribe')
  })
})

describe('a language code', () => {
  it('is two lowercase letters, and nothing else is', () => {
    expect(isLanguageCode('en')).toBe(true)
    expect(isLanguageCode('zh')).toBe(true)
    // The shapes a hand-edited file or a broken page can actually produce.
    expect(isLanguageCode('EN')).toBe(false)
    expect(isLanguageCode('eng')).toBe(false)
    expect(isLanguageCode('e')).toBe(false)
    expect(isLanguageCode('e1')).toBe(false)
    expect(isLanguageCode('')).toBe(false)
    expect(isLanguageCode(null)).toBe(false)
    expect(isLanguageCode(['en'])).toBe(false)
    expect(isLanguageCode(12)).toBe(false)
  })

  it('is checked by GRAMMAR, not by what this build happens to offer', () => {
    // A `preferences.json` written by a later version naming a language this
    // build does not draw is ordinary rather than corrupt -- the tolerance
    // `readRealtimeModel` shows for a model it has not heard of. Dropping it
    // would silently undo somebody's choice on the next launch.
    const offered = new Set(OFFERED_LANGUAGES.map((one) => one.code))
    expect(offered.has('cy')).toBe(false)
    expect(isLanguageCode('cy')).toBe(true)
    expect(readLanguages(['cy'])).toEqual(['cy'])
  })
})

describe('reading a stored choice', () => {
  it('keeps the codes, in the order they were chosen', () => {
    expect(readLanguages(['zh', 'en'])).toEqual(['zh', 'en'])
  })

  it('answers EMPTY for anything that is not a list of codes', () => {
    // Empty is a real answer here and not a failure: it means send no hint and
    // let the model detect. Every one of these is a file somebody could have
    // on disk right now.
    for (const value of [undefined, null, 'en', 42, {}, { en: true }]) {
      expect(readLanguages(value), JSON.stringify(value ?? null)).toEqual([])
    }
  })

  it('drops the entries that are not codes and keeps the rest', () => {
    expect(readLanguages(['en', 'ENGLISH', 7, null, 'zh'])).toEqual(['en', 'zh'])
  })

  it('collapses duplicates rather than hinting the same language twice', () => {
    expect(readLanguages(['en', 'en', 'zh'])).toEqual(['en', 'zh'])
  })

  it('stops at the bound, because a file can name forty', () => {
    const many = ['en', 'zh', 'es', 'hi', 'ar', 'pt', 'ru', 'ja', 'de', 'fr']
    expect(many.length).toBeGreaterThan(MOST_LANGUAGES)
    expect(readLanguages(many)).toHaveLength(MOST_LANGUAGES)
    // The first ones, so the bound is a truncation of a known order rather
    // than an arbitrary subset.
    expect(readLanguages(many)).toEqual(many.slice(0, MOST_LANGUAGES))
  })
})

describe('the languages offered on screen', () => {
  it('gives every entry a code the grammar accepts', () => {
    for (const one of OFFERED_LANGUAGES) {
      expect(isLanguageCode(one.code), one.code).toBe(true)
    }
  })

  it('names each language once, and labels each one once', () => {
    // Two rows with one code would let a pane draw a selection it cannot show
    // back, and two labels for one language is a list nobody can read.
    expect(new Set(OFFERED_LANGUAGES.map((one) => one.code)).size).toBe(OFFERED_LANGUAGES.length)
    expect(new Set(OFFERED_LANGUAGES.map((one) => one.label)).size).toBe(OFFERED_LANGUAGES.length)
  })

  it('offers more than anybody may choose at once', () => {
    // Otherwise the bound is not a bound, it is the whole list.
    expect(OFFERED_LANGUAGES.length).toBeGreaterThan(MOST_LANGUAGES)
  })
})

/**
 * The one decision `session.ts` makes about this, extracted so it can be made
 * here. That file holds `RTCPeerConnection` and nothing can construct it.
 */
describe('what goes on the wire', () => {
  it('OMITS languages entirely when nothing was chosen', () => {
    // Not `languages: []`. An empty list is a claim about what will be spoken
    // -- expect none of these -- and the absence of the field is the model
    // detecting, which is what the default exists for.
    const sent = transcriptionConfig({ model: 'gpt-transcribe', languages: [] })
    expect(sent).toEqual({ model: 'gpt-transcribe' })
    expect('languages' in sent).toBe(false)
  })

  it('sends them when there are some', () => {
    expect(transcriptionConfig({ model: 'gpt-transcribe', languages: ['en', 'zh'] })).toEqual({
      model: 'gpt-transcribe',
      languages: ['en', 'zh'],
    })
  })

  it('copies the list rather than handing out the stored one', () => {
    const languages = ['en', 'zh']
    const sent = transcriptionConfig({ model: 'gpt-transcribe', languages })
    expect(sent.languages).not.toBe(languages)
  })
})
