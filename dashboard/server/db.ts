import { Database } from "bun:sqlite";
import type { CallRecord } from "./types";

const db = new Database("data/calls.sqlite");

// Initialize tables
db.run(`
  CREATE TABLE IF NOT EXISTS calls (
    id TEXT PRIMARY KEY,
    from_number TEXT NOT NULL,
    to_number TEXT NOT NULL,
    duration TEXT NOT NULL,
    recording_url TEXT NOT NULL,
    pii_url TEXT NOT NULL,
    transcript_sid TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

db.run(`
  CREATE TABLE IF NOT EXISTS transcripts (
    call_id TEXT NOT NULL,
    speaker TEXT NOT NULL,
    text TEXT NOT NULL,
    FOREIGN KEY(call_id) REFERENCES calls(id) ON DELETE CASCADE
  );
`);

interface CallRow {
  id: string;
  from_number: string;
  to_number: string;
  duration: string;
  recording_url: string;
  pii_url: string;
  created_at: string;
  transcript_json: string;
}

export function saveCalls(call: CallRecord, transcriptSid: string) {
  const insertCall = db.prepare(`
    INSERT INTO calls (
      id, from_number, to_number, duration,
      recording_url, pii_url, transcript_sid, created_at
    )
    VALUES (
      $id, $from_number, $to_number, $duration,
      $recordingUrl, $piiUrl, $transcriptSid, CURRENT_TIMESTAMP
    )
  `);

  const insertTranscript = db.prepare(`
    INSERT INTO transcripts (call_id, speaker, text)
    VALUES ($callId, $speaker, $text)
  `);

  db.transaction(() => {
    insertCall.run({
      $id: call.id,
      $from_number: call.from_number,
      $to_number: call.to_number,
      $duration: call.duration,
      $recordingUrl: call.recordingUrl,
      $piiUrl: call.piiUrl,
      $transcriptSid: transcriptSid
    });

    call.transcript.forEach(t => {
      insertTranscript.run({
        $callId: call.id,
        $speaker: t.speaker,
        $text: t.text
      });
    });
  })();
}

export function getCalls(): CallRecord[] {
  const calls = db.prepare(`
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
  `).all() as CallRow[];

  return calls.map(call => ({
    id: call.id,
    from: call.from_number,
    to: call.to_number,
    from_number: call.from_number,
    to_number: call.to_number,
    duration: call.duration,
    recordingUrl: call.recording_url,
    piiUrl: call.pii_url,
    createdAt: call.created_at,
    transcript: JSON.parse(`[${call.transcript_json}]`)
  }));
}

export async function deleteCall(id: string) {
  try {
    // Use a transaction to ensure both tables are updated atomically
    db.transaction(() => {
      // Delete transcripts first (due to foreign key constraint)
      const deleteTranscripts = db.prepare('DELETE FROM transcripts WHERE call_id = ?');
      deleteTranscripts.run(id);

      // Then delete the call
      const deleteCalls = db.prepare('DELETE FROM calls WHERE id = ?');
      const result = deleteCalls.run(id);

      if (result.changes === 0) {
        throw new Error('Call not found');
      }
    })();

    return true;
  } catch (error) {
    console.error('Error deleting from database:', error);
    return false;
  }
}
