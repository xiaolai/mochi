/**
 * Known credential shapes, removed before anything leaves this machine.
 *
 * ## The argument this exists to overturn, stated first
 *
 * The plan argued AGAINST redaction, and the argument was: excluding
 * `commandExecution` already removes the bulk source of credential material, no
 * regex catches every secret, and the remaining exposure is acoustic — her
 * saying something out loud in a room with other people — bounded by five hits
 * of three hundred characters behind a default-off switch.
 *
 * **The premise was false.** A capability result is not merely spoken:
 * `capability/ledger.ts` sends every one as a `function_call_output` on the
 * `conversation.item.create` frame, and `renderer/companion/audio/session.ts`
 * forwards every non-private frame onto the WebRTC data channel. A recall hit
 * is **transmitted to OpenAI's Realtime service**. So the one key-shaped string
 * measured in the indexable corpus would leave the machine, not just the room.
 *
 * And the correct answer to the rest of that argument is the short one:
 * *"no regex catches every secret" is not a reason to skip a conservative mask
 * for known token and PEM forms.*
 *
 * ## What it deliberately does NOT do
 *
 * It does not make this safe, and nothing may describe it that way. Unknown
 * secret shapes pass — a password typed as a sentence, a token with a private
 * prefix, a key in a format invented next year — and the README says so rather
 * than implying a guarantee this cannot give. What is measurable is what is
 * claimed: excluding command output removes the bulk source (measured: one
 * key-shaped string in the indexed corpus, sixteen in the excluded one), and
 * the forms below are removed on top of that.
 *
 * ## Why every pattern is narrower than it could be
 *
 * A mask that mangles ordinary prose is worse than no mask, because it makes
 * her quote somebody's sentence back to them wrongly and there is no way for
 * the listener to tell. So every pattern starts at a word boundary, and the
 * boundary is doing more work than it looks: `risk-`, `task-`, `desk-`, `ask-`
 * and `mask-` all contain `sk-`, and in every one of them the `s` is preceded
 * by a letter — so `\bsk-` does not match. That is what makes it safe to allow
 * hyphens INSIDE the tail, which the first version of this did not.
 *
 * **Not allowing them was a real hole**, found in review: modern OpenAI keys
 * are `sk-proj-…` and `sk-svcacct-…`, and a tail that stopped at the second
 * hyphen saw four characters where it wanted twenty. The prefixes this feature
 * is most likely to meet were the ones it did not mask.
 */

/** What replaces a match. Short, obvious, and not itself readable as an order. */
export const REDACTED = '[redacted]'

/**
 * The forms, each with the reason its bounds are where they are.
 *
 * Nothing here is on a hunch — a pattern nobody can point at a real format for
 * is a pattern that will one day eat a sentence.
 */
const MASKED_SHAPES: readonly RegExp[] = [
  /*
    OpenAI keys, including the hyphenated modern prefixes.

    `\b` BEFORE the `sk` is the whole safety property: in `risk-based` the `sk`
    is preceded by `i`, so there is no boundary and no match. With that in
    place the tail can admit `-`, which is what `sk-proj-…` and `sk-svcacct-…`
    need — and what the first version of this pattern refused, leaving the two
    most common current formats unmasked.
  */
  /\bsk-[A-Za-z0-9_-]{20,}/g,
  /*
    GitHub, every documented prefix rather than the two the plan happened to
    name. `ghp_` is a classic PAT, `gho_` an OAuth token, `ghu_`/`ghs_` user
    and server tokens, `ghr_` a refresh token; `github_pat_` is the
    fine-grained PAT, which is the long-lived one and was missing entirely.
    None of these prefixes appears in an English word.
  */
  /\bgh[pousr]_[A-Za-z0-9]{20,}/g,
  /\bgithub_pat_[A-Za-z0-9_]{20,}/g,
  /*
    AWS access key ids: exactly twenty characters, all upper case. AWS's own
    documented shape, and narrow enough that it cannot collide with a word.

    BOTH prefixes. `AKIA` is a long-lived key and `ASIA` is the temporary one
    STS issues — and the temporary one is the likelier of the two to have been
    pasted into a conversation about why something stopped working.
  */
  /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g,
  /*
    A secret NAMED and then assigned, which is what a pasted `.env` looks like.

    The forms above recognise a credential by its own shape. This one recognises
    it by the name in front of it, which is the only way to catch the values
    that have no shape of their own — an AWS secret access key is forty
    characters of base64 and looks like nothing in particular.

    Narrow on purpose: a KNOWN name, an assignment, and at least sixteen
    characters of value. "we set AWS_SECRET_ACCESS_KEY in the environment" has
    no assignment and is left alone; `AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMI...`
    is not prose in any language.
  */
  /\b(?:AWS_SECRET_ACCESS_KEY|AWS_SESSION_TOKEN|GITHUB_TOKEN|OPENAI_API_KEY|ANTHROPIC_API_KEY|NPM_TOKEN|SLACK_TOKEN)\b\s*[=:]\s*["']?[A-Za-z0-9/+_=.-]{16,}["']?/g,
  /*
    PEM blocks — the BODY, not only the marker.

    A hit is clipped to three hundred characters, so masking the `-----BEGIN`
    line alone would leave the first two hundred and fifty characters of the key
    itself in the payload, which is the part that matters. Ungreedy, and it
    stops at the end of the text when there is no `-----END`, because a clipped
    block is still a block.
  */
  /-----BEGIN [A-Z0-9 ]*KEY-----[\s\S]*?(?:-----END [A-Z0-9 ]*KEY-----|$)/g,
]

/**
 * One string with every known credential shape replaced.
 *
 * Applied to EVERY field of a hit that came from the archive — what was said
 * and where it was said — because a mask on one of them is a mask with a hole
 * in it.
 */
export function masked(text: string): string {
  let held = text
  for (const shape of MASKED_SHAPES) held = held.replace(shape, REDACTED)
  return held
}
