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
