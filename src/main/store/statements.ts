import type { DatabaseSync } from 'node:sqlite'

/**
 * Every statement the store runs, prepared once when the database opens.
 *
 * Held together rather than beside their callers so the SQL reads as a set --
 * which is what makes an index no query uses, or a query with no index,
 * visible at all.
 */
export function prepareAll(db: DatabaseSync) {
  return {
    begin: db.prepare('INSERT INTO session (persona_id, started_at, token) VALUES (?, ?, ?)'),
    end: db.prepare('UPDATE session SET ended_at = ? WHERE id = ? AND ended_at IS NULL'),
    personaOf: db.prepare('SELECT persona_id FROM session WHERE id = ?'),
    rowidOf: db.prepare('SELECT id FROM session WHERE token = ?'),
    // `ended_at IS NULL` IN the statement, not behind a check that ran first.
    // A read-then-write pair decides the question at a different moment from
    // the one that acts on it; this is the same rule the scoped deletes follow.
    openSession: db.prepare(
      'SELECT id, started_at FROM session WHERE token = ? AND ended_at IS NULL',
    ),
    say: db.prepare('INSERT INTO turn (session_id, at, who, text, cut) VALUES (?, ?, ?, ?, ?)'),
    // The floor a new turn -- or an `ended_at` -- may not go below.
    //
    // `parseArchive` refuses three shapes: an end before its beginning, a turn
    // outside its conversation, and turns that jump backwards. Clamping to
    // `started_at` alone satisfies the first two and BREAKS the third, so the
    // floor has to be the latest instant already committed, not the earliest.
    lastTurnAt: db.prepare('SELECT MAX(at) AS at FROM turn WHERE session_id = ?'),
    index: db.prepare('INSERT INTO turn_fts (body, turn_id, persona_id) VALUES (?, ?, ?)'),
    taken: db.prepare('SELECT 1 FROM session WHERE persona_id = ? AND started_at = ?'),
    sessions: db.prepare(`
      SELECT s.token, s.started_at, s.ended_at, count(t.id) AS turns
      FROM session s LEFT JOIN turn t ON t.session_id = s.id
      WHERE s.persona_id = ? GROUP BY s.id ORDER BY s.started_at DESC
    `),
    // Joined rather than filtered afterwards, for the reason `search` is: a
    // read that fetches everything and narrows it in JS leaks through the
    // first caller who forgets to narrow.
    turns: db.prepare(`
      SELECT t.at, t.who, t.text, t.cut
      FROM turn t JOIN session s ON s.id = t.session_id
      WHERE s.token = ? AND s.persona_id = ?
      ORDER BY t.at, t.id
    `),
    tooled: db.prepare('INSERT INTO session_tool (session_id, name, at) VALUES (?, ?, ?)'),
    /*
      What she reached for, per conversation, for one character.

      A SECOND query rather than a join onto `sessions`. That one already
      groups by session to count turns, and joining a second one-to-many
      through it multiplies the rows before the count runs -- a conversation
      with three turns and two lookups would report six turns. The two results
      are stitched in `sessionsOf`.

      Scoped to the persona IN the statement, like every other read here: a
      query that fetched every session's tools and narrowed afterwards leaks
      through the first caller who forgets to narrow.
    */
    toolsFor: db.prepare(`
      SELECT s.token, st.name, count(st.id) AS uses
      FROM session_tool st JOIN session s ON s.id = st.session_id
      WHERE s.persona_id = ?
      GROUP BY s.id, st.name
      ORDER BY st.name
    `),
    forget: db.prepare('DELETE FROM session WHERE persona_id = ?'),
    forgetIndex: db.prepare('DELETE FROM turn_fts WHERE persona_id = ?'),
    // Both scoped to the persona IN the statement rather than behind a check
    // that ran first. A read-then-write pair decides ownership at a different
    // moment from the one that acts on it, and `changes` is the only answer
    // that comes from the statement which actually ran. There is deliberately
    // no unscoped delete in this file for someone to reach for later.
    dropSession: db.prepare('DELETE FROM session WHERE token = ? AND persona_id = ?'),
    dropIndexFor: db.prepare(`
      DELETE FROM turn_fts WHERE turn_id IN (
        SELECT t.id FROM turn t JOIN session s ON s.id = t.session_id
        WHERE s.token = ? AND s.persona_id = ?
      )
    `),
    existing: db.prepare(
      'SELECT token, ended_at FROM session WHERE persona_id = ? AND started_at = ?',
    ),
  }
}
