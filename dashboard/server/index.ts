import { serve } from "bun";
import type { ServerWebSocket } from "bun";
import type {
  TwilioMedia,
  TranscriptSentence,
  CallRecord,
  WebSocketClient
} from "./types";
import { saveCalls, getCalls, deleteCall } from "./db";
// https://runtime-api.voiceflow.com/v1/twilio/webhooks/6762e9e1a01ce51cb9b4fb3a/answer?authorization=VF.DM.6798cc7bb236da859df152f0.BrZL0yPLYda7nCJl

const TWILIO_ACCOUNT_SID = Bun.env.TWILIO_ACCOUNT_SID;
const TWILIO_AUTH_TOKEN = Bun.env.TWILIO_AUTH_TOKEN;

if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN) {
  console.error("Missing Twilio credentials");
  process.exit(1);
}

async function pollCallStatus(callSid: string) {
  let attempts = 0;
  const maxAttempts = 30; // 30 seconds max
  let isRecordingStarted = false; // Add flag to track recording state

  const interval = setInterval(async () => {
    try {
      const response = await fetch(
        `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Calls/${callSid}.json`,
        {
          headers: {
            'Authorization': `Basic ${btoa(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`)}`
          }
        }
      );

      const data = await response.json();
      console.log('📱 Call:', {
        status: data.status,
        callSid: callSid.slice(-8) // Show last 8 chars instead of 4
      });

      // Start recording when call is in progress and not already recording
      if (data.status === 'in-progress' && !isRecordingStarted) {
        isRecordingStarted = true;
        await startRecording(callSid);
        clearInterval(interval);
      }

      // Stop polling if call is completed or failed
      if (data.status === 'completed' || data.status === 'failed' || ++attempts >= maxAttempts) {
        clearInterval(interval);
      }
    } catch (error) {
      console.error('Error polling call status:', error);
      clearInterval(interval);
    }
  }, 1000);
}

async function startRecording(callSid: string) {
  try {
    const recordingResponse = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Calls/${callSid}/Recordings.json`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Basic ${btoa(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`)}`,
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: new URLSearchParams({
          'RecordingStatusCallback': `${process.env.PUBLIC_URL}/recording-status`,
          'RecordingChannels': 'dual',
          'RecordingTrack': 'both',
          'Trim': 'trim-silence'
        }).toString()
      }
    );

    const data = await recordingResponse.json();
    console.log('🎥 Recording started:', {
      callSid: data.call_sid.slice(-4),
      recordingSid: data.sid.slice(-4)
    });
  } catch (error) {
    console.error('Error starting recording:', error);
  }
}

async function pollTranscriptStatus(
  transcriptSid: string,
  maxAttempts = 10
): Promise<{ media: TwilioMedia; sentences: TranscriptSentence[] }> {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const response = await fetch(`https://intelligence.twilio.com/v2/Transcripts/${transcriptSid}`, {
      headers: {
        'Authorization': `Basic ${btoa(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`)}`
      }
    });

    const transcript = await response.json();
    console.log('🎯 Transcript status:', {
      transcriptSid: transcript.sid.slice(-8),
      status: transcript.status
    });

    if (transcript.status === 'completed') {
      // Get PII media URL
      const mediaResponse = await fetch(transcript.links.media, {
        headers: {
          'Authorization': `Basic ${btoa(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`)}`
        }
      });

      const media = await mediaResponse.json();
      if (media.media_url) {
        console.log('🔒 PII media available:', {
          transcriptSid: transcript.sid.slice(-8),
          mediaUrl: media.media_url
        });

        // Get conversation transcript
        const sentencesResponse = await fetch(transcript.links.sentences, {
          headers: {
            'Authorization': `Basic ${btoa(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`)}`
          }
        });

        const { sentences } = await sentencesResponse.json();
        console.log('📝 Conversation:');

        return { media, sentences };
      }
    }

    // Wait 2 seconds before next attempt
    await new Promise(resolve => setTimeout(resolve, 2000));
  }
  throw new Error('Transcript processing timed out');
}

// Add before the server definition
const wsClients = new Set<WebSocketClient>();

// Add this to store call details
const callDetails = new Map<string, { from: string; to: string }>();

const PORT = parseInt(Bun.env.BUN_PORT || "3902");

const server = serve({
  port: PORT,
  hostname: "0.0.0.0",
  async fetch(req: Request) {
    const url = new URL(req.url);

    if (url.pathname.startsWith("/v1/twilio/webhooks/")) {
      try {
        const params = url.searchParams;
        const callSid = params.get('CallSid');
        const from = params.get('From');
        const to = params.get('To');

        // Store call details for later use
        if (callSid && from && to) {
          callDetails.set(callSid, { from, to });
        }

        // Log initial call details
        console.log('📞 New call:', {
          from: params.get('From'),
          to: params.get('To'),
          callSid: callSid?.slice(-4) // Show only last 4 chars
        });

        // Start polling for call status if it's an inbound call
        if (callSid && params.get('Direction') === 'inbound') {
          pollCallStatus(callSid);
        }

        // Forward to Voiceflow (keeping all original query parameters)
        const voiceflowUrl = new URL('https://runtime-api.voiceflow.com' + url.pathname + url.search);

        const response = await fetch(voiceflowUrl.toString(), {
          method: 'GET',
          headers: { 'Accept': 'application/xml' }
        });

        const twiml = await response.text();
        // console.log('TwiML Response:', twiml);

        return new Response(twiml, {
          headers: { 'Content-Type': 'application/xml' }
        });
      } catch (error) {
        console.error('Error:', error);
        return new Response('Error', { status: 500 });
      }
    }

    if (url.pathname === "/recording-status") {
      console.log('📞 Received recording status webhook:', {
        url: req.url,
        method: req.method,
        headers: Object.fromEntries(req.headers.entries())
      });

      try {
        const formData = await req.formData();
        console.log('📝 Recording status data:', Object.fromEntries(formData.entries()));
        const recordingSid = formData.get('RecordingSid');

        console.log('💾 Recording completed:', {
          callSid: formData.get('CallSid')?.slice(-8),
          recordingSid: recordingSid?.slice(-8),
          duration: formData.get('RecordingDuration')
        });

        // Start Voice Intelligence processing
        let media: TwilioMedia;
        let sentences: TranscriptSentence[];

        try {
          // Create transcript with PII redaction
          const transcriptResponse = await fetch('https://intelligence.twilio.com/v2/Transcripts', {
            method: 'POST',
            headers: {
              'Authorization': `Basic ${btoa(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`)}`,
              'Content-Type': 'application/x-www-form-urlencoded'
            },
            body: new URLSearchParams({
              'ServiceSid': 'GA373495a1cb7c727038e7261fedfbbe0e',
              'Channel': JSON.stringify({
                media_properties: {
                  source_sid: recordingSid
                }
              })
            }).toString()
          });

          const transcript = await transcriptResponse.json();
          console.log('🎯 Transcript created:', {
            transcriptSid: transcript.sid.slice(-8),
            status: transcript.status
          });

          // Poll for transcript completion and media URL
          ({ media, sentences } = await pollTranscriptStatus(transcript.sid));

          // Now we can use media and sentences
          const callSid = formData.get('CallSid') as string;
          const storedDetails = callDetails.get(callSid);

          const newCall: CallRecord = {
            id: transcript.sid,
            from: storedDetails?.from || '',
            to: storedDetails?.to || '',
            from_number: storedDetails?.from || '',
            to_number: storedDetails?.to || '',
            duration: formData.get('RecordingDuration') as string,
            recordingUrl: formData.get('RecordingUrl') as string,
            piiUrl: media.media_url,
            createdAt: new Date().toISOString(),
            transcript: sentences.map(s => ({
              speaker: s.media_channel === 1 ? 'customer' as const : 'assistant' as const,
              text: s.transcript
            }))
          };

          console.log('Saving call with data:', newCall);

          // Save to database
          try {
            console.log('About to save call with phone numbers:', {
              from: storedDetails?.from,
              to: storedDetails?.to
            });
            await saveCalls({
              ...newCall,
              from_number: storedDetails?.from || '',
              to_number: storedDetails?.to || ''
            }, transcript.sid);

            // Broadcast to all connected WebSocket clients after successful save
            wsClients.forEach(client => {
              client.socket.send(JSON.stringify({
                type: 'new_call',
                call: newCall
              }));
            });
          } catch (error) {
            console.error('Error saving call:', error);
          }
        } catch (error) {
          console.error('Error processing Voice Intelligence:', error);
        }

        return new Response('OK');
      } catch (error) {
        console.error('Error in recording status:', error);
        return new Response('Error', { status: 500 });
      }
    }

    if (url.pathname === "/health") {
      return new Response('Server is running', { status: 200 });
    }

    if (url.pathname === "/calls") {
      const searchParams = url.searchParams;
      const page = parseInt(searchParams.get('page') || '1');
      const limit = parseInt(searchParams.get('limit') || '10');
      const search = searchParams.get('search') || '';

      // Get fresh data from database
      let filteredCalls = getCalls();

      // Apply search filter
      if (search) {
        filteredCalls = filteredCalls.filter(call =>
          call.from_number.includes(search) ||
          call.to_number.includes(search) ||
          call.transcript.some(t => t.text.toLowerCase().includes(search.toLowerCase()))
        );
      }

      // Apply pagination
      const start = (page - 1) * limit;
      const paginatedCalls = filteredCalls.slice(start, start + limit);
      const total = filteredCalls.length;

      return new Response(JSON.stringify({
        calls: paginatedCalls,
        pagination: {
          total,
          pages: Math.ceil(total / limit),
          currentPage: page,
          limit
        }
      }), {
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        }
      });
    }

    // Add delete endpoint
    if (url.pathname.startsWith("/calls/") && req.method === "DELETE") {
      const id = url.pathname.split("/calls/")[1]?.split("?")[0]?.split("/")[0];
      if (!id) {
        return new Response("Missing call ID", { status: 400 });
      }

      const success = await deleteCall(id);
      return new Response(null, {
        status: success ? 200 : 404,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        }
      });
    }

    // Add new WebSocket endpoint
    if (url.pathname === "/ws") {
      const success = server.upgrade(req);
      if (success) {
        // Upgraded successfully
        return undefined;
      }
      return new Response("WebSocket upgrade failed", { status: 400 });
    }

    return new Response("Not Found", { status: 404 });
  },
  websocket: {
    open(ws: ServerWebSocket<unknown>) {
      wsClients.add({ socket: ws, timestamp: Date.now() });
    },
    message(ws: ServerWebSocket<unknown>, message: string) {
      // Handle incoming messages if needed
    },
    close(ws: ServerWebSocket<unknown>) {
      wsClients.forEach(client => {
        if (client.socket === ws) {
          wsClients.delete(client);
        }
      });
    },
  },
});

console.log(`Listening on http://0.0.0.0:${PORT}`);
