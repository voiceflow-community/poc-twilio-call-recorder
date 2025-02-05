import { serve } from "bun";
import type { ServerWebSocket } from "bun";
import type {
  TwilioMedia,
  TranscriptSentence,
  CallRecord,
  WebSocketClient
} from "./types";
import { saveCalls, getCalls, deleteCall } from "./db";

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
    try {
      const response = await fetch(`https://intelligence.twilio.com/v2/Transcripts/${transcriptSid}`, {
        headers: {
          'Authorization': `Basic ${btoa(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`)}`
        }
      });

      if (!response.ok) {
        console.error('Transcript API error:', {
          status: response.status,
          statusText: response.statusText
        });
        const errorText = await response.text();
        console.error('Error response:', errorText);
        throw new Error(`Transcript API returned ${response.status}`);
      }

      const transcript = await response.json();
      console.log('Raw transcript response:', transcript);

      if (!transcript || !transcript.sid) {
        console.error('Invalid transcript response:', transcript);
        throw new Error('Invalid transcript response format');
      }

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

        if (!mediaResponse.ok) {
          console.error('Media API error:', {
            status: mediaResponse.status,
            statusText: mediaResponse.statusText
          });
          const errorText = await mediaResponse.text();
          console.error('Error response:', errorText);
          throw new Error(`Media API returned ${mediaResponse.status}`);
        }

        const media = await mediaResponse.json();
        if (!media || !media.media_url) {
          console.error('Invalid media response:', media);
          throw new Error('Invalid media response format');
        }

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

        if (!sentencesResponse.ok) {
          console.error('Sentences API error:', {
            status: sentencesResponse.status,
            statusText: sentencesResponse.statusText
          });
          const errorText = await sentencesResponse.text();
          console.error('Error response:', errorText);
          throw new Error(`Sentences API returned ${sentencesResponse.status}`);
        }

        const { sentences } = await sentencesResponse.json();
        if (!sentences) {
          console.error('Invalid sentences response');
          throw new Error('Invalid sentences response format');
        }

        console.log('📝 Conversation:', sentences);

        return { media, sentences };
      }

      // Wait 2 seconds before next attempt
      await new Promise(resolve => setTimeout(resolve, 2000));
    } catch (error) {
      console.error('Error in pollTranscriptStatus:', error);
      if (attempt === maxAttempts - 1) {
        throw error;
      }
    }
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

    // Handle CORS preflight requests
    if (req.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
          'Access-Control-Allow-Headers': '*'
        }
      });
    }

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

        // Start polling for call status if it's an outbound call
        if (callSid && params.get('Direction') === 'outbound-api') {
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
        const formDataObj = Object.fromEntries(formData.entries());
        console.log('📝 Recording status data:', formDataObj);
        const recordingSid = formData.get('RecordingSid');

        if (!recordingSid) {
          console.error('Missing RecordingSid in webhook data');
          return new Response('Missing RecordingSid', { status: 400 });
        }

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

          if (!transcriptResponse.ok) {
            console.error('Failed to create transcript:', {
              status: transcriptResponse.status,
              statusText: transcriptResponse.statusText
            });
            const errorText = await transcriptResponse.text();
            console.error('Error response:', errorText);
            throw new Error(`Failed to create transcript: ${transcriptResponse.status}`);
          }

          const transcript = await transcriptResponse.json();
          if (!transcript || !transcript.sid) {
            console.error('Invalid transcript creation response:', transcript);
            throw new Error('Invalid transcript creation response');
          }

          console.log('🎯 Transcript created:', {
            transcriptSid: transcript.sid.slice(-8),
            status: transcript.status
          });

          // Poll for transcript completion and media URL
          ({ media, sentences } = await pollTranscriptStatus(transcript.sid));

          // Now we can use media and sentences
          const callSid = formData.get('CallSid') as string;
          const storedDetails = callDetails.get(callSid);

          if (!storedDetails) {
            console.error('No stored details found for call:', callSid);
          }

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
            console.log('Broadcasting new call to WebSocket clients. Connected clients:', wsClients.size);
            wsClients.forEach(client => {
              try {
                const message = JSON.stringify({
                  type: 'new_call',
                  call: newCall
                });
                console.log('Sending WebSocket message:', message);
                client.socket.send(message);
                console.log('WebSocket message sent successfully');
              } catch (error) {
                console.error('Error sending WebSocket message:', error);
                // Remove failed client
                wsClients.delete(client);
              }
            });
          } catch (error) {
            console.error('Error saving call:', error);
            throw error;
          }
        } catch (error) {
          console.error('Error processing Voice Intelligence:', error);
          throw error;
        }

        return new Response('OK');
      } catch (error) {
        console.error('Error in recording status:', error);
        return new Response(error instanceof Error ? error.message : 'Internal Server Error', {
          status: 500,
          headers: {
            'Content-Type': 'text/plain'
          }
        });
      }
    }

    if (url.pathname === "/health") {
      return new Response('Server is running', {
        status: 200,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
          'Access-Control-Allow-Headers': '*'
        }
      });
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
      console.log('Received WebSocket upgrade request:', {
        url: req.url,
        headers: Object.fromEntries(req.headers.entries())
      });

      // Add CORS headers for WebSocket upgrade
      if (req.method === 'OPTIONS') {
        return new Response(null, {
          status: 204,
          headers: {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
            'Access-Control-Allow-Headers': '*',
            'Access-Control-Allow-Private-Network': 'true'
          }
        });
      }

      // Check for WebSocket upgrade header
      const upgradeHeader = req.headers.get('upgrade')?.toLowerCase();
      if (!upgradeHeader || upgradeHeader !== 'websocket') {
        return new Response('Expected Upgrade: WebSocket', {
          status: 426,
          headers: {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
            'Access-Control-Allow-Headers': '*',
            'Access-Control-Allow-Private-Network': 'true'
          }
        });
      }

      const success = server.upgrade(req, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
          'Access-Control-Allow-Headers': '*',
          'Access-Control-Allow-Private-Network': 'true'
        }
      });
      console.log('WebSocket upgrade result:', success);

      if (success) {
        // Upgraded successfully
        return undefined;
      }
      return new Response("WebSocket upgrade failed", {
        status: 400,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
          'Access-Control-Allow-Headers': '*',
          'Access-Control-Allow-Private-Network': 'true'
        }
      });
    }

    return new Response("Not Found", { status: 404 });
  },
  websocket: {
    open(ws: ServerWebSocket<unknown>) {
      console.log('New WebSocket client connected', {
        remoteAddress: ws.remoteAddress,
        readyState: ws.readyState,
        data: ws.data
      });
      wsClients.add({ socket: ws, timestamp: Date.now() });
      console.log('Total connected clients:', wsClients.size);
    },
    message(ws: ServerWebSocket<unknown>, message: string) {
      // Log the message and send an acknowledgment
      console.log('Received WebSocket message:', {
        message,
        remoteAddress: ws.remoteAddress,
        readyState: ws.readyState
      });
      ws.send(JSON.stringify({ type: 'ack', message: 'Message received' }));
    },
    close(ws: ServerWebSocket<unknown>) {
      console.log('WebSocket client disconnected', {
        remoteAddress: ws.remoteAddress,
        readyState: ws.readyState
      });
      wsClients.forEach(client => {
        if (client.socket === ws) {
          wsClients.delete(client);
        }
      });
      console.log('Total connected clients:', wsClients.size);
    },
  },
});

console.log(`Listening on http://0.0.0.0:${PORT}`);
