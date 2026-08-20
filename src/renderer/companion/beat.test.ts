import { describe, expect, it } from 'vitest'
import { createBeat, OVERDUE_S } from './beat'

/** One frame at sixty a second, which is what the render loop hands it. */
const FRAME = 1 / 60

/** Run the loop for a while with nothing coming back from her. */
function silence(beat: ReturnType<typeof createBeat>, seconds: number): void {
  for (let t = 0; t < seconds; t += FRAME) beat.step(FRAME, false)
}

describe('opening the beat', () => {
  it('is closed until a turn ends', () => {
    const beat = createBeat()
    expect(beat.state()).toBe('none')
    silence(beat, 5)
    expect(beat.state()).toBe('none')
  })

  it('opens on the frame after the turn ended', () => {
    // Deliberately not inside `turnEnded` itself: the decision needs to see
    // whether she is already making sound, and only `step` is told that.
    const beat = createBeat()
    beat.turnEnded()
    expect(beat.state()).toBe('none')
    expect(beat.step(FRAME, false)).toBe('held')
  })

  it('never opens when she is already speaking', () => {
    // Otherwise a turn ending under her own voice — which is what a barge-in
    // looks like from here — would flash a beat for exactly one frame.
    const beat = createBeat()
    beat.turnEnded()
    expect(beat.step(FRAME, true)).toBe('none')
    expect(beat.step(FRAME, false)).toBe('none')
  })

  it('is not restarted by a second turn ending inside it', () => {
    // Somebody clearing their throat mid-wait would otherwise push `overdue`
    // out of reach for as long as they kept doing it.
    const beat = createBeat()
    beat.turnEnded()
    silence(beat, OVERDUE_S - 0.5)
    beat.turnEnded()
    silence(beat, 0.6)
    expect(beat.state()).toBe('overdue')
  })
})

describe('leaving it', () => {
  it('closes on the first frame the analyser reports her voice', () => {
    // §64 measured `output_audio_buffer.started` arriving with NO audio behind
    // it, on the same two utterances in every arm. The started frame is a
    // promise of audio; this is audio.
    const beat = createBeat()
    beat.turnEnded()
    silence(beat, 1)
    expect(beat.state()).toBe('held')
    expect(beat.step(FRAME, true)).toBe('none')
    expect(beat.heldFor()).toBe(0)
  })

  it('closes out of overdue too, and can open again on the next turn', () => {
    const beat = createBeat()
    beat.turnEnded()
    silence(beat, OVERDUE_S + 0.5)
    expect(beat.state()).toBe('overdue')
    expect(beat.step(FRAME, true)).toBe('none')

    beat.turnEnded()
    expect(beat.step(FRAME, false)).toBe('held')
  })

  it('is cleared outright when they start talking again', () => {
    const beat = createBeat()
    beat.turnEnded()
    silence(beat, 1)
    beat.reset()
    expect(beat.state()).toBe('none')
    silence(beat, 5)
    expect(beat.state()).toBe('none')
  })
})

describe('the wait that never settles', () => {
  it('holds through everything §64 measured before calling it overdue', () => {
    // The worst arm in the sweep is `server_vad` at 900ms: 2220ms P90 from the
    // end of the clip, and this beat opens ~350ms after that. Anything inside
    // the measured band must still read as waiting, not as a failure.
    const beat = createBeat()
    beat.turnEnded()
    silence(beat, 1.99)
    expect(beat.state()).toBe('held')
  })

  it('gives up at three seconds, which is well past the shipped P90', () => {
    const beat = createBeat()
    beat.turnEnded()
    silence(beat, OVERDUE_S + FRAME)
    expect(beat.state()).toBe('overdue')
  })

  it('stays overdue rather than lapsing back into silence', () => {
    // The whole complaint is open-ended silence. A mark that timed itself out
    // would restore exactly that, a few seconds later.
    const beat = createBeat()
    beat.turnEnded()
    silence(beat, 30)
    expect(beat.state()).toBe('overdue')
  })

  it('takes the threshold it was built with', () => {
    const beat = createBeat(1)
    beat.turnEnded()
    silence(beat, 1.1)
    expect(beat.state()).toBe('overdue')
  })
})

describe('the clock it is handed', () => {
  it('survives a frame that reports nonsense', () => {
    // The render loop's delta comes from `requestAnimationFrame` timestamps,
    // which jump when the window is occluded and are absent on the first frame.
    const beat = createBeat()
    beat.turnEnded()
    beat.step(Number.NaN, false)
    expect(beat.state()).toBe('held')
    expect(beat.heldFor()).toBe(0)
  })

  it('does not let one long frame skip the whole wait', () => {
    // A backgrounded window can hand back a delta of several seconds. Clamped,
    // so returning to the tab does not find her already asking them to repeat.
    const beat = createBeat()
    beat.turnEnded()
    beat.step(10, false)
    expect(beat.state()).toBe('held')
  })

  it('fades in rather than snapping into existence', () => {
    const beat = createBeat()
    beat.turnEnded()
    beat.step(FRAME, false)
    const early = beat.opacity()
    expect(early).toBeGreaterThan(0)
    expect(early).toBeLessThan(1)
    silence(beat, 0.5)
    expect(beat.opacity()).toBe(1)
  })

  it('has no opacity at all when there is no beat', () => {
    expect(createBeat().opacity()).toBe(0)
  })
})
