/**
 * Every element this window draws into, resolved once at load.
 *
 * A leaf: it reads the document and imports nothing of ours, which is what
 * lets each part of this window be its own module. `need` throws rather than
 * returning null, because a missing id is a broken build and a silent null
 * surfaces much later as "one panel does nothing".
 */
export function need<T extends Element>(id: string, kind: new () => T): T {
  const found = document.querySelector(`#${id}`)
  // Fail loud. Rendering into nothing is indistinguishable from a slow start,
  // and `documents.test.ts` is what stops this being discovered at runtime.
  if (!(found instanceof kind)) throw new Error(`shelf: the document has no usable #${id}`)
  return found
}

export const markEl = need('mark', HTMLCanvasElement)

export const stateEl = need('state', HTMLElement)

export const stateHowEl = need('state-how', HTMLElement)

export const micEl = need('mic', HTMLElement)

export const micLabelEl = need('mic-label', HTMLElement)

export const countEl = need('count', HTMLElement)

export const charactersEl = need('characters', HTMLElement)

export const charactersCountEl = need('characters-count', HTMLElement)

export const castEl = need('cast-actions', HTMLElement)

export const paneEl = need('pane', HTMLElement)

export const wakeEl = need('panel-wake', HTMLElement)

export const talkEl = need('talk', HTMLElement)

export const shellTabsEl = need('shell-tabs', HTMLElement)

export const navEl = need('nav-groups', HTMLElement)

export const toolsEl = need('machine-tools', HTMLElement)

export const contextEl = need('topbar-context', HTMLElement)

export const machineEl = need('machine-pane', HTMLElement)

export const queryEl = need('q', HTMLInputElement)

export const listEl = need('list', HTMLElement)

export const calEl = need('calendar', HTMLElement)

export const troublesEl = need('troubles', HTMLButtonElement)

export const troublesLabelEl = need('troubles-label', HTMLElement)

export const exportEl = need('export', HTMLButtonElement)

export const pickEl = need('pick', HTMLButtonElement)

export const pickOffEl = need('pick-off', HTMLButtonElement)

export const dropSomeEl = need('drop-some', HTMLButtonElement)

export const dropHersEl = need('drop-hers', HTMLButtonElement)

export const sureEl = need('sure', HTMLDialogElement)

export const sureWhatEl = need('sure-what', HTMLElement)

export const sureWhyEl = need('sure-why', HTMLElement)

export const sureNoEl = need('sure-no', HTMLButtonElement)

export const sureYesEl = need('sure-yes', HTMLButtonElement)
export const sureExportEl = need('sure-export', HTMLButtonElement)

export const saidEl = need('said', HTMLElement)

export const saidWhatEl = need('said-what', HTMLElement)

export const saidShutEl = need('said-shut', HTMLButtonElement)
