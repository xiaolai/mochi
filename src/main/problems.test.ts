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
