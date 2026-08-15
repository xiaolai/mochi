/**
 * What a persona can DO, as an interface over the session.
 *
 * ## Why this exists
 *
 * The vocabulary drill was wired straight into the composition root: four
 * hooks in `index.ts`, a hardcoded `words.json` in a store module, and a
 * persona-specific `if` in the middle of the lifecycle. That is one behaviour
 * costing a change in three files, and the second behaviour would have cost
 * the same again. The app was becoming a collection of hardcoded plugins.
 *
 * So the session's capabilities are wrapped once, here, and a behaviour is a
 * consumer of that wrapper. `index.ts` dispatches; it no longer knows what a
 * drill is.
 *
 * ## The interface is mochi's, not OpenAI's
 *
 * It is INFORMED by what Realtime affords and deliberately does not mirror it.
 * Two places where mirroring would be wrong, both measured in this project:
 *
 * - `response.done` arrives seconds before her audio finishes, and the gap
 *   grows with the utterance: 2.1s on a greeting, 7.9s on an eight-second
 *   drill item. The
 *   model generates faster than real time. So `onUtteranceEnded` is driven by
 *   the audio actually stopping, not by the protocol saying the response is
 *   complete. A capability that advanced on `response.done` would move on
 *   while she was still talking.
 *
 * - Isolation is three dimensions (see `shared/utterance.ts`), and the API
 *   keeps them separate for good reason. A single boolean would have made the
 *   drill and an internal classification indistinguishable.
 *
 * Keeping the vocabulary ours is also rule 5 in AGENTS.md: a provider swap or
 * a protocol revision must not break every behaviour written against it.
 */

import type { Isolation, UtteranceEnded, UtteranceId } from '@shared/utterance'

/**
 * What a behaviour may ask of the live session.
 *
 * Deliberately small. Everything here is something the Realtime protocol can
 * actually do; nothing here is a convenience that would have to be emulated if
 * the provider changed.
 */
export interface SessionView {
  /**
   * Ask her to say something. Returns the id to follow it by.
   *
   * `null` when there is no live session to ask -- she is asleep, or the
   * attempt has been retired. Returning null rather than throwing because a
   * behaviour reacting to a stale event is ordinary, not exceptional.
   */
  say(instructions: string, isolation: Isolation): UtteranceId | null
  /** Stop one utterance. Ignored if it has already ended. */
  stop(id: UtteranceId): void
}

/**
 * A behaviour attached to a persona.
 *
 * Every hook is optional: a plain companion implements none of them and is
 * exactly what she is today. The session view is passed in rather than held,
 * so a behaviour cannot keep a handle to a session that has since closed.
 */
export interface Capability {
  /** Named for logs and for the settings window. */
  readonly name: string
  /**
   * She has just woken and the session is configured.
   *
   * Takes the session and asks for its own opening line, exactly as the other
   * hooks do. It returned instructions once, and the lifecycle spoke them --
   * which meant the id belonged to the lifecycle and the capability had
   * nothing to follow its own first utterance by. It committed on the spot,
   * so a session's first item was counted whether or not she ever said it.
   *
   * Going through `say` makes waking the same path as everything else, and
   * "the same path" is what stops one moment having its own rules.
   */
  onWake?: (session: SessionView) => void
  /** A finished user turn, as text. Runs on the reply path -- keep it cheap. */
  onUserSaid?: (text: string, session: SessionView) => void
  /** One of her utterances ended, and how. */
  onUtteranceEnded?: (ended: UtteranceEnded, session: SessionView) => void
  /**
   * Whether the app owns every utterance.
   *
   * True turns off the server's own replies (`create_response: false`), so she
   * speaks only when this capability asks. It is a property of the behaviour
   * rather than a setting: a drill that answered questions on its own would
   * not be a drill.
   */
  readonly drives: boolean
}
