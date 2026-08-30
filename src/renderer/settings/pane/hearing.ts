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
import { forPronoun } from '@shared/pronoun'
import { SAYS } from '../panes-says'
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
    /*
      What this control has actually ASKED FOR, which is not always what was
      rendered.

      The over-limit branch below puts the selection back, and it put it back to
      `chosen` — the set captured when this pane was built. A valid change saved
      since then has not redrawn the pane yet, so the reset restored a selection
      that is two changes old and reported it as what is stored.

      Updated as each accepted change is dispatched, so the reset is to the last
      thing this control asked main for rather than to a snapshot of the past.
    */
    let accepted = new Set(chosen)
    languages.addEventListener('change', () => {
      const picked = [...languages.selectedOptions].map((one) => one.value)
      // Refused HERE as well as in main, so the message names the limit before
      // a write is attempted -- and the control is put back to what is actually
      // stored rather than left showing a selection that was never saved.
      if (picked.length > view.hearing.most) {
        for (const option of languages.options) option.selected = accepted.has(option.value)
        handlers.say(
          `Choose at most ${String(view.hearing.most)}${forPronoun(SAYS.tooManyLanguages, view.pronoun)}`,
          true,
        )
        return
      }
      accepted = new Set(picked)
      handlers.hearing({ languages: picked })
    })

    /*
      THE HEADING SAYS WHOSE EARS, and the hint says how full the list is.

      "Languages spoken" is a heading about the world; B2's "Languages she
      listens for" is a heading about her, which is the setting. The count
      beside it is the fact somebody needs BEFORE they open a list of twenty-four
      options and find out by being refused that three is the limit — the same
      argument A8's character count makes about its own ceiling.
    */
    const parts: Node[] = [
      field(forPronoun(SAYS.languagesHead, view.pronoun), languages, {
        hint: `${String(chosen.size)} of ${String(view.hearing.most)}`,
        note: forPronoun(chosen.size === 0 ? SAYS.noLanguages : SAYS.someLanguages, view.pronoun),
      }),
    ]
    // The limit, in words, where somebody reading the count can act on it.
    parts.push(
      element('p', 'note', `${String(view.hearing.most)} is the limit. Drop one to add another.`),
    )
    // Said plainly, because nothing on screen changes when this is saved. The
    // voice locks after her first audio, so the configuration is re-sent on the
    // next session rather than to this one.
    parts.push(element('p', 'note', forPronoun(SAYS.nextWake, view.pronoun)))
    return parts
  },
}
