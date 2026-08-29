import type {
  ForgetTalk,
  Forgotten,
  NoteAction,
  PersonaAction,
  PersonaChange,
  SettingsAvatar,
  SettingsNote,
  SettingsPersona,
  SettingsWrite,
} from './ipc'
import type { FaceSpec } from './avatar-spec'
import type { Pronoun } from './pronoun'

/**
 * The conversations window's half of the wire.
 *
 * Split from `ipc.ts` along the seam that module already describes: this is
 * what arrives on `window.mochiHistory`, a DIFFERENT global from
 * `window.mochi` and not merely more methods on it. The two documents load the
 * same preload file, and one object would mean the companion page could call
 * `turns()` because the bridge had already built it. The role decides which is
 * installed, so the other was never constructed -- and a file per global is
 * what makes that boundary visible rather than asserted.
 *
 * The dependency runs one way: this file reads `ipc.ts` for the settings types
 * the shelf reuses. `ipc.ts` names `ShelfView` and `ShelfCharacter` only in
 * prose, never in code, so nothing here needs importing back.
 */
/** One conversation, as the window lists it. */
export interface HistoryConversation {
  /** Opaque; holding it authorises nothing. Every read still checks the persona. */
  readonly token: string
  readonly startedAt: number
  readonly endedAt: number | null
  readonly turns: number
  /**
   * Which capabilities she reached for in it, and how many times each.
   *
   * EMPTY is the ordinary answer — most conversations call nothing — and it is
   * a list rather than a map so the order is the query's and two readers cannot
   * disagree about it.
   *
   * The transcript header has drawn a row of tool chips in the artifact since
   * it was designed, and `transcriptHead` carried a comment saying they were
   * left out rather than invented because nothing archived a call. `plan-v2.md`
   * W5 is where that was written down; `session_tool` is what closed it.
   */
  readonly tools: readonly ToolUse[]
  /**
   * What it was about, in a few words, or null.
   *
   * NULL is ordinary, and was the only state until this existed: a conversation
   * is titled after it ends by a model call that may not have run yet, may have
   * failed, or may have answered nothing usable. Null and empty are not two
   * states — `subjectFrom` answers null for both — so a row never holds a
   * string that means nothing.
   */
  readonly subject: string | null
}

/** One capability, and how many times it was called in one conversation. */
export interface ToolUse {
  readonly name: string
  readonly uses: number
}

/** One thing said in one. */
export interface HistoryTurn {
  readonly at: number
  readonly who: 'her' | 'you'
  readonly text: string
  /**
   * She was cut off partway through this one.
   *
   * Carried because the window is the only place a reader can see it, and
   * without it an interrupted turn is indistinguishable from a short one — the
   * text was silently shortened and nothing says so. An empty text with `cut`
   * is a turn she began and was cut off in before a word survived.
   */
  readonly cut: boolean
}

/** One search result, with the conversation it came from so it can be opened. */
export interface HistoryHit {
  readonly token: string
  readonly at: number
  readonly who: 'her' | 'you'
  readonly text: string
}

/** One thing that went wrong, as the window lists it. */
export interface HistoryProblem {
  readonly area: string
  readonly subject: string | null
  readonly detail: string
  /** When it last happened. A recurring problem is one entry, not many. */
  readonly at: number
  /** How many times, at least 1. Drawn only when it is more than that. */
  readonly seen: number
}

/**
 * What came of an export.
 *
 * `cancelled` is a first-class answer rather than a failure: somebody who
 * dismissed the save panel has not hit an error and should not be told they
 * have. `path` comes back so the window can say where it went — "exported" with
 * no location is a message somebody then has to go hunting after.
 */
export type HistoryExport =
  | { readonly ok: true; readonly path: string; readonly conversations: number }
  | { readonly ok: false; readonly cancelled: true }
  | { readonly ok: false; readonly cancelled: false; readonly why: string }

/**
 * One character, as the shelf lists her.
 *
 * The same fields `SettingsPersona` carried, because it is the same list — it
 * moved rather than being copied. The type keeps its name so the settings
 * module's `listPersonas` did not have to grow a second shape for one caller.
 */
export type ShelfCharacter = SettingsPersona

/*
  `ShelfState` stood here: whether she was awake, and the key that changes it.

  It existed for the strip across the top of the shelf, and that strip is gone —
  the operating system's title bar carries the name, the tray carries her state
  and the shortcut, and the microphone is her halo. Nothing read either field
  once the strip went, which `nothing-written-goes-unread.test.ts` is what
  noticed: a field that crosses the bridge and is read by nobody is a fact main
  computes on every read, sends, and cannot be held to.
*/

/** Everything the shelf's character half draws, answered in one call. */
export interface ShelfView {
  /** The worn face, resolved. See `SettingsView.face` — same rule, same reason. */
  readonly face: FaceSpec
  readonly wornId: string
  readonly characters: readonly ShelfCharacter[]
  readonly avatars: readonly SettingsAvatar[]
  readonly voices: readonly string[]
  /**
   * Which of `voices` carry a mark, and nothing about why.
   *
   * Sent rather than decided in the pane, for the same reason `voices` is: two
   * places holding the same list is how a mark comes to be on a different pill
   * in each of them. See `RECOMMENDED_VOICES` for what the mark is allowed to
   * claim — it is somebody else's recommendation, not a measurement of ours.
   */
  readonly recommendedVoices: readonly string[]
  /**
   * Which words this interface uses for the worn character.
   *
   * Sent rather than assumed, which is the whole reason `Persona.pronoun`
   * exists: `persona.test.ts` says in so many words that switching character has
   * to switch it too. It was validated, stored, migrated and tested for the
   * length of this build and never rendered -- so `he` and `it` were both
   * accepted and both still came out "her".
   */
  readonly pronoun: Pronoun
  /**
   * Where the worn character's face actually resolved to, or null for the
   * built-in.
   *
   * The one value the Cast pane draws that is not a stored field. The requested
   * id is on the character; this is where the read LANDED, which is the
   * difference between "your file is missing" and the silent fallback that
   * presents as "the app ignored my file". It also decides whether a theme
   * applies at all — see `resolveFaceFor`.
   *
   * This was a `plates` object carrying `voice`, `prompt` and `workspace` too.
   * The first two became a second copy of `worn.voice` and `worn.style` once
   * the pane grew controls for every stored field, and the workspace is on the
   * Machine tab, where `plan-shell.md`'s split puts it.
   */
  readonly faceSource: string | null
  /**
   * Exactly what she will be told on the next wake.
   *
   * `instructionsFor`'s output, with the withheld-grants notice on the end —
   * the real string, not a summary of it. 1b's right-hand card is literally
   * that function's output, and a card that re-assembled it here would be the
   * second place her prompt is built.
   */
  readonly assembled: string
  /**
   * The tools as they go on the wire, rendered for reading.
   *
   * **Hardcoded prose is still prose she is handed**, and until this existed
   * none of it was visible anywhere. `assembled` is only half of
   * `whatSheMayDo`'s answer: the other half is a `tools` array whose
   * `description` fields are the largest body of model-facing text in the app,
   * written in each capability's own `capability.ts` and settable by nobody.
   *
   * That they are not editable is deliberate and argued — a description that
   * drifts from what the tool does makes her misreport the machine, which is
   * §11's measured failure — but not editable is a different claim from not
   * visible, and the second does not follow from the first. You cannot reason
   * about why she did something without seeing what she was told.
   *
   * From the SAME `whatSheMayDo` call as `assembled`, for that field's own
   * reason: two renderings of one answer is where the two quietly diverge.
   * Already narrowed and filtered — a withheld capability is absent here
   * exactly as it is absent on the wire.
   */
  readonly toolsSent: string
  /**
   * The system prompt document — the thing that is EDITED, beside the string it
   * produces.
   *
   * Both, because they are different objects and the pane shows both: one is
   * what somebody wrote, the other is what she is handed once her character,
   * her notes and her tools have been folded in. Sending only the second would
   * make the editor unable to open; sending only the first would make the
   * receipt a second assembly of the prompt, which is the drift
   * `assembled`'s own comment exists to prevent.
   */
  readonly prompt: {
    readonly text: string
    /** Where it is, so somebody can open it in their own editor. */
    readonly path: string
    /** Which tokens move a piece. Sent, so the hint cannot list a stale one. */
    readonly slots: readonly string[]
  }
  readonly note: SettingsNote
}

/**
 * What the conversations window gets on `window.mochiHistory`.
 *
 * A different global from `window.mochi` rather than more methods on it: the
 * two documents load the same preload file, and a single object would mean the
 * companion page could call `turns()` because the bridge had already built it.
 * The role decides which one is installed, so the other is not merely
 * unreachable — it was never constructed.
 */
export interface MochiHistoryApi {
  /** Everything that went wrong this launch, newest first. */
  problems(): Promise<readonly HistoryProblem[]>
  /** Save everything to a file. Answers what happened, for a status line. */
  exportAll(): Promise<HistoryExport>
  /** Main asking for a place to be shown. See `shell:show`. */
  /**
   * Be told which place to show. Answers the way back OFF.
   *
   * `ipcRenderer.on` has no lifetime of its own, so a subscription taken inside
   * anything that redraws accumulates for the life of the window. The companion
   * bridge's `onSend` has always answered with an unsubscribe for that reason
   * and this said `void`, which is the same hazard with the answer withheld.
   */
  onShow(run: (place: string) => void): () => void
  /** Whoever is worn. The window never gets to name a persona. */
  list(): Promise<{
    readonly persona: string
    readonly conversations: readonly HistoryConversation[]
  }>
  turns(token: string): Promise<readonly HistoryTurn[]>
  search(query: string): Promise<readonly HistoryHit[]>
  /** Delete conversations: some of hers, all of hers, or every one there is. */
  forget(action: ForgetTalk): Promise<Forgotten>
  /** The characters, what had to be resolved, and what she will be told. */
  shelf(): Promise<ShelfView>
  /** Wear somebody. Checked against the catalog in main. */
  wear(id: string): Promise<SettingsWrite>
  /** Change a field on a character. Main decides what may be written, and where. */
  saveCharacter(change: PersonaChange): Promise<SettingsWrite>
  /**
   * Put one of her expressions on her, now, to look at it.
   *
   * Nothing is saved. The frame is `__mochi_face__`, which the shelf is now the
   * only sender of — `set_expression` sent the same one until it was removed.
   * See `shelf:wear-face`.
   */
  wearFace(face: string): Promise<SettingsWrite>
  /** Make one, copy one, remove one, or put the built-in back. */
  character(action: PersonaAction): Promise<SettingsWrite>
  /** Undo the last change to her note, or clear it. */
  memory(action: NoteAction): Promise<SettingsWrite>
  /** Store the system prompt document. Empty is a real answer and is allowed. */
  prompt(text: string): Promise<SettingsWrite>
  /** Put one turn's words on the clipboard. See `shelf:copy`. */
  copy(text: string): Promise<SettingsWrite>
}
