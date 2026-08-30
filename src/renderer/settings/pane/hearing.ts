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
 * ## Many at once, because the answer is genuinely plural
 *
 * Switching language mid-sentence is ordinary for this project, which is the
 * whole reason the field is `languages` and not `language`. A single picker
 * would make a bilingual conversation choose which half to transcribe well.
 *
 * ## A pill each, and NOT a `<select multiple>`
 *
 * It was an eight-row list box holding twenty-four languages. Three things were
 * wrong with that, and only the first is cosmetic:
 *
 * - It reads as a scrolling list of ONE choice. Nothing about a list box says
 *   that more than one may be taken; the only sign is a modifier key somebody
 *   has to already know about.
 * - The default gesture DESTROYS the setting. A plain click on an option
 *   deselects every other one — that is what a list box does — and this pane
 *   saves on `change`. So somebody holding English, Chinese and Japanese who
 *   clicked Korean without the modifier was left with Korean alone, and the
 *   status bar said "Saved." Arrow keys do the same thing to a keyboard user.
 * - Sixteen of the twenty-four sat below the fold, so choosing meant scrolling
 *   a box inside a page that scrolls.
 *
 * Twenty-four pills wrap into three rows and stand shorter than the eight rows
 * did. Every language is on screen, each is one click, and the gesture that
 * used to wipe the setting is the one that now adds to it. `sheet/file.ts`
 * makes the same call from the other side: a `<select>` is for a list this
 * build cannot enumerate, which a fixed twenty-four is not.
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
    /*
      `pills` — the component her voice and her pronoun are already chosen with,
      so this adds no class and no rule beyond teaching the sheet that a PRESSED
      pill is drawn like a current one.

      Chosen is a full inversion of ink and paper rather than a tint, which is
      why no tick is drawn beside the word: the archive's rows carry one because
      their state is a wash somebody may not separate from a hover, and a
      reversal of lightness is not that.
    */
    const languages = element('div', 'pills')
    /*
      A GROUP, because a row of buttons is not one control and there is nothing
      for a `<label for>` to point at — `settingRow` makes that argument at
      length. Named with `aria-label` rather than `aria-labelledby`: the heading
      is drawn by `field` and carries no id, and an id invented here is an id
      another call site can invent too.
    */
    languages.setAttribute('role', 'group')
    languages.setAttribute('aria-label', forPronoun(SAYS.languagesHead, view.pronoun))
    /*
      What this control has actually ASKED FOR, which is not always what was
      rendered.

      `chosen` is the set captured when the pane was built and it never moves:
      the redraw comes from an asynchronous save and reload, so until that lands
      every pill still believes the answer this render opened with. Two quick
      picks would otherwise both compute their new list from the same stale set,
      and the second would undo the first. `chooser` keeps the same book for the
      same reason.
    */
    const accepted = new Set(chosen)
    for (const one of view.hearing.choices) {
      const pill = element('button', undefined, one.label)
      pill.type = 'button'
      pill.setAttribute('aria-pressed', String(accepted.has(one.code)))
      pill.addEventListener('click', () => {
        const on = accepted.has(one.code)
        // Refused HERE as well as in main, so the message names the limit
        // before a write is attempted. Nothing on the pill moves, so the
        // control never shows a choice that was not saved.
        if (!on && accepted.size >= view.hearing.most) {
          handlers.say(
            `Choose at most ${String(view.hearing.most)}${forPronoun(SAYS.tooManyLanguages, view.pronoun)}`,
            true,
          )
          return
        }
        if (on) accepted.delete(one.code)
        else accepted.add(one.code)
        // Marked before the save lands, so the pill shows what it asked for
        // rather than the answer it is replacing. The redraw confirms it.
        pill.setAttribute('aria-pressed', String(!on))
        /*
          The set's own order: what was stored, with anything new on the end. A
          code this build does not offer — one written by a later version — has
          no pill and cannot be reached, but it rides through every save rather
          than being dropped, which is the tolerance `readLanguages` argues for
          on the way in.
        */
        handlers.hearing({ languages: [...accepted] })
      })
      languages.append(pill)
    }

    /*
      THE HEADING SAYS WHOSE EARS, and the hint says how full the list is.

      "Languages spoken" is a heading about the world; B2's "Languages she
      listens for" is a heading about her, which is the setting. The count
      beside it is the fact somebody needs BEFORE they open a list of twenty-four
      options and find out by being refused that six is the limit — the same
      argument A8's character count makes about its own ceiling.

      IT NAMES WHAT IT COUNTS, which is the whole of this fix.

      It read "0 of 6". A bare pair of numbers in the apparatus face, set beside
      a heading, on the one pane in this window that holds a single control, is
      read as a POSITION — "screen 1 of 6", of which five more are somewhere —
      rather than as a tally of what has been picked. People asked where the
      other five were.

      The ceiling is the half that still cannot be seen. How many are chosen is
      countable at a glance now — every pill is on screen and the chosen ones
      are reversed — but nothing on a pill says that the seventh is refused.

      Every other hint here already carries the word that says what its number
      is: "Withheld · 1 of 3", "3 · not editable here", "after 10 min",
      "nobody has chosen one". This one was the exception, and a number with no
      noun is the one kind of apparatus text a reader has to guess at.
    */
    const parts: Node[] = [
      field(forPronoun(SAYS.languagesHead, view.pronoun), languages, {
        hint: `${String(chosen.size)} chosen · ${String(view.hearing.most)} at most`,
        note: forPronoun(chosen.size === 0 ? SAYS.noLanguages : SAYS.someLanguages, view.pronoun),
      }),
    ]
    /*
      The instruction, only in the state it is an instruction in.

      It was drawn at every count, so a pane holding one language told somebody
      to drop one before adding another — which is false everywhere except at
      the ceiling, and which made the ceiling read as a count already reached.
      The hint above carries the number now, so this carries only what to do
      when the number has run out.
    */
    if (chosen.size >= view.hearing.most) {
      parts.push(
        element('p', 'note', `${String(view.hearing.most)} is the limit. Drop one to add another.`),
      )
    }
    // Said plainly, because nothing on screen changes when this is saved. The
    // voice locks after her first audio, so the configuration is re-sent on the
    // next session rather than to this one.
    parts.push(element('p', 'note', forPronoun(SAYS.nextWake, view.pronoun)))
    return parts
  },
}
