/** The "hearing" group of settings. One pane per file; `panes.ts` keeps only the order. */
/**
 * Which languages she should expect to hear.
 *
 * ## Why a control exists at all, rather than a good constant
 *
 * The transcriber decides what her ARCHIVE holds, and the archive is what
 * `recall_conversations` searches and what the summariser reads when it
 * maintains her note. A wrong transcript is not a cosmetic fault: she looks for
 * the words somebody actually said, finds different ones stored, and reports
 * that she has no record of a conversation that is plainly there.
 *
 * The application cannot know which languages get spoken at this desk, and
 * guessing is worse than asking — a pair of languages hinted at somebody who
 * speaks neither is a hint working against them. So the default is nothing
 * chosen, which means the model works it out for itself, and this is where
 * somebody who knows better says so.
 *
 * ## A multiple select, because the answer is genuinely plural
 *
 * Switching language mid-sentence is ordinary for this project, which is the
 * whole reason the field is `languages` and not `language`. A single picker
 * would make a bilingual conversation choose which half to transcribe well.
 */
import { element } from '../../element'
import { type Pane } from '../pane'
import { field } from '../pane'
export const HEARING: Pane = {
  id: 'hearing',
  label: 'Hearing you',
  attention: () => null,
  render(view, handlers) {
    const chosen = new Set(view.hearing.languages)
    const languages = document.createElement('select')
    languages.multiple = true
    // Tall enough to show the common answers without scrolling, short enough
    // not to take the pane over. The list is main's; see `SettingsHearing`.
    languages.size = 8
    for (const one of view.hearing.choices) {
      const option = document.createElement('option')
      option.value = one.code
      option.textContent = one.label
      option.selected = chosen.has(one.code)
      languages.append(option)
    }
    languages.addEventListener('change', () => {
      const picked = [...languages.selectedOptions].map((one) => one.value)
      // Refused HERE as well as in main, so the message names the limit before
      // a write is attempted -- and the control is put back to what is actually
      // stored rather than left showing a selection that was never saved.
      if (picked.length > view.hearing.most) {
        for (const option of languages.options) option.selected = chosen.has(option.value)
        handlers.say(
          `Choose at most ${String(view.hearing.most)} languages, or none to let her work it out.`,
          true,
        )
        return
      }
      handlers.hearing({ languages: picked })
    })

    const parts: Node[] = [field('Languages spoken', languages)]
    parts.push(
      element(
        'p',
        'note',
        chosen.size === 0
          ? 'Nothing chosen, so she works out the language herself. Choose only languages that are actually spoken here — a hint for one nobody uses makes the transcript worse, not better.'
          : 'A hint, not a restriction. Anything else spoken is still transcribed; these are what she expects.',
      ),
    )
    // Said plainly, because nothing on screen changes when this is saved. The
    // voice locks after her first audio, so the configuration is re-sent on the
    // next session rather than to this one.
    parts.push(element('p', 'note', 'Takes effect on her next wake.'))
    return parts
  },
}
