/**
 * What a settings pane IS, and the two rows every one of them is built from.
 *
 * Below the panes rather than beside them. `panes.ts` holds the ORDER the
 * groups appear in and imports each one; each one needs the shape and the row
 * vocabulary. Leaving those in `panes.ts` would have made every pane import
 * the file that imports it.
 */
import { section } from '../history/sheet/row'
import { element } from '../element'
import {
  type ChosenWorkspace,
  type HearingChange,
  type LookupChange,
  type Revealable,
  type ScreenChange,
  type SettingsCodex,
  type SettingsUpdate,
  type SettingsView,
} from '@shared/ipc'
import { label as paneLabel, type ByPronoun } from '@shared/pronoun'
/*
  Re-exported rather than moved out of reach.

  `Field` and `anchor` are the whole window's vocabulary now — her sheet uses
  them too, which is why they live in `renderer/field.ts` beside `element` — but
  a pane declaring its fields still wants one import, and every pane already
  imports this file for `Pane` and `field`.
*/
import { anchor, type Field } from '../field'
export { anchor, type Field } from '../field'
import { type Link } from '@shared/links'
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
  /**
   * Open one of the project's three addresses in the browser.
   *
   * A KIND rather than a URL, all the way down — the pane names `repo`, main
   * looks it up in `shared/links.ts` and hands `shell.openExternal` a value the
   * window never had. See `settings:open-link`.
   */
  readonly openLink: (what: Link) => void
  /**
   * Three acts, three handlers, and the two that take time are PROMISES.
   *
   * `recheckCodex`'s reason: a control that returned at once would look like it
   * had done nothing on the one machine where the answer is slow, and the pane
   * disables itself for exactly as long as the work is outstanding. Downloading
   * resolves when the file has landed rather than when the request goes out,
   * which is what lets one button say "Downloading…" and then become "Restart".
   */
  readonly checkUpdate: () => Promise<SettingsUpdate>
  readonly downloadUpdate: () => Promise<SettingsUpdate>
  readonly installUpdate: () => void
  readonly say: (text: string, bad?: boolean) => void
}

export interface Pane {
  readonly id: string
  /** What the nav calls it. A table only when the name is about HER. */
  readonly label: string | ByPronoun
  /** Why this group needs looking at, or null. Drives the dot in the nav. */
  readonly attention: (view: SettingsView) => string | null
  /**
   * Everything on this pane somebody could search for, in the order it is drawn.
   *
   * A FUNCTION of the view rather than a constant, because two panes hold lists
   * that come from the store: the prompt editors are one per catalogued prompt,
   * and the keys are one per binding. A constant would have to guess at both,
   * and guessing wrongly is exactly the drift this declaration exists to stop.
   */
  readonly fields: (view: SettingsView) => readonly Field[]
  readonly render: (view: SettingsView, handlers: PaneHandlers) => readonly Node[]
}

/**
 * A setting on the machine's page: a caps heading, the control, and a note.
 *
 * THE SAME SECTION HER PAGE USES, which is the whole change. This built a
 * two-column grid — a 150px label beside the control, vertically centred — and
 * that shape appears nowhere in B1, B2, B4 or B7. Every one of them draws a
 * setting as an uppercase 11px heading with the control UNDER it and a sentence
 * under that, which is `section()` exactly. So the two pages of one window were
 * composed by two different rules, and the machine's was the v1 one.
 *
 * The note is part of the section rather than a sibling pushed on at the end.
 * `looking.ts` had one `<p>` gated on the workspace being the default and
 * appended after the LAST field, so a sentence about the workspace was drawn
 * under "Codex profile" and read as being about the profile.
 *
 * `hint` is the mono fact beside the heading — B2's "3 of 3", B4's "after 10
 * min". Empty when there is none; `sectionHead` draws an empty span, which
 * occupies nothing.
 */
export function field(
  spec: Field,
  view: SettingsView,
  control: HTMLElement,
  extra?: { readonly hint?: string; readonly note?: string },
): HTMLElement {
  const body: HTMLElement[] = [control]
  if (extra?.note !== undefined) body.push(element('p', 'note', extra.note))
  /*
    THE DESCRIPTOR, not a string — and the pronoun is read here rather than at
    the call site.

    Every one of these labels was a bare literal, so a name about her would have
    had to be spelled `forPronoun(SAYS.x, view.pronoun)` by each caller and any
    caller that forgot would say "her" whoever is worn. That is the failure
    `SettingsView.pronoun` records: validated, stored, migrated, never rendered.
    One place reads the table now, so there is no call site left to forget.
  */
  return anchor(spec, section(paneLabel(spec.label, view.pronoun), extra?.hint ?? '', ...body))
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
