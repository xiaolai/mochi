/**
 * What a settings pane IS, and the two rows every one of them is built from.
 *
 * Below the panes rather than beside them. `panes.ts` holds the ORDER the
 * groups appear in and imports each one; each one needs the shape and the row
 * vocabulary. Leaving those in `panes.ts` would have made every pane import
 * the file that imports it.
 */
import { element } from '../element'
import {
  type ChosenWorkspace,
  type HearingChange,
  type LookupChange,
  type Revealable,
  type ScreenChange,
  type SettingsCodex,
  type SettingsView,
} from '@shared/ipc'
import { type ByPronoun } from '@shared/pronoun'
export interface PaneHandlers {
  readonly lookup: (change: LookupChange) => void
  /**
   * Open the system folder panel, and answer with what got saved.
   *
   * A PROMISE, for the reason `recheckCodex` is one: the panel is open for as
   * long as somebody takes to decide, and the pane disables its button for
   * exactly that long. It carries the answer rather than returning nothing,
   * because a dismissal must not be reported as anything at all — see
   * `ChosenWorkspace`.
   *
   * It does not take a folder. The renderer never names a path; main opens the
   * panel, checks what came back and writes it.
   */
  readonly chooseWorkspace: () => Promise<ChosenWorkspace>
  /** Reveal the Codex profile file. Main knows which; there is no argument. */
  readonly showProfile: () => void
  /**
   * Ask the machine about Codex again, and hand back what it said.
   *
   * A PROMISE, because the check spawns two child processes with a deadline
   * each: a button that returned at once would look like it had done nothing on
   * the one machine where the answer takes a second. The pane disables the
   * control while this is outstanding and redraws from the result.
   */
  readonly recheckCodex: () => Promise<SettingsCodex>
  readonly screen: (change: ScreenChange) => void
  readonly hearing: (change: HearingChange) => void
  /** Rewrite one catalogued prompt; `null` resets it to what the app ships. */
  readonly prompt: (key: string, text: string | null) => void
  readonly grant: (change: { id: string; allowed: boolean }) => void
  /**
   * Bind one global key; `null` gives it back to what the app ships.
   *
   * A reset sends `null` rather than the shipped combination, so the stored
   * answer is DELETED and the key keeps tracking whatever later releases ship.
   * The pane knows the default — it is drawn — and sending it would pin this
   * release's answer while reporting the key unedited.
   */
  readonly key: (change: { id: string; accelerator: string | null }) => void
  /**
   * Ask about deleting every conversation there is.
   *
   * ASK. The pane raises the question and the confirmation surface answers it;
   * nothing is deleted by the time this returns. Handing the pane a function
   * that deleted would put the irreversible action one click from a list of
   * folder paths.
   */
  readonly forgetEveryTalk: () => void
  readonly reveal: (what: Revealable) => void
  readonly say: (text: string, bad?: boolean) => void
}

export interface Pane {
  readonly id: string
  /** What the nav calls it. A table only when the name is about HER. */
  readonly label: string | ByPronoun
  /** Why this group needs looking at, or null. Drives the dot in the nav. */
  readonly attention: (view: SettingsView) => string | null
  readonly render: (view: SettingsView, handlers: PaneHandlers) => readonly Node[]
}

export function field(label: string, control: HTMLElement): HTMLElement {
  const row = element('div', 'field')
  const name = element('label', undefined, label)
  row.append(name, control)
  return row
}

/**
 * Fill a select, marking one entry as the current answer.
 *
 * IT CANNOT SHOW A VALUE IT WAS NOT GIVEN, and a caller has to know that: when
 * `chosen` matches no entry, nothing is marked and the browser falls back to
 * the FIRST option — so the control silently reports a setting that is not in
 * force. `on-screen.ts` shipped that way, claiming she never rests while she
 * rested every 47 minutes.
 *
 * The fix belongs with the caller, which is the only place that knows how to
 * label the extra entry. Stated here so the next one does not have to find out.
 */
export function options(
  select: HTMLSelectElement,
  entries: readonly { value: string; label: string }[],
  chosen: string,
): void {
  for (const entry of entries) {
    const option = document.createElement('option')
    option.value = entry.value
    option.textContent = entry.label
    option.selected = entry.value === chosen
    select.append(option)
  }
}
