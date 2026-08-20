import { EMOTIONS, type Emotion } from '@shared/avatar'
import type { Capability } from '../kind'

/**
 * The face she wears while she answers.
 *
 * ## Why this is a tool and not a guess
 *
 * Eight expressions are drawn — `neutral`, `happy`, `shy`, `sad`, `angry`,
 * `surprised`, `thinking`, `sleepy` — and until now two were reachable. `sleepy`
 * is what she wears asleep and `neutral` is everything else; the other six were
 * shipped, painted, and unreachable, because `setEmotion` had no caller outside
 * the rig.
 *
 * Inferring the face from her words was the obvious alternative and is worse.
 * Sentiment read off a transcript is a guess made by something that cannot hear
 * her tone, and it would be wrong in the direction that matters: a
 * misclassified apology is a companion smiling while she delivers bad news.
 * Asking her is asking the only party that knows what it meant.
 *
 * ## The enum is per character
 *
 * `manifest` here declares all eight, and `whatSheMayDo` narrows it to the worn
 * character's `faces` before it goes on the wire. So a character that uses three
 * is OFFERED three — the rest are not in her tool list at all, and she cannot
 * reach for a face this character does not use. Describing all eight and asking
 * her not to use five would be a rule she can break; leaving them out is not.
 *
 * ## Immediate, and it answers with what it did
 *
 * `immediate` because the whole action is one number crossing to the renderer.
 * The answer names the face so the transcript records what she chose rather than
 * that she chose something — a conversation replayed later otherwise has her
 * changing expression invisibly.
 */

function cannot(guidance: string): { status: 'refused'; guidance: string } {
  return { status: 'refused', guidance }
}

export const capability: Capability = {
  manifest: {
    name: 'set_expression',
    description:
      'Wear one of your expressions for what you are about to say. Call this when your face should not be neutral — you are pleased, you are about to deliver bad news, you were caught being wrong, something surprised you. Do not call it for every reply; a face that changes on every sentence stops meaning anything. The expression stays until you change it or until you are asked to rest.',
    parameters: {
      type: 'object',
      properties: {
        face: {
          type: 'string',
          description: 'Which expression to wear.',
          enum: [...EMOTIONS],
        },
      },
      required: ['face'],
    },
  },
  kind: 'immediate',
  handler: (args, deps) => {
    const face = args['face'] ?? ''
    const allowed = deps.facesSheMayWear()

    /*
      The empty case FIRST, and that ordering is the whole of it.

      It was last, behind "is this one of the eight" — so a character who wears
      one face, asked for a perfectly real `happy`, was told "this character does
      not use happy" and would sensibly try `neutral` next, and the one after
      that. Saying up front that there is nothing to choose from is the only
      answer that ends the sequence.
    */
    if (allowed.length === 0) {
      return cannot('You have no expressions to choose from; keep the face you have.')
    }
    if (!(EMOTIONS as readonly string[]).includes(face)) {
      // Names the ones she ACTUALLY has, which after narrowing is not the whole
      // tuple — a refusal listing faces she was never offered would send her
      // straight back to one that is not on her wire.
      return cannot(`"${face}" is not one of your expressions. You have: ${allowed.join(', ')}.`)
    }
    if (!allowed.includes(face as Emotion)) {
      return cannot(`This character does not use "${face}". You have: ${allowed.join(', ')}.`)
    }
    if (!deps.wearExpression(face as Emotion)) {
      // She is not on screen. Saying so beats a silent success, which would have
      // her narrating a face nobody can see.
      return cannot('Your face could not be changed just now; say what you mean in words.')
    }
    return { status: 'done', answer: { summary: `Now wearing ${face}.`, detail: '' } }
  },
}
