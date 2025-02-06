import sqlite3 from 'sqlite3';
import type { CallRecord } from "./types.js";
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { promisify } from "node:util";

const DB_PATH = "data/calls.sqlite";
let db: sqlite3.Database | null = null;

// Ensure data directory exists
async function ensureDataDir() {
  const dir = dirname(DB_PATH);
  if (!existsSync(dir)) {
    await mkdir(dir, { recursive: true });
  }
}

// Function to get database connection with proper settings
function getDb(): sqlite3.Database {
  if (!db) {
    // Create new database connection if it doesn't exist
    db = new sqlite3.Database(DB_PATH, (err: Error | null) => {
      if (err) {
        console.error('Error opening database:', err);
        throw err;
      }
    });

    // Enable foreign keys and set pragmas
    db.serialize(() => {
      if (!db) throw new Error('Database connection is null');

      db.run("PRAGMA journal_mode = WAL"); // Change to WAL mode for better concurrency
      db.run("PRAGMA synchronous = NORMAL"); // Slightly faster, still safe
      db.run("PRAGMA foreign_keys = ON");
      db.run("PRAGMA busy_timeout = 10000"); // Increase timeout to 10 seconds
      db.run("PRAGMA temp_store = MEMORY");
      db.run("PRAGMA cache_size = -2000");
      db.run("PRAGMA page_size = 4096");
    });
  }

  return db;
}

// Initialize database and create tables
async function initDb() {
  await ensureDataDir();
  const database = getDb();

  return new Promise<void>((resolve, reject) => {
    database.serialize(() => {
      database.run(`
        CREATE TABLE IF NOT EXISTS calls (
          id TEXT PRIMARY KEY,
          from_number TEXT NOT NULL,
          to_number TEXT NOT NULL,
          duration TEXT NOT NULL,
          recording_url TEXT NOT NULL,
          pii_url TEXT NOT NULL,
          transcript_sid TEXT NOT NULL,
          recording_type TEXT NOT NULL DEFAULT 'regular',
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `);

      database.run(`
        CREATE TABLE IF NOT EXISTS transcripts (
          call_id TEXT NOT NULL,
          speaker TEXT NOT NULL,
          text TEXT NOT NULL,
          FOREIGN KEY(call_id) REFERENCES calls(id) ON DELETE CASCADE
        )
      `);

      // Create indexes for better query performance
      database.run("CREATE INDEX IF NOT EXISTS idx_calls_created_at ON calls(created_at)");
      database.run("CREATE INDEX IF NOT EXISTS idx_transcripts_call_id ON transcripts(call_id)");

      // Check database integrity
      database.get("PRAGMA integrity_check", (err: Error | null) => {
        if (err) {
          console.error('Error checking database integrity:', err);
          reject(err);
        } else {
          resolve();
        }
      });
    });
  });
}

// Initialize the database
let initialized = false;
export async function initialize() {
  if (!initialized) {
    await initDb();
    initialized = true;

    // Clean up database connection on process exit
    process.on('exit', () => {
      if (db) {
        try {
          db.close();
          db = null;
        } catch (error) {
          console.error('Error closing database connection:', error);
        }
      }
    });

    // Handle process termination signals
    process.on('SIGINT', () => {
      if (db) {
        try {
          db.close();
          db = null;
        } catch (error) {
          console.error('Error closing database connection:', error);
        }
      }
      process.exit(0);
    });

    process.on('SIGTERM', () => {
      if (db) {
        try {
          db.close();
          db = null;
        } catch (error) {
          console.error('Error closing database connection:', error);
        }
      }
      process.exit(0);
    });
  }
}

interface CallRow {
  id: string;
  from_number: string;
  to_number: string;
  duration: string;
  recording_url: string;
  pii_url: string;
  recording_type: 'regular' | 'redacted';
  transcript_sid: string;
  created_at: string;
  transcript_json: string;
}

export function saveCalls(call: CallRecord, transcriptSid: string): Promise<void> {
  const database = getDb();
  console.log('💾 Starting database save for call:', {
    CallSid: call.id,
    transcriptSid
  });

  return new Promise((resolve, reject) => {
    database.serialize(() => {
      database.run('BEGIN IMMEDIATE TRANSACTION'); // Use IMMEDIATE to prevent locks

      database.run(`
        INSERT INTO calls (
          id, from_number, to_number, duration,
          recording_url, pii_url, transcript_sid, recording_type, created_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      `, [
        call.id,
        call.from_number,
        call.to_number,
        call.duration,
        call.recordingUrl,
        call.piiUrl,
        transcriptSid,
        call.piiUrl ? 'redacted' : 'regular'
      ], function(err: Error | null) {
        if (err) {
          console.error('❌ Error inserting call record:', err);
          database.run('ROLLBACK');
          reject(err);
          return;
        }
        console.log('✅ Call record inserted successfully');

        const stmt = database.prepare(`
          INSERT INTO transcripts (call_id, speaker, text)
          VALUES (?, ?, ?)
        `);

        let transcriptErrors = false;
        const transcriptPromises = call.transcript.map(t =>
          new Promise<void>((resolveTranscript) => {
            stmt.run([call.id, t.speaker, t.text], (err: Error | null) => {
              if (err) {
                console.error('❌ Error inserting transcript:', err);
                transcriptErrors = true;
              }
              resolveTranscript();
            });
          })
        );

        Promise.all(transcriptPromises).then(() => {
          stmt.finalize((err: Error | null) => {
            if (err || transcriptErrors) {
              console.error('❌ Error finalizing transcript inserts:', err);
              database.run('ROLLBACK');
              reject(err || new Error('Failed to insert transcripts'));
              return;
            }
            console.log('✅ Transcripts inserted successfully');

            database.run('COMMIT', (err: Error | null) => {
              if (err) {
                console.error('❌ Error committing transaction:', err);
                database.run('ROLLBACK');
                reject(err);
              } else {
                console.log('✅ Database transaction committed successfully');
                resolve();
              }
            });
          });
        });
      });
    });
  });
}

export function getCalls(): Promise<CallRecord[]> {
  const database = getDb();

  return new Promise((resolve) => {
    database.all(`
      SELECT
        c.*,
        strftime('%Y-%m-%dT%H:%M:%SZ', c.created_at) as created_at,
        GROUP_CONCAT(json_object(
          'speaker', t.speaker,
          'text', t.text
        )) as transcript_json
      FROM calls c
      LEFT JOIN transcripts t ON t.call_id = c.id
      GROUP BY c.id
      ORDER BY c.created_at DESC
    `, [], (err: Error | null, rows: CallRow[]) => {
      if (err) {
        console.error('Error getting calls:', err);
        resolve([]);
        return;
      }

      const calls = rows.map(call => ({
        id: call.id,
        from: call.from_number,
        to: call.to_number,
        from_number: call.from_number,
        to_number: call.to_number,
        duration: call.duration,
        recordingUrl: call.recording_url,
        piiUrl: call.pii_url,
        recordingType: call.recording_type,
        transcript_sid: call.transcript_sid,
        createdAt: call.created_at,
        transcript: call.transcript_json ? JSON.parse(`[${call.transcript_json}]`) : []
      }));

      resolve(calls);
    });
  });
}

export function deleteCall(id: string): Promise<void> {
  const database = getDb();
  console.log('🗑️ Deleting call:', id);

  return new Promise((resolve, reject) => {
    database.serialize(() => {
      database.run('BEGIN IMMEDIATE TRANSACTION'); // Use IMMEDIATE to prevent locks

      // First check if the call exists
      database.get('SELECT * FROM calls WHERE id = ?', [id], (err: Error | null, row: CallRow | undefined) => {
        if (err) {
          console.error('❌ Error checking call existence:', err);
          database.run('ROLLBACK');
          reject(err);
          return;
        }

        if (!row) {
          console.error('❌ No call found to delete:', id);
          database.run('ROLLBACK');
          reject(new Error('No call found to delete'));
          return;
        }

        // Delete transcripts first (due to foreign key constraint)
        database.run('DELETE FROM transcripts WHERE call_id = ?', [id], (err: Error | null) => {
          if (err) {
            console.error('❌ Error deleting transcripts:', err);
            database.run('ROLLBACK');
            reject(err);
            return;
          }

          console.log('✅ Transcripts deleted for call:', id);

          // Then delete the call
          database.run('DELETE FROM calls WHERE id = ?', [id], (err: Error | null) => {
            if (err) {
              console.error('❌ Error deleting call:', err);
              database.run('ROLLBACK');
              reject(err);
              return;
            }

            console.log('✅ Call record deleted:', id);

            database.run('COMMIT', (err: Error | null) => {
              if (err) {
                console.error('❌ Error committing transaction:', err);
                database.run('ROLLBACK');
                reject(err);
              } else {
                console.log('✅ Delete transaction committed successfully');
                resolve();
              }
            });
          });
        });
      });
    });
  });
}
