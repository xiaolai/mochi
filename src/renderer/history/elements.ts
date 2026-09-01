/**
 * Every element this window draws into, resolved once at load.
 *
 * A leaf: it reads the document and imports nothing of ours, which is what
 * lets each part of this window be its own module. `need` throws rather than
 * returning null, because a missing id is a broken build and a silent null
 * surfaces much later as "one panel does nothing".
 */
function need<T extends Element>(id: string, kind: new () => T): T {
  const found = document.querySelector(`#${id}`)
  // Fail loud. Rendering into nothing is indistinguishable from a slow start,
  // and `documents.test.ts` is what stops this being discovered at runtime.
  if (!(found instanceof kind)) throw new Error(`shelf: the document has no usable #${id}`)
  return found
}

export const countEl = need('count', HTMLElement)

export const charactersEl = need('characters', HTMLElement)

export const charactersCountEl = need('characters-count', HTMLElement)

export const castEl = need('cast-actions', HTMLElement)

export const paneEl = need('pane', HTMLElement)

export const statusEl = need('status', HTMLElement)

export const talkEl = need('talk', HTMLElement)

export const navEl = need('nav-groups', HTMLElement)

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

/* ---- the frame the delivered design draws ------------------------------- */

/** Her page, and the machine's. One is `hidden` at any moment. */
export const pageHersEl = need('page-hers', HTMLElement)

export const pageMachineEl = need('page-machine', HTMLElement)

/** The rail's row for the machine, which is not one of her views. */
export const railMachineEl = need('rail-machine', HTMLButtonElement)

/** The three numbered views under her name. */
export const viewsEl = need('views', HTMLElement)

/** Her face and her name, above the views. */
export const subjectEl = need('subject', HTMLElement)
/** The problems drawer, and the part of it the report is written into. */
export const troublesDrawerEl = need('troubles-drawer', HTMLElement)
export const troublesBodyEl = need('troubles-body', HTMLElement)
/** The body's column track, which differs per view. See `.spread` in the sheet. */
export const spreadEl = need('spread', HTMLElement)

export const findingEl = need('finding', HTMLElement)

/** View III's body: what she is permitted to do, for THIS character. */
export const permitsEl = need('permits', HTMLElement)

/** The margin's three bodies, one per view. */
export const marginHersEl = need('margin-hers', HTMLElement)

/** View III's margin: the capability descriptions, which are not editable. */
export const marginPermitsEl = need('margin-permits', HTMLElement)

/*
  The find-a-setting panel, its field, its results and its one line of prose.

  A `<dialog>` for `#sure`'s reasons — modal, focus-trapped, Escape closes it,
  top layer — so the type is `HTMLDialogElement` rather than `HTMLElement`:
  `showModal` and `close` are the whole of what this window calls on it, and a
  looser type would make a missing dialog surface as an undefined method at the
  moment somebody presses the key.
*/
export const jumpEl = need('jump', HTMLDialogElement)

export const jumpQEl = need('jump-q', HTMLInputElement)

export const jumpFoundEl = need('jump-found', HTMLElement)

export const jumpSaidEl = need('jump-said', HTMLElement)
