/**
 * What this computer does with the microphone and the speaker.
 *
 * A MACHINE setting, by the usual test: two personas cannot disagree about
 * whether this laptop's speaker feeds back into this laptop's microphone. The
 * same character wants opposite answers on a headset and on a laptop, which is
 * the definition of a property of the machine rather than of her.
 */

export interface Sound {
  /**
   * Whether the microphone stays open while she is talking.
   *
   * Three answers rather than two, and `auto` is the one that matters: asking
   * somebody to change this every time they plug earphones in is asking for a
   * setting nobody maintains. Under `auto` the app listens for her own voice
   * coming back and decides for itself -- see `audio/loopback.ts`. The other
   * two exist because a measurement can be wrong and a person should be able
   * to say so.
   */
  readonly listening: Listening
  /**
   * Chromium's echo canceller on the captured audio.
   *
   * This is half of why the shell is Electron at all -- AEC3 comes
   * free with Chromium. It is on by default and exposed rather than assumed,
   * because it is not free of cost: it is tuned for speech and can thin out a
   * voice on a good headset where there is no echo to cancel.
   */
  readonly echoCancellation: boolean
  /**
   * How readily the server calls a pause the end of your turn.
   *
   * `semantic_vad` decides with the model rather than with an energy threshold,
   * and this is the dial it exposes. Lower means she waits longer before
   * answering, which is also the setting that stops a cough or a room becoming
   * a turn.
   */
  readonly eagerness: Eagerness
}

export const EAGERNESS = ['low', 'auto', 'high'] as const
export type Eagerness = (typeof EAGERNESS)[number]

export const LISTENING = ['auto', 'speaker', 'earphones'] as const
export type Listening = (typeof LISTENING)[number]

export function isListening(value: unknown): value is Listening {
  return typeof value === 'string' && (LISTENING as readonly string[]).includes(value)
}

export const DEFAULT_SOUND: Sound = {
  // Measured, not asked. The two manual answers stay reachable because a
  // measurement can be wrong; the default is not to make somebody maintain it.
  listening: 'auto',
  echoCancellation: true,
  eagerness: 'auto',
}

export function isEagerness(value: unknown): value is Eagerness {
  return typeof value === 'string' && (EAGERNESS as readonly string[]).includes(value)
}

/**
 * Read a stored sound block, field by field.
 *
 * Per FIELD rather than all-or-nothing, like the rest of `preferences.ts`: one
 * fumbled line must not reset the other two, and a file written before this
 * existed has none of them.
 */
/**
 * Apply a PARTIAL update from an untrusted message onto what is stored.
 *
 * Distinct from `readSound`, and the distinction is the bug it was written for.
 * `readSound` reads a FILE: every absent or invalid field becomes its default,
 * which is right for a document that is meant to describe the whole block. An
 * IPC message is not that -- it carries the field somebody just changed -- so
 * reading it the same way reset everything it did not mention and reported
 * success. Changing the turn eagerness silently put echo cancellation back.
 *
 * Absent therefore means UNCHANGED here, because the stored value is what
 * absence falls back to. Present-but-invalid still falls back to the default,
 * which is `readSound`'s judgement and stays its own.
 */
export function mergeSound(stored: Sound, message: unknown): Sound {
  return readSound({ ...stored, ...fieldsOf(message) })
}

/**
 * A message as something spreadable, or nothing.
 *
 * `{...null}` and `{...'text'}` are both legal and both silently wrong-shaped,
 * and this input comes from the least trusted process in the app.
 */
function fieldsOf(message: unknown): Record<string, unknown> {
  return typeof message === 'object' && message !== null && !Array.isArray(message)
    ? (message as Record<string, unknown>)
    : {}
}

export function readSound(value: unknown): Sound {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return DEFAULT_SOUND
  const record = value as Record<string, unknown>
  const bool = (key: keyof Sound, fallback: boolean): boolean => {
    const stored = record[key]
    return typeof stored === 'boolean' ? stored : fallback
  }
  return {
    listening: isListening(record['listening']) ? record['listening'] : DEFAULT_SOUND.listening,
    echoCancellation: bool('echoCancellation', DEFAULT_SOUND.echoCancellation),
    eagerness: isEagerness(record['eagerness']) ? record['eagerness'] : DEFAULT_SOUND.eagerness,
  }
}
