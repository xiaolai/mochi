import { describe, expect, it } from 'vitest'
import { createProblems } from './problems'

describe('what went wrong', () => {
  it('keeps what it is told, newest first', () => {
    // Newest first because that is the order somebody reads them in: the thing
    // they just did is the thing they are asking about.
    let t = 0
    const p = createProblems(() => (t += 1))
    p.note('avatar', 'mine.json', 'eyeGlint is missing')
    p.note('persona', 'loki', 'greeting.verbatim is not text')

    expect(p.all().map((one) => one.subject)).toEqual(['loki', 'mine.json'])
    expect(p.count()).toBe(2)
  })

  it('drops the OLDEST when it fills up', () => {
    // A session reconnects hourly and can repeat the same voice problem all
    // day. Keeping the newest is what makes this answer "what is wrong now".
    const p = createProblems()
    for (let i = 0; i < 60; i += 1) p.note('voice', null, `problem ${String(i)}`)

    expect(p.count()).toBe(50)
    expect(p.all()[0]?.detail).toBe('problem 59')
    expect(p.all().some((one) => one.detail === 'problem 0')).toBe(false)
  })

  it('starts empty and can be emptied', () => {
    const p = createProblems()
    expect(p.count()).toBe(0)
    p.note('avatar', 'x.json', 'bad')
    p.clear()
    expect(p.all()).toEqual([])
  })

  it('carries a subject that may be absent', () => {
    // Not every problem is about a file. Forcing one would put a made-up name
    // in front of somebody trying to find the thing they broke.
    const p = createProblems()
    p.note('voice', null, 'the peer connection failed')
    expect(p.all()[0]?.subject).toBeNull()
  })
})

/**
 * The same fact, again and again, and the list it used to empty.
 *
 * MEASURED rather than imagined: running the app on 2026-08-28 against a
 * `.deleting` mark naming an unusable folder produced twelve identical entries
 * in a session about a minute long. The mark is deliberately left in place —
 * acting on a record nothing can read is worse — and `unfinishedDeletions` runs
 * on every catalogue load, so the repetition is by design and unbounded.
 *
 * The cap alone answered the wrong question. It decides WHICH entry to drop
 * when fifty are held; it does nothing about all fifty being one fact, and the
 * eviction rule means the repeater is exactly what survives.
 */
describe('a problem that keeps happening', () => {
  it('is one entry with a count, not one entry per occurrence', () => {
    const p = createProblems()
    for (let i = 0; i < 12; i += 1) {
      p.note('personas', null, 'an unfinished deletion names an unusable folder')
    }
    expect(p.count()).toBe(1)
    expect(p.all()[0]?.seen).toBe(12)
  })

  it('counts from one, so the field is never a number nobody can read', () => {
    const p = createProblems()
    p.note('voice', null, 'the peer connection failed')
    expect(p.all()[0]?.seen).toBe(1)
  })

  it('carries the LATEST time, not the first', () => {
    // The list answers "what is wrong now". A recurring failure filed under the
    // first time anyone saw it reads as something that stopped.
    let t = 0
    const p = createProblems(() => (t += 1))
    p.note('voice', null, 'cannot reconnect')
    p.note('voice', null, 'cannot reconnect')
    expect(p.all()[0]?.at).toBe(2)
  })

  it('moves back to the front when it happens again', () => {
    let t = 0
    const p = createProblems(() => (t += 1))
    p.note('voice', null, 'cannot reconnect')
    p.note('avatar', 'mine.json', 'eyeGlint is missing')
    p.note('voice', null, 'cannot reconnect')
    expect(p.all().map((one) => one.detail)).toEqual(['cannot reconnect', 'eyeGlint is missing'])
  })

  it('DOES NOT push the other problems out — the defect this fixes', () => {
    /*
      The whole point. Before the collapse, sixty repeats of one fact evicted
      every other entry, so the drawer said one thing was wrong and it was the
      one thing already visible on every launch. The voice failure and the
      refused key — the two nobody can find any other way, because a packaged
      app has no console — were gone.
    */
    const p = createProblems()
    p.note('voice', null, 'the peer connection failed')
    p.note('keys', null, 'another application already has it')
    for (let i = 0; i < 60; i += 1) {
      p.note('personas', null, 'an unfinished deletion names an unusable folder')
    }
    expect(p.all().map((one) => one.area)).toEqual(['personas', 'keys', 'voice'])
  })

  it('tells two facts apart by every field, not just the words', () => {
    // Same sentence about two different files is two problems. Collapsing on
    // the detail alone would hide the second file entirely.
    const p = createProblems()
    p.note('avatar', 'mine.json', 'eyeGlint is missing')
    p.note('avatar', 'theirs.json', 'eyeGlint is missing')
    p.note('persona', 'mine.json', 'eyeGlint is missing')
    expect(p.count()).toBe(3)
    expect(p.all().every((one) => one.seen === 1)).toBe(true)
  })
})

describe('telling somebody', () => {
  it('reports the new count on every note', () => {
    // Half these sites fire long after the session config was answered, and
    // those are the ones that present as her quietly declining to do something.
    const counts: number[] = []
    const p = createProblems()
    p.watch((count) => counts.push(count))
    p.note('capability', 'read_file', 'threw')
    p.note('voice', null, 'cannot schedule a reconnect')
    expect(counts).toEqual([1, 2])
  })

  it('reports zero when the list is emptied', () => {
    const counts: number[] = []
    const p = createProblems()
    p.note('avatar', 'mine.json', 'bad')
    p.watch((count) => counts.push(count))
    p.clear()
    expect(counts).toEqual([0])
  })

  it('reports the CAPPED count, not the number ever noted', () => {
    // The badge means "how many are readable", and past the cap those are two
    // different numbers.
    let last = -1
    const p = createProblems()
    p.watch((count) => (last = count))
    for (let i = 0; i < 60; i += 1) p.note('voice', null, `problem ${String(i)}`)
    expect(last).toBe(50)
  })
})
