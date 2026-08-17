/**
 * The single writer to her mouth.
 *
 * One object owns `setMouthOpen`, and that is the whole point rather than a
 * tidiness preference. The mouth is layer 4 and is written last, so nothing
 * above it can arbitrate between two sources -- two writers produce a mouth
 * flickering between them at whatever rate they happen to disagree, and no
 * layer ordering can fix it.
 *
 * ## Where the viseme path goes
 *
 * The mouth has two paths and they are not a ladder: cloud speech-to-speech
 * carries no phoneme timings, so the envelope is the only thing available
 * there, not a fallback. The five-vowel path belongs to a local TTS front end,
 * whose G2P stage produces timings for free.
 *
 * There is deliberately no second implementation and no factory to choose
 * between them YET. Nothing emits phoneme timings on the current road and
 * `MochiAvatar.caps.visemes` is false, so a `VisemeMouth` would be an
 * abstraction over one caller and a capability nobody can satisfy. When a
 * provider reports `phonemeTimings`, it arrives as a second class behind this
 * same interface and the choice is made ONCE -- by picking an object, never by
 * a flag read inside a callback, which would be a branch in every frame and a
 * place for the wrong path to be taken.
 *
 * ## The gate is THREE conditions, not one
 *
 * When that day comes, the precise path requires all of:
 *
 *   1. the provider emits phoneme timings,
 *   2. the backend can render visemes (`caps.visemes`), and
 *   3. THE LOADED MODEL carries every one of the five vowel presets.
 *
 * The third is the one that gets dropped, and it is the expensive one. VRM's
 * vowel presets are optional per model, so a capable backend can load a model
 * carrying none: routing on caps alone sends weights nowhere and leaves the
 * mouth shut mid-word, intermittently, with every flag reporting success. RMS
 * over the whole utterance is visibly better than four fifths of a mouth.
 *
 * mochi locked all three into `canUseVisemes()` in shared/avatar.ts. It is not
 * ported here because there is nothing yet to call it -- port it together with
 * the second driver, not before.
 */

import type { AvatarBackend } from '@shared/avatar'
import { DEFAULT_ENVELOPE, SILENT, advanceEnvelope, type EnvelopeSettings } from './envelope'

/** Only the part of the backend a mouth driver is allowed to touch. */
export type MouthSink = Pick<AvatarBackend, 'setMouthOpen'>

export interface MouthDriver {
  /**
   * The loudness of what is sounding right now, and how long since the last
   * call. Driven from the render loop, after every other layer.
   */
  observe(level: number, dtSeconds: number): void
  /** The turn ended, or she was interrupted. Shuts the mouth immediately. */
  end(): void
}

/**
 * The RMS path.
 *
 * Driven once per rendered frame rather than per audio callback. Under a peer
 * connection her voice is a remote MediaStream the browser plays itself -- no
 * PCM reaches this process at all -- so the level arrives by sampling an
 * analyser, which is naturally a per-frame operation. At 60Hz that is a 16ms
 * sampling interval against a ~4Hz syllable rate, which is ample.
 */
export class EnvelopeMouth implements MouthDriver {
  private state = SILENT

  constructor(
    private readonly avatar: MouthSink,
    private readonly settings: EnvelopeSettings = DEFAULT_ENVELOPE,
  ) {}

  observe(level: number, dtSeconds: number): void {
    this.state = advanceEnvelope(level, this.state, dtSeconds, this.settings)
    this.avatar.setMouthOpen(this.state.mouthOpen)
  }

  /**
   * Whether the envelope currently judges the signal to be speech.
   *
   * The one place anything outside the rig should ask that question. Reading it
   * here rather than re-deriving it from a level means the mouth and the
   * "is she still talking" decision can never disagree -- and they did, when
   * the caller compared a raw RMS against a constant while this compared a peak
   * against a learned floor.
   */
  get speaking(): boolean {
    return this.state.speaking
  }

  /**
   * Shut, and forget the level -- but KEEP the learned floor and peak.
   *
   * The references are what make the envelope level-independent, and they are
   * properties of this voice on this connection, not of this turn. Discarding
   * them at every turn boundary would make her first syllable back a
   * recalibration, which is visible: the mouth either slams or sits closed
   * while the estimate catches up.
   */
  end(): void {
    this.state = { ...this.state, mouthOpen: 0 }
    this.avatar.setMouthOpen(0)
  }
}
