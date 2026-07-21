import "server-only";

import { mkdirSync } from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import type { TranscriptEntry, TutoringSession } from "@/lib/session-types";

type SessionRow = {
  id: string;
  title: string;
  created_at: number;
  updated_at: number;
  last_opened_at: number;
  transcript_count: number;
};

const globalForDatabase = globalThis as typeof globalThis & {
  traceSessionDatabase?: Database.Database;
};

function createDatabase() {
  const databasePath =
    process.env.TRACE_DATABASE_PATH ?? path.join(process.cwd(), ".data", "trace.sqlite");
  mkdirSync(path.dirname(databasePath), { recursive: true });
  const database = new Database(databasePath);
  database.pragma("journal_mode = WAL");
  database.pragma("foreign_keys = ON");
  database.pragma("busy_timeout = 5000");
  database.exec(`
    CREATE TABLE IF NOT EXISTS tutoring_sessions (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      last_opened_at INTEGER NOT NULL
    ) STRICT;

    CREATE TABLE IF NOT EXISTS transcript_items (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('learner', 'professor')),
      text TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (session_id) REFERENCES tutoring_sessions(id) ON DELETE CASCADE
    ) STRICT;

    CREATE INDEX IF NOT EXISTS transcript_items_session_idx
      ON transcript_items(session_id, created_at);

    CREATE VIRTUAL TABLE IF NOT EXISTS transcript_fts USING fts5(
      item_id UNINDEXED,
      session_id UNINDEXED,
      role UNINDEXED,
      text,
      tokenize = 'unicode61'
    );
  `);
  return database;
}

function getDatabase() {
  if (!globalForDatabase.traceSessionDatabase) {
    globalForDatabase.traceSessionDatabase = createDatabase();
  }
  return globalForDatabase.traceSessionDatabase;
}

function mapSession(row: SessionRow): TutoringSession {
  return {
    id: row.id,
    title: row.title,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastOpenedAt: row.last_opened_at,
    transcriptCount: row.transcript_count,
  };
}

export function listTutoringSessions() {
  const rows = getDatabase()
    .prepare(`
      SELECT
        sessions.id,
        sessions.title,
        sessions.created_at,
        sessions.updated_at,
        sessions.last_opened_at,
        COUNT(transcript_items.id) AS transcript_count
      FROM tutoring_sessions AS sessions
      LEFT JOIN transcript_items ON transcript_items.session_id = sessions.id
      GROUP BY sessions.id
      ORDER BY sessions.last_opened_at DESC, sessions.updated_at DESC
    `)
    .all() as SessionRow[];
  return rows.map(mapSession);
}

export function createTutoringSession(id: string, title: string) {
  const now = Date.now();
  getDatabase()
    .prepare(`
      INSERT INTO tutoring_sessions (id, title, created_at, updated_at, last_opened_at)
      VALUES (?, ?, ?, ?, ?)
    `)
    .run(id, title, now, now, now);
  return getTutoringSession(id)!;
}

export function getTutoringSession(id: string) {
  const row = getDatabase()
    .prepare(`
      SELECT
        sessions.id,
        sessions.title,
        sessions.created_at,
        sessions.updated_at,
        sessions.last_opened_at,
        COUNT(transcript_items.id) AS transcript_count
      FROM tutoring_sessions AS sessions
      LEFT JOIN transcript_items ON transcript_items.session_id = sessions.id
      WHERE sessions.id = ?
      GROUP BY sessions.id
    `)
    .get(id) as SessionRow | undefined;
  return row ? mapSession(row) : null;
}

export function touchTutoringSession(id: string) {
  const now = Date.now();
  getDatabase()
    .prepare("UPDATE tutoring_sessions SET last_opened_at = ?, updated_at = ? WHERE id = ?")
    .run(now, now, id);
  return getTutoringSession(id);
}

export function renameTutoringSession(id: string, title: string) {
  getDatabase()
    .prepare("UPDATE tutoring_sessions SET title = ?, updated_at = ? WHERE id = ?")
    .run(title, Date.now(), id);
  return getTutoringSession(id);
}

export function deleteTutoringSession(id: string) {
  const database = getDatabase();
  const transaction = database.transaction(() => {
    database.prepare("DELETE FROM transcript_fts WHERE session_id = ?").run(id);
    database.prepare("DELETE FROM tutoring_sessions WHERE id = ?").run(id);
  });
  transaction();
}

export function replaceSessionTranscript(id: string, entries: TranscriptEntry[]) {
  const database = getDatabase();
  const insertItem = database.prepare(`
    INSERT INTO transcript_items (id, session_id, role, text, created_at)
    VALUES (?, ?, ?, ?, ?)
  `);
  const insertSearch = database.prepare(`
    INSERT INTO transcript_fts (item_id, session_id, role, text)
    VALUES (?, ?, ?, ?)
  `);
  const transaction = database.transaction(() => {
    database.prepare("DELETE FROM transcript_fts WHERE session_id = ?").run(id);
    database.prepare("DELETE FROM transcript_items WHERE session_id = ?").run(id);
    for (const entry of entries.slice(-500)) {
      insertItem.run(entry.id, id, entry.role, entry.text, entry.createdAt);
      insertSearch.run(entry.id, id, entry.role, entry.text);
    }
    database
      .prepare("UPDATE tutoring_sessions SET updated_at = ? WHERE id = ?")
      .run(Date.now(), id);
  });
  transaction();
}

export function searchSessionTranscripts(query: string, limit = 20) {
  const ftsQuery = query
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((term) => `"${term.replaceAll('"', '""')}"*`)
    .join(" AND ");
  if (!ftsQuery) return [];

  return getDatabase()
    .prepare(`
      SELECT
        transcript_fts.session_id AS sessionId,
        tutoring_sessions.title AS sessionTitle,
        transcript_fts.role,
        snippet(transcript_fts, 3, '[', ']', ' … ', 24) AS snippet
      FROM transcript_fts
      JOIN tutoring_sessions ON tutoring_sessions.id = transcript_fts.session_id
      WHERE transcript_fts MATCH ?
      ORDER BY rank
      LIMIT ?
    `)
    .all(ftsQuery, Math.max(1, Math.min(limit, 50)));
}