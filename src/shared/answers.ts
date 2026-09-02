import type {
  ChosenWorkspace,
  Forgotten,
  SessionConfig,
  SettingsCodex,
  SettingsUpdate,
  SettingsView,
  SettingsWrite,
  VoiceAnswer,
  VoiceOpened,
} from './ipc'
import type {
  HistoryExport,
  HistoryHit,
  HistoryList,
  HistoryProblem,
  HistoryTurn,
  ShelfView,
} from './history-window'

/**
 * What every request/response channel ANSWERS WITH, in one table both sides
 * read.
 *
 * ## The defect this replaces
 *
 * `ipcMain.handle` is typed to return `unknown`. The renderer's side was a
 * cast — `preload/index.ts` said `as readonly HistoryProblem[]` — and nothing
 * on main's side was checked against that name. Twenty-one of twenty-eight
 * handlers happened to carry a return annotation; three did not, and were
 * found by an audit rather than by anything that could fail. Measured at the
 * time: a required field added to `HistoryProblem`, `HistoryTurn` and
 * `HistoryHit`, with nothing else changed, produced no error anywhere.
 *
 * The first answer was a test that read `index.ts` and asserted every handler
 * declared a type. It worked, once it worked — its own first version parsed
 * twenty-four of twenty-eight handlers and could not have failed. That is the
 * argument for this file: a check that reads source is a second thing that can
 * be wrong about the source, and the property it was checking is one the
 * compiler can hold directly.
 *
 * ## How it holds
 *
 * `answer()` in `main/ipc/answer.ts` takes the channel as a type parameter and
 * requires the handler to return `Answers[C]`. The preload casts to
 * `Answers[C]` for the same channel. Neither side names a type of its own, so
 * there is no second name to drift from: a field added here reaches both, and a
 * handler that stops matching stops compiling.
 *
 * ## Why this is its own module
 *
 * `history-window.ts` imports from `ipc.ts`, so `ipc.ts` cannot import back —
 * `import/no-cycle` is an error in this project and would be right to be. This
 * table needs names from both, so it sits below the two of them and is imported
 * by the two ends rather than by either half of the contract.
 *
 * ## One-way channels are deliberately absent
 *
 * `ipcMain.on` answers nothing, so it has nothing to declare here. Those are
 * guarded by `listen()` for a different hazard — an exception with no frame
 * above it — and the two wrappers are separate for that reason rather than by
 * omission.
 */
export interface Answers {
  /* ---- the companion's voice session ----------------------------------- */
  'voice:open': VoiceOpened
  'voice:sdp': VoiceAnswer
  'voice:config': SessionConfig

  /* ---- the archive ------------------------------------------------------ */
  'history:list': HistoryList
  'history:turns': readonly HistoryTurn[]
  'history:problems': readonly HistoryProblem[]
  'history:search': readonly HistoryHit[]
  'history:export': HistoryExport
  'history:forget': Forgotten

  /* ---- her sheet -------------------------------------------------------- */
  'shelf:read': ShelfView
  'shelf:wear': SettingsWrite
  'shelf:save': SettingsWrite
  'shelf:memory': SettingsWrite
  'shelf:copy': SettingsWrite
  'shelf:persona': SettingsWrite
  'shelf:wear-face': SettingsWrite
  'shelf:prompt': SettingsWrite

  /* ---- the machine's page ----------------------------------------------- */
  'settings:read': SettingsView
  'settings:prompt': SettingsWrite
  'settings:key': SettingsWrite
  'settings:lookup': SettingsWrite
  'settings:grant': SettingsWrite
  'settings:screen': SettingsWrite
  'settings:hearing': SettingsWrite
  'settings:choose-workspace': ChosenWorkspace
  'settings:codex-recheck': SettingsCodex
  'settings:check-update': SettingsUpdate
  'settings:download-update': SettingsUpdate
}

/** Every channel that owes the renderer an answer. */
export type Answered = keyof Answers
