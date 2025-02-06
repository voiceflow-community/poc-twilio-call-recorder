import express from 'express';
import { WebSocket, WebSocketServer } from 'ws';
import { createServer as createHttpServer } from 'http';
import dotenv from 'dotenv';
import type { NextApiRequest, NextApiResponse } from 'next';
import type {
  TwilioMedia,
  TranscriptSentence,
  CallRecord,
} from "./types.js";
import { saveCalls, getCalls, deleteCall, initialize as initializeDb } from "./db.js";
import cors from 'cors';

// Load environment variables
dotenv.config();

const dev = process.env.NODE_ENV !== 'production';

// Initialize the application
async function initializeApp() {
  // Initialize database
  await initializeDb();

  const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID;
  const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN;
  const TWILIO_SERVICE_SID = process.env.TWILIO_SERVICE_SID;

  if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN || !TWILIO_SERVICE_SID) {
    console.error("Missing Twilio credentials");
    process.exit(1);
  }

  async function pollCallStatus(callSid: string, piiRedaction?: string) {
    let attempts = 0;
    const maxAttempts = 30; // 30 seconds max
    let isRecordingStarted = false;
    let hasLoggedInProgress = false;

    const interval = setInterval(async () => {
      try {
        const response = await fetch(
          `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Calls/${callSid}.json`,
          {
            headers: {
              'Authorization': `Basic ${Buffer.from(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`).toString('base64')}`
            }
          }
        );

        const data = await response.json();

        // Only log status changes
        if (data.status === 'in-progress' && !hasLoggedInProgress) {
          console.log('📱 Call in progress:', {
            callSid: callSid.slice(-8),
            piiRedaction: piiRedaction === 'true' ? 'enabled' : 'disabled'
          });
          hasLoggedInProgress = true;
        } else if (data.status === 'completed' || data.status === 'failed') {
          console.log('📱 Call ended:', {
            status: data.status,
            callSid: callSid.slice(-8)
          });
        }

        // Start recording when call is in progress and not already recording
        if (data.status === 'in-progress' && !isRecordingStarted) {
          isRecordingStarted = true;
          await startRecording(callSid, piiRedaction);
        }

        // Stop polling only if call is completed or failed
        if (data.status === 'completed' || data.status === 'failed') {
          clearInterval(interval);
        } else if (++attempts >= maxAttempts) {
          console.log('Max polling attempts reached for call:', callSid.slice(-8));
          clearInterval(interval);
        }
      } catch (error) {
        console.error('Error polling call status:', error);
        clearInterval(interval);
      }
    }, 1000);
  }

  async function startRecording(callSid: string, piiRedaction?: string) {
    const maxRetries = 3;
    const baseDelay = 1000;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        const callbackUrl = `${process.env.PUBLIC_URL}/recording-status?${piiRedaction ? `&piiRedaction=${piiRedaction}` : ''}`;

        const recordingResponse = await fetch(
          `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Calls/${callSid}/Recordings.json`,
          {
            method: 'POST',
            headers: {
              'Authorization': `Basic ${Buffer.from(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`).toString('base64')}`,
              'Content-Type': 'application/x-www-form-urlencoded'
            },
            body: new URLSearchParams({
              'RecordingStatusCallback': callbackUrl,
              'RecordingStatusCallbackMethod': 'POST',
              'RecordingChannels': 'dual',
              'RecordingTrack': 'both',
              'Trim': 'trim-silence'
            }).toString()
          }
        );

        if (!recordingResponse.ok) {
          if (attempt === maxRetries - 1) {
            console.error('Failed to start recording:', recordingResponse.status);
          }
          const delay = baseDelay * Math.pow(2, attempt);
          await new Promise(resolve => setTimeout(resolve, delay));
          continue;
        }

        const data = await recordingResponse.json();
        if (!data?.sid) {
          console.error('Invalid recording response');
          continue;
        }

        console.log('🎥 Recording started:', {
          callSid: callSid.slice(-8),
          recordingSid: data.sid.slice(-8),
          piiRedaction: piiRedaction === 'true' ? 'enabled' : 'disabled'
        });
        return;
      } catch (error) {
        if (attempt === maxRetries - 1) {
          console.error('Failed to start recording after retries');
        }
      }
    }
  }

  async function pollTranscriptStatus(
    transcriptSid: string,
    maxAttempts = 10
  ): Promise<{ media: TwilioMedia; sentences: TranscriptSentence[] }> {
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        const response = await fetch(`https://intelligence.twilio.com/v2/Transcripts/${transcriptSid}`, {
          headers: {
            'Authorization': `Basic ${Buffer.from(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`).toString('base64')}`
          }
        });

        if (!response.ok) {
          throw new Error(`Transcript API returned ${response.status}`);
        }

        const transcript = await response.json();
        if (!transcript?.sid) {
          throw new Error('Invalid transcript response format');
        }

        if (transcript.status === 'completed') {
          // Get PII media URL
          const mediaResponse = await fetch(transcript.links.media, {
            headers: {
              'Authorization': `Basic ${Buffer.from(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`).toString('base64')}`
            }
          });

          if (!mediaResponse.ok) {
            throw new Error(`Media API returned ${mediaResponse.status}`);
          }

          const media = await mediaResponse.json();
          if (!media?.media_url) {
            throw new Error('Invalid media response format');
          }

          // Get conversation transcript
          const sentencesResponse = await fetch(transcript.links.sentences, {
            headers: {
              'Authorization': `Basic ${Buffer.from(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`).toString('base64')}`
            }
          });

          if (!sentencesResponse.ok) {
            throw new Error(`Sentences API returned ${sentencesResponse.status}`);
          }

          const { sentences } = await sentencesResponse.json();
          if (!sentences) {
            throw new Error('Invalid sentences response format');
          }

          console.log('✅ Transcript ready:', {
            transcriptSid: transcriptSid.slice(-8),
            sentences: sentences.length
          });

          return { media, sentences };
        }

        // Wait before next attempt
        await new Promise(resolve => setTimeout(resolve, 2000));
      } catch (error) {
        if (attempt === maxAttempts - 1) {
          throw error;
        }
      }
    }
    throw new Error('Transcript processing timed out');
  }

  // Store WebSocket clients and call details
  const wsClients = new Set<WebSocket>();
  const callDetails = new Map<string, { from: string; to: string }>();
  const deletedCalls = new Set<string>(); // Track deleted calls

  // Create Express app
  const app = express();

  // Enable CORS and JSON parsing
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));
  app.use(cors());

  // Create HTTP server
  const PORT = parseInt(process.env.PORT || "3902");
  const server = createHttpServer(app);

  // Handle server errors
  server.on('error', (error: NodeJS.ErrnoException) => {
    if (error.code === 'EADDRINUSE') {
      console.error(`Port ${PORT} is already in use. Please check if another instance is running.`);
      process.exit(1);
    } else {
      console.error('Server error:', error);
      process.exit(1);
    }
  });

  // Initialize WebSocket server
  const wss = new WebSocketServer({
    server,
    path: '/ws'
  });

  // Handle WebSocket server errors
  wss.on('error', (error) => {
    console.error('WebSocket server error:', error);
  });

  wss.on('connection', (ws: WebSocket, req: { socket: { remoteAddress: string } }) => {
    console.log('WebSocket client connected from:', req.socket.remoteAddress);
    wsClients.add(ws);

    ws.on('error', (error) => {
      console.error('WebSocket client error:', error);
    });

    ws.on('close', () => {
      wsClients.delete(ws);
      console.log('WebSocket client disconnected');
    });

    ws.on('message', (message: Buffer) => {
      try {
        console.log('Received:', message.toString());
        // Handle message
      } catch (error) {
        console.error('Error handling message:', error);
      }
    });

    // Send initial connection success message
    try {
      ws.send(JSON.stringify({ type: 'connection_established' }));
    } catch (error) {
      console.error('Error sending initial message:', error);
    }
  });

  // API endpoints
  app.get('/health', (_req: express.Request, res: express.Response) => {
    res.json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      uptime: process.uptime()
    });
  });

  app.get('/api/calls', async (_req: express.Request, res: express.Response) => {
    try {
      const page = parseInt(_req.query.page as string) || 1;
      const limit = parseInt(_req.query.limit as string) || 10;
      const calls = await getCalls();

      // Simple pagination
      const startIndex = (page - 1) * limit;
      const endIndex = page * limit;
      const paginatedCalls = calls.slice(startIndex, endIndex);

      res.json({
        data: paginatedCalls,
        pagination: {
          total: calls.length,
          totalPages: Math.ceil(calls.length / limit),
          page,
          limit
        }
      });
    } catch (error) {
      console.error('Error getting calls:', error);
      res.status(500).json({ error: 'Failed to fetch calls' });
    }
  });

  app.delete('/api/calls/:id', async (req: express.Request, res: express.Response) => {
    try {
      const { id } = req.params;
      console.log('🗑️ Received delete request for call:', id);

      // Check if call was already deleted
      if (deletedCalls.has(id)) {
        console.log('🚫 Call was already deleted:', id);
        return res.sendStatus(204);
      }

      // Delete from database
      await deleteCall(id);
      console.log('✅ Successfully deleted call:', id);

      // Add to deleted set
      deletedCalls.add(id);

      // Notify WebSocket clients about deletion
      const message = JSON.stringify({ type: 'delete_call', id });
      console.log('📢 Broadcasting deletion to WebSocket clients:', {
        connectedClients: wsClients.size,
        messageType: 'delete_call',
        id
      });

      let notifiedClients = 0;
      wsClients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
          client.send(message);
          notifiedClients++;
        }
      });
      console.log(`✅ Notified ${notifiedClients} WebSocket clients about deletion`);

      res.sendStatus(204);
    } catch (error) {
      console.error('❌ Error deleting call:', error);
      res.status(500).json({ error: 'Failed to delete call' });
    }
  });

  // Original recording status endpoint
  app.all('/recording-status', async (req: express.Request, res: express.Response) => {
    try {
      const params = req.method === 'GET' ? req.query : req.body;
      const { CallSid, RecordingSid, RecordingUrl, RecordingStatus, RecordingDuration } = params;
      const piiRedaction = req.query.piiRedaction === 'true';

      console.log('🎙️ Recording update:', {
        callSid: CallSid?.slice(-8),
        status: RecordingStatus,
        duration: RecordingDuration,
        piiRedaction: piiRedaction ? 'enabled' : 'disabled'
      });

      if (RecordingStatus === 'completed') {
        const details = callDetails.get(CallSid);
        if (!details) {
          throw new Error(`No call details found for ${CallSid}`);
        }

        let transcriptSid = '';
        let mediaUrl = RecordingUrl;
        let sentences: TranscriptSentence[] = [];

        if (piiRedaction) {
          console.log('🎯 Processing PII redaction for:', CallSid.slice(-8));

          const transcriptResponse = await fetch(
            `https://intelligence.twilio.com/v2/Transcripts`,
            {
              method: 'POST',
              headers: {
                'Authorization': `Basic ${Buffer.from(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`).toString('base64')}`,
                'Content-Type': 'application/x-www-form-urlencoded'
              },
              body: new URLSearchParams({
                'ServiceSid': TWILIO_SERVICE_SID,
                'Channel': JSON.stringify({
                  media_properties: {
                    source_sid: RecordingSid
                  }
                })
              }).toString()
            }
          );

          if (!transcriptResponse.ok) {
            throw new Error('Failed to create transcript');
          }

          const transcript = await transcriptResponse.json();
          const { media, sentences: transcriptSentences } = await pollTranscriptStatus(transcript.sid);

          transcriptSid = transcript.sid;
          mediaUrl = media.media_url;
          sentences = transcriptSentences;
        }

        const call: CallRecord = {
          id: CallSid,
          from: details.from,
          to: details.to,
          from_number: details.from,
          to_number: details.to,
          duration: RecordingDuration || '0',
          recordingUrl: mediaUrl,
          piiUrl: piiRedaction ? mediaUrl : '',
          recordingType: piiRedaction ? 'redacted' : 'regular',
          transcript_sid: transcriptSid,
          createdAt: new Date().toISOString(),
          transcript: piiRedaction ? sentences.map(s => ({
            speaker: s.media_channel === 1 ? 'customer' : 'assistant',
            text: s.transcript || ''
          })) : []
        };

        await saveCalls(call, transcriptSid);
        console.log('✅ Call saved:', CallSid.slice(-8));

        // Notify WebSocket clients
        const message = JSON.stringify({ type: 'new_call', call });
        let notifiedClients = 0;
        wsClients.forEach(client => {
          if (client.readyState === WebSocket.OPEN) {
            client.send(message);
            notifiedClients++;
          }
        });
        console.log(`✅ Notified ${notifiedClients} clients`);
      }

      res.sendStatus(200);
    } catch (error) {
      console.error('❌ Error handling recording status:', error);
      res.status(500).send('Internal Server Error');
    }
  });

  // Twilio webhook endpoints - handle both GET and POST
  app.all('/v1/twilio/webhooks/:projectId/answer', async (req: express.Request, res: express.Response) => {
    try {
      const { projectId } = req.params;
      const { piiRedaction } = req.query;

      // For GET requests, parameters are in query string, for POST they're in body
      const params = req.method === 'GET' ? req.query : req.body;
      const { CallSid, From, To, Direction } = params;

      // Log initial call details
      console.log('📞 New call:', {
        projectId,
        from: From,
        to: To,
        direction: Direction,
        callSid: CallSid?.slice(-4),
        piiRedaction: piiRedaction === 'true',
        method: req.method
      });

      // Store call details for later use
      if (CallSid && From && To) {
        callDetails.set(CallSid, { from: From, to: To });
      }

      // Start polling for call status if it's an inbound call
      if (CallSid && Direction === 'inbound') {
        await pollCallStatus(CallSid, piiRedaction === 'true' ? 'true' : undefined);
      }

      // Forward to Voiceflow
      const voiceflowUrl = new URL(`https://runtime-api.voiceflow.com/v1/twilio/webhooks/${projectId}/answer${req.url.includes('?') ? req.url.substring(req.url.indexOf('?')) : ''}`);

      const voiceflowResponse = await fetch(voiceflowUrl.toString(), {
        method: req.method,
        headers: {
          'Accept': 'application/xml',
          ...req.headers as any // Forward original headers
        }
      });

      const twiml = await voiceflowResponse.text();
      return res.type('application/xml').send(twiml);

    } catch (error) {
      console.error('Error handling voice webhook:', error);
      res.status(500).send('Internal Server Error');
    }
  });

  // Graceful shutdown
  process.on('SIGTERM', () => {
    console.log('SIGTERM received. Closing server...');
    server.close(() => {
      console.log('Server closed');
      process.exit(0);
    });
  });

  server.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
  });
}

// Start the application
initializeApp().catch((err: Error) => {
  console.error('Error starting server:', err);
  process.exit(1);
});
