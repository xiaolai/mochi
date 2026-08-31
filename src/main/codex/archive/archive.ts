import { existsSync } from 'node:fs'
import { join } from 'node:path'

import {
  CODEX_INDEX_DIR,
  openCodexIndex,
  removeCodexIndex,
  type CodexIndex,
  type CodexRecall,
} from './index-store'
import { openCodexSource } from './read'
import { CALL_PATH_TIMEOUT_MS, MEASURED_VERSIONS } from './present'

/**
 * When the mirror is built, when it is refreshed, and when it is thrown away.
 *
 * ## Everything that reads another application's archive goes through here
 *
 * The plan's first version gated the TOOL and not the INDEXER, which is the
 * wrong half: nothing stopped Mochi opening somebody's Codex database — and
 * creating a `-shm` beside it — before anyone had granted anything. So the
 * permission is checked HERE, in the one place a source handle is opened, and
 * it is checked again before every slice rather than once when a build was
 * queued. Somebody who revokes the switch while a cold build is running has
 * said they do not want it.
 *
 * ## The triggers, and startup is not one of them
 *
 * - **granting the permission** starts the cold build, in the background;
 * - **configuring a session, or a call arriving** calls `ensureBuilt`, which
 *   resumes a build that was interrupted and does nothing otherwise;
 * - **a capability call** also refreshes, which is milliseconds;
 * - **revoking the permission** throws the mirror away.
 *
 * Never on startup. A companion that read nine thousand conversations every
 * time it launched would be doing the most invasive thing it can do at the
 * moment nobody asked for anything.
 *
 * ## Why readiness is not persisted as consent
 *
 * "Granted but still building" has to keep the tool off the wire, and it must do
 * that WITHOUT rewriting anybody's stored answer. So readiness is a fact about
 * this machine's index — `built()` — and the grant is a fact about what somebody
 * chose. `ready()` is the conjunction, computed fresh; nothing here ever writes
 * a permission.
 */

export interface CodexArchiveDeps {
  /** Where Mochi's own store lives. The mirror is ours; Codex's files are not. */
  readonly userData: () => string
  /** `$CODEX_HOME`, or `~/.codex`. Resolved by the caller, not assumed here. */
  readonly home: () => string
  /**
   * Whether the permission is given RIGHT NOW.
   *
   * A function and not a boolean, and it is asked again before every slice.
   * That is the difference between a build that stops when somebody says stop
   * and one that finishes reading their history first.
   */
  readonly allowed: () => boolean
  readonly log?: (line: string) => void
  readonly note?: (detail: string) => void
  /**
   * The mirror just became answerable, so whatever she is holding is stale.
   *
   * A build finishing CHANGES WHAT SHE MAY DO: the tool is not on the wire while
   * the index is building, and it is afterwards. Without this she keeps the tool
   * list she was configured with until something else re-tells her — which, for
   * a build started at a wake, is the wake after this one.
   *
   * ONE hook rather than a `.then` per trigger, because there are two triggers
   * and they had already drifted: the grant handler had one and `settle()` did
   * not, so a build resumed at a wake left her without the tool for that whole
   * session.
   */
  readonly becameReady?: () => void
}

export interface CodexArchive {
  /**
   * The read side for a capability call: refreshed, or null.
   *
   * Null for all three of "not permitted", "not built yet" and "Codex's archive
   * cannot be read". They are one sentence to her — *I could not look* — and
   * the log is where the difference between them is recorded.
   */
  recall(): CodexRecall | null
  /** Whether the tool may be offered at all. Permitted, and built. */
  ready(): boolean
  /** Build until it is level, in slices, re-checking the permission throughout. */
  build(): Promise<void>
  /**
   * Reconcile the mirror against the permission — build it, or remove it.
   *
   * The durable half of both triggers. Called wherever a session is configured,
   * so an interrupted build resumes and an interrupted deletion completes,
   * without anybody having to touch the switch again.
   */
  settle(): void
  close(): void
}

/** How long the event loop gets between slices of a cold build. */
const BREATH_MS = 0

export function createCodexArchive(deps: CodexArchiveDeps): CodexArchive {
  const say = deps.log ?? ((): void => undefined)
  const note = deps.note ?? ((): void => undefined)

  /**
   * Say the mirror is answerable now, and never let saying it break the build.
   *
   * `becameReady` reaches the live session, which is a window that can have been
   * destroyed — the hazard `dispatch.ts` wraps every observer for. A failure to
   * re-tell her is a tool she does not know she has; a throw here would be a
   * build that reported itself failed after it had succeeded.
   */
  function announce(): void {
    try {
      deps.becameReady?.()
    } catch (error: unknown) {
      say(`[recall-codex] built, but the live session could not be told: ${String(error)}`)
    }
  }
  let index: CodexIndex | null = null
  let building = false
  /**
   * The archive has been put down for good. See `close`.
   *
   * A build waits on a timer between slices, so a continuation can come back
   * AFTER shutdown has closed everything — and `held()` would cheerfully reopen
   * the mirror and Codex's databases on the way out of an app that is quitting.
   * `close()` cannot cancel a pending timer, so it leaves this instead, and
   * every path that could reopen something reads it.
   */
  let closed = false

  /**
   * Mochi's own index, opened on demand.
   *
   * Not opened when the permission is withheld — not because opening it would
   * read anything of Codex's (it would not; this file is ours) but because
   * there is nothing to do with it, and a store nobody can query is a file
   * created for no reason.
   */
  function held(): CodexIndex | null {
    if (closed) return null
    if (!deps.allowed()) return null
    if (index !== null) return index
    try {
      index = openCodexIndex(deps.userData())
      return index
    } catch (error: unknown) {
      /*
        THE MIRROR IS DISPOSABLE, so a corrupt one is not a dead end.

        This only logged, which meant every later `ready()`, `build()` and
        `recall()` retried the same broken file — the capability would stay
        unavailable for ever over a derived artefact whose source is sitting
        right there. So it is removed and rebuilt ONCE per open, and a failure
        of the retry is reported rather than looped.
      */
      say(`[recall-codex] the index could not be opened (${String(error)}); rebuilding it`)
      try {
        removeCodexIndex(deps.userData())
        index = openCodexIndex(deps.userData())
        return index
      } catch (again: unknown) {
        say(`[recall-codex] the index could not be rebuilt: ${String(again)}`)
        note(`their Codex history could not be indexed: ${String(again)}`)
        return null
      }
    }
  }

  /**
   * One refresh pass against the live archive, with both handles closed after.
   *
   * Returns false when the source could not be opened at all — which is NOT
   * treated as "nothing changed". A mirror that answered from its own contents
   * while Codex's archive was unreadable would go on recalling conversations
   * that may since have been deleted, which is the exact failure reconciliation
   * exists to prevent.
   */
  function refresh(store: CodexIndex, slice?: number): boolean {
    if (!deps.allowed()) return false
    // THE SHORT timeout: this is `recall()`'s path, which runs on the main
    // thread inside a capability call. The builder below uses the long one.
    const opened = openCodexSource(deps.home(), CALL_PATH_TIMEOUT_MS)
    if (opened.kind !== 'open') {
      say(`[recall-codex] their Codex archive is unavailable (${opened.reason}): ${opened.detail}`)
      return false
    }
    try {
      const report =
        slice === undefined
          ? store.refresh(opened.source, { stillAllowed: deps.allowed })
          : store.refresh(opened.source, { slice, stillAllowed: deps.allowed })
      if (report.threadsRead > 0 || report.threadsRemoved > 0) {
        say(
          `[recall-codex] ${String(report.threadsRead)} threads read, ` +
            `${String(report.threadsRemoved)} removed, ${String(report.documents)} documents`,
        )
      }
      /*
        DONE, or it is not a refresh — and this returned `true` regardless.

        A refresh takes one slice of stale threads at a time, so a partial pass
        leaves the rest of them exactly as they were. That is fine for content
        that is merely out of date and NOT fine for content that is gone:
        removing a thread whose projection Codex dropped happens in the
        per-thread loop, so a pass that stopped early can leave those turns
        searchable — and a search result is transmitted.

        So an incomplete pass is answered as "I could not look" and the rest is
        finished in the background. The next call is a full pass.
      */
      return report.done && !report.halted
    } catch (error: unknown) {
      // Codex rebuilds this projection from rollouts by design, so a read that
      // fails part-way is an ordinary state of the world rather than a fault of
      // ours. Reported, and not thrown: the caller is on the voice path.
      say(`[recall-codex] the refresh failed: ${String(error)}`)
      note(`their Codex history could not be re-read: ${String(error)}`)
      return false
    } finally {
      opened.source.close()
    }
  }

  /**
   * Bring the mirror level, in slices, with the event loop free between them.
   *
   * `node:sqlite` is synchronous, so a build that ran to completion in one turn
   * would block the main thread for as long as it took — six seconds on the
   * measured archive, during which her window does not redraw and nothing she
   * says is processed. Yielding between slices is what makes "off the call
   * path" true rather than nominal.
   */
  async function build(): Promise<void> {
    if (building) return
    building = true
    /*
      EDGE-TRIGGERED, and it was level-triggered.

      `becameReady` re-tells the live session, which sends a `session.update`
      with her whole instruction block and tool list. Announcing on every
      completed pass meant announcing on every wake, because a wake schedules a
      build and a level mirror completes immediately — a frame that says
      something changed, on a session where nothing had.

      Captured before the first pass rather than compared after it, so a build
      that spans several slices announces once at the end and not per slice.
    */
    const wasReady = index !== null && index.built()
    try {
      for (;;) {
        /*
          A BREATH BEFORE EVERY SLICE, INCLUDING THE FIRST, and the position is
          the correctness rather than a detail.

          `node:sqlite` is synchronous, so a build that ran to completion in one
          turn would block the main thread for as long as it took — six seconds
          on the measured archive, during which her window does not redraw and
          nothing she says is processed.

          The yield was at the END of the loop, which spaced the slices out and
          still ran the FIRST one inside the caller. `settle()` runs on every
          wake, so that put an open of Codex's databases and a full refresh on
          the path that configures her session — while its own comment promised
          "one boolean when there is nothing to do". Moving the yield up is what
          makes that sentence true.
        */
        await new Promise((wake) => setTimeout(wake, BREATH_MS))
        // Shut down while this slice was waiting. Nothing to build for, and
        // nothing that may reopen a file on the way out.
        if (closed) return
        if (!deps.allowed()) {
          say('[recall-codex] the permission was withdrawn; the build stopped')
          return
        }
        const store = held()
        if (store === null) return
        const opened = openCodexSource(deps.home())
        if (opened.kind !== 'open') {
          say(
            `[recall-codex] their Codex archive is unavailable (${opened.reason}): ${opened.detail}`,
          )
          return
        }
        let report
        try {
          report = store.refresh(opened.source, { stillAllowed: deps.allowed })
        } catch (error: unknown) {
          say(`[recall-codex] the build failed: ${String(error)}`)
          note(`their Codex history could not be indexed: ${String(error)}`)
          return
        } finally {
          opened.source.close()
        }
        if (report.done) {
          /*
            THE TELEMETRY, read here and nowhere else.

            The migration counters are deliberately not a gate — pinning them
            refuses a Codex that is merely one additive index ahead. What they
            are for is this line: when somebody reports that recall stopped
            working, the log says which Codex produced the index, and whether it
            had moved past the version this build was measured against.
          */
          const found = opened.source.presence.versions
          const moved =
            found.state !== MEASURED_VERSIONS.state || found.history !== MEASURED_VERSIONS.history
          say(
            `[recall-codex] the index is built — Codex schema ${String(found.state)}/` +
              `${String(found.history)}${moved ? ` (measured against ${String(MEASURED_VERSIONS.state)}/${String(MEASURED_VERSIONS.history)})` : ''}`,
          )
          if (!wasReady) announce()
          return
        }
        if (report.halted) return
      }
    } finally {
      building = false
    }
  }

  /**
   * Start the build if it is permitted and has not finished, and do nothing
   * otherwise.
   *
   * INTERNAL, and it used to be on the interface. `settle()` is the trigger
   * everything outside reaches for, because it is the one that is right in both
   * directions — a permission that is off has to remove the mirror as durably as
   * one that is on has to build it. An `ensureBuilt` on the interface was a way
   * to do half of that and believe it was the whole job.
   *
   * Idle when there is nothing to do, so calling it on a path that runs at every
   * wake costs one boolean.
   */
  /**
   * Build the mirror if it has never finished one whole pass.
   *
   * For `settle()`, which runs at every wake. Gated on `built()` because a wake
   * is not a reason to touch another application's database: a mirror that has
   * finished a pass is answerable, and anything owed on top of that is picked up
   * by `resume()` on the call that notices.
   *
   * Without the gate this scheduled a probe of Codex's archive on every single
   * wake, and — because a level pass completes — announced readiness every time
   * too, sending her a `session.update` that said something had changed when
   * nothing had.
   */
  function ensureBuilt(): void {
    if (building || closed) return
    if (!deps.allowed()) return
    const store = held()
    if (store === null || store.built()) return
    void build()
  }

  /**
   * Finish what a refresh reported it had not, whatever `built()` says.
   *
   * For `recall()`, and the distinction from `ensureBuilt` is the whole reason
   * there are two. "Built" means a whole pass finished ONCE; it says nothing
   * about whether the mirror is level NOW, because a refresh takes one slice of
   * stale threads at a time. Gated on `built()`, a large change made `recall()`
   * refuse the incomplete index (rightly) and then ask for a resume that
   * returned at the door (wrongly) — so every later call had to advance one
   * slice of its own, answering "I could not look" each time.
   */
  function resume(): void {
    if (building || closed) return
    if (!deps.allowed()) return
    if (held() === null) return
    void build()
  }

  /**
   * Everything borrowed, removed — and it may not fail quietly.
   *
   * Called when the permission is withdrawn. Leaving somebody's Codex history in
   * `userData` after they switched the switch off would make the panel's promise
   * false, and this app's whole argument about permissions is that they are
   * decisions somebody made rather than decorations.
   *
   * ## Three ways this can fail, and none of them may pass quietly
   *
   * The rows can be deleted and the write-ahead log left holding them — which is
   * why `index.forget()` ANSWERS rather than returning void. The delete itself
   * can throw. And the fallback removal can throw too. Every one of them ends
   * with the file removed if that is possible at all, and with a problem
   * somebody can see if it is not.
   */
  function forget(): void {
    const store = index
    if (store !== null) {
      /*
        ZEROED FIRST, THEN REMOVED, and both halves are doing something.

        Emptying through the store is what makes the bytes go: `secure_delete`
        overwrites the freed pages and the checkpoint moves the deleted text out
        of the write-ahead log, where it would otherwise sit across launches.
        Unlinking alone does neither — it releases the blocks and leaves their
        contents on the disk until something else happens to reuse them.

        Removing the file is what makes the README true. "Switching it off
        deletes Mochi's copy" is not satisfied by an empty database sitting
        where the copy was; re-granting rebuilds from source in seconds, so
        there is nothing to keep.
      */
      try {
        if (!store.forget()) {
          say('[recall-codex] the log could not be truncated; the file is being removed anyway')
        }
      } catch (error: unknown) {
        say(`[recall-codex] the index could not be emptied (${String(error)}); removing it`)
      }
      // Closed before the removal: a handle open on a database is a handle open
      // on its write-ahead log. `held()` reopens on the next call, so nothing
      // here is a one-way door.
      try {
        store.close()
      } catch {
        // Already gone. The removal below is what matters.
      }
      index = null
    }
    try {
      removeCodexIndex(deps.userData())
    } catch (error: unknown) {
      say(`[recall-codex] the index could not be removed: ${String(error)}`)
      note(
        'their borrowed Codex history could not be deleted from this machine — ' +
          `it will be retried, and until then it is still on disk: ${String(error)}`,
      )
    }
  }

  /**
   * Make the mirror match the permission, on a path that runs at every wake.
   *
   * Revoking writes the permission FIRST and deletes second, so a crash — or a
   * throw from the deletion — between the two leaves the mirror on disk with
   * nothing in the process that remembers it should not be there. The switch
   * already reads "withheld", so nobody has a reason to toggle it again, and
   * "off deletes Mochi's copy" quietly stops being true.
   *
   * Reconciling here makes the deletion durable rather than momentary: it is
   * retried at her next wake, for as long as the permission stays off. Costs one
   * `existsSync` when there is nothing to do.
   */
  function settle(): void {
    if (deps.allowed()) {
      ensureBuilt()
      return
    }
    if (index !== null || existsSync(join(deps.userData(), CODEX_INDEX_DIR))) {
      say('[recall-codex] the permission is withheld; removing the mirror')
      forget()
    }
  }

  return {
    ready() {
      if (!deps.allowed()) return false
      const store = held()
      return store !== null && store.built()
    },

    recall() {
      const store = held()
      if (store === null) return null
      if (!store.built()) {
        /*
          Nothing waits for a cold build. The tool is not on the wire in this
          state, so arriving here means the model is holding an older tool list
          — she is answered with "I could not look".

          And the build is STARTED rather than merely reported. This is the
          second of the two triggers: if the grant-change trigger never ran, or
          ran and was interrupted, this is what stops the capability being
          permanently unavailable while its switch reads "allowed".
        */
        say('[recall-codex] the index is not built yet; answering that she could not look')
        ensureBuilt()
        return null
      }
      if (!refresh(store)) {
        // Either the source could not be read or the pass did not finish. Both
        // are "I could not look"; the second one is worth finishing in the
        // background so the next call is answerable. `resume`, not
        // `ensureBuilt`: the index IS built, and what is owed is the rest of it.
        resume()
        return null
      }
      /*
        ASKED AGAIN, because the refresh above is not instantaneous.

        The permission is a file somebody can change from a window that is open
        right now, and everything between `held()` and here has been reading
        another application's archive. A store handed back after a revocation
        would answer one more question than it was allowed to.
      */
      if (!deps.allowed()) return null
      return store
    },

    build,

    settle,

    close() {
      // BEFORE the handle goes, so a slice waiting on a timer sees it and stops
      // rather than reopening what this is closing.
      closed = true
      if (index === null) return
      index.close()
      index = null
    },
  }
}
