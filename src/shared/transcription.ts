/**
 * How what the USER said is turned into text.
 *
 * ## It is not how she hears anybody
 *
 * She is speech-to-speech: her audio is generated from the audio she was sent,
 * and this transcript is a SEPARATE pass that never touches it. So a bad
 * transcript cannot make her mishear a word. What it decides is what the
 * archive holds -- and therefore what `recall_conversations` can find and what
 * the sleep-time summariser reads when it maintains her note.
 *
 * That is why this is worth choosing deliberately. §29's failure was recall
 * finding nothing that was plainly there, and a mis-transcription is the same
 * failure through a different door: she searches for the words they actually
 * said, the archive holds different ones, and she reports -- correctly and
 * uselessly -- that she has no record of it. The OR-widening fix does not help,
 * because the words are simply not in the index.
 *
 * It is also off every latency path (§62), so nothing here trades against the
 * conversation feeling quick.
 *
 * ## Why `gpt-transcribe` and not the streaming one
 *
 * `gpt-live-transcribe` exists and is accepted (§24), and its whole value is
 * low-latency transcript deltas with a tunable `delay`. **This application has
 * no consumer for a delta**: the frame parser reads
 * `conversation.item.input_audio_transcription.completed` and nothing else, and
 * files it once. Buying streaming here would be paying roughly four times the
 * per-minute rate for the one axis that cannot matter, on a value that is read
 * after the turn is over.
 *
 * `gpt-transcribe` is the committed-turn model, which is the shape this app
 * actually has -- `semantic_vad` closes the turn, then the transcript arrives.
 * Two things follow that neither `whisper-1` nor the streaming model offer:
 *
 * 1. **It carries the session's earlier turns as context.** For an hour-long
 *    conversation full of recurring names, project vocabulary and mid-sentence
 *    language switches, accuracy compounds across the session rather than
 *    starting from nothing on every turn. A companion is exactly the case that
 *    benefits; a one-shot file transcriber is not.
 * 2. **It reports the language it detected**, which the streaming model
 *    explicitly does not.
 *
 * `whisper-1`, which this shipped with, is the oldest of the set and is listed
 * at a HIGHER per-minute rate than `gpt-transcribe`. It was the worst of both.
 *
 * ## What is measured, and what is still not
 *
 * §24 sent `{ model: 'gpt-transcribe', languages: ['en','zh'] }` as one
 * `session.update` and the service accepted it, on both model lines, with this
 * machine's subscription credential -- but over a WEBSOCKET, and this app runs
 * WebRTC. §66 closed that gap in the app itself on 2026-08-22: the model is
 * accepted in a speech-to-speech WebRTC call, its
 * `conversation.item.input_audio_transcription.completed` is the shape
 * `frames.ts` already reads, and the whole `session.update` landed -- she used
 * `addressUser`, which reaches her only through `instructions`.
 *
 * §66 also recorded that detection handled a sentence switching from Chinese to
 * English mid-way with NO `languages` hint sent, which is evidence for the
 * default rather than for any particular pair.
 *
 * **Accuracy is still not measured, on any of these models.** Nothing here
 * claims `gpt-transcribe` transcribes better than `whisper-1` did; the argument
 * for it is the reasoning above plus a published error rate, and the only way
 * to settle it on this machine's audio is §60's method -- push a known
 * recording in through `input_audio_buffer.append` and diff the transcripts.
 *
 * `session.ts` asserts that `session.updated` actually came back, which is what
 * turns a rejected update from "she runs on the service's defaults and nothing
 * says so" into a reported problem.
 */

/**
 * The model that transcribes the user, for every session.
 *
 * A constant rather than a picker: unlike her voice, this is not a matter of
 * taste and there is no version of "which transcriber am I on" a person wants
 * to be asked. The LANGUAGES are the part somebody genuinely knows better than
 * this application does, and those are a setting.
 */
export const TRANSCRIPTION_MODEL = 'gpt-transcribe'

/**
 * The languages offered on screen, as ISO 639-1 codes.
 *
 * ## A shorter standard than `VOICE_NAMES` gets, deliberately
 *
 * `realtime-model.ts` refuses to offer a model nobody has opened a session
 * with, and the reason is the blast radius: a model name the service does not
 * know is not a worse conversation, it is NO conversation. A language hint the
 * service does not know is a hint that does not help. Those are different
 * failures and they do not deserve the same gate, so this list is chosen for
 * usefulness rather than verified one code at a time -- and saying so is what
 * makes it a decision instead of an oversight.
 *
 * The codes themselves are the format the service documents. What is not
 * claimed is that every one of them is supported.
 */
export const OFFERED_LANGUAGES: readonly { readonly code: string; readonly label: string }[] = [
  { code: 'en', label: 'English' },
  { code: 'zh', label: 'Chinese' },
  { code: 'es', label: 'Spanish' },
  { code: 'hi', label: 'Hindi' },
  { code: 'ar', label: 'Arabic' },
  { code: 'pt', label: 'Portuguese' },
  { code: 'ru', label: 'Russian' },
  { code: 'ja', label: 'Japanese' },
  { code: 'de', label: 'German' },
  { code: 'fr', label: 'French' },
  { code: 'ko', label: 'Korean' },
  { code: 'it', label: 'Italian' },
  { code: 'tr', label: 'Turkish' },
  { code: 'vi', label: 'Vietnamese' },
  { code: 'th', label: 'Thai' },
  { code: 'id', label: 'Indonesian' },
  { code: 'nl', label: 'Dutch' },
  { code: 'pl', label: 'Polish' },
  { code: 'uk', label: 'Ukrainian' },
  { code: 'sv', label: 'Swedish' },
  { code: 'he', label: 'Hebrew' },
  { code: 'fa', label: 'Persian' },
  { code: 'ms', label: 'Malay' },
  { code: 'bn', label: 'Bengali' },
]

/**
 * How many may be chosen at once.
 *
 * A hint naming half the world's languages is the same information as naming
 * none, and it still occupies the session configuration. The bound is what
 * keeps "expected languages" meaning something. Nobody switches between seven
 * languages in one conversation; somebody who does gets detection, which is
 * what this setting falls back to.
 */
export const MOST_LANGUAGES = 6

/**
 * A well-formed ISO 639-1 code.
 *
 * The GRAMMAR rather than membership of the list above, because the two answer
 * different questions. The list is what is offered; this is what may be stored.
 * A `preferences.json` written by a later version naming a language this build
 * does not draw is ordinary rather than corrupt -- the same tolerance
 * `readRealtimeModel` shows for a model it has not heard of -- and dropping it
 * here would silently undo somebody's choice on the next launch.
 */
export function isLanguageCode(value: unknown): value is string {
  return typeof value === 'string' && /^[a-z]{2}$/.test(value)
}

/**
 * A stored or messaged value, read into the list the session will send.
 *
 * EMPTY is the default and it is a real answer, not a missing one: it means
 * send no `languages` at all and let the model detect, which is what
 * `gpt-transcribe` does and reports. Pinning two languages for everybody would
 * decide, for a French speaker, that they are talking in a language they do
 * not speak.
 *
 * Tolerant like every other reader of this file: anything that is not a list of
 * codes reads as empty, duplicates collapse, and the bound is applied HERE as
 * well as at the control, because a hand-edited file is exactly as capable of
 * naming forty languages as a broken window is.
 */
export function readLanguages(value: unknown): readonly string[] {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  for (const one of value) {
    if (isLanguageCode(one)) seen.add(one)
    if (seen.size === MOST_LANGUAGES) break
  }
  return [...seen]
}

/**
 * The `audio.input.transcription` object exactly as it goes on the wire.
 *
 * ## Why this is a function and not two lines in `session.ts`
 *
 * Because it makes a DECISION, and that file has no test — it holds
 * `RTCPeerConnection` and `getUserMedia`, so nothing can construct it. The
 * decision is: an empty choice omits `languages` rather than sending `[]`.
 *
 * Those are not the same message. `[]` is a claim about what will be spoken —
 * "expect none of the languages" — and the absence of the field is the model
 * detecting, which is what the default is for. A reader of `session.ts` cannot
 * tell whether an inline ternary got that the right way round; a test can.
 */
export function transcriptionConfig(input: {
  readonly model: string
  readonly languages: readonly string[]
}): { readonly model: string; readonly languages?: readonly string[] } {
  return input.languages.length === 0
    ? { model: input.model }
    : { model: input.model, languages: [...input.languages] }
}
