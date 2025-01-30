import { NextRequest } from 'next/server';

const BUN_SERVER = process.env.BUN_SERVER || 'http://localhost:3902';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const bunServerUrl = new URL('/ws', BUN_SERVER);
  bunServerUrl.protocol = bunServerUrl.protocol.replace('http', 'ws');

  console.log('WebSocket proxy: Forwarding to', bunServerUrl.toString());
  console.log('WebSocket proxy: Headers:', Object.fromEntries(req.headers));

  if (!req.headers.get('upgrade')?.toLowerCase().includes('websocket')) {
    console.log('WebSocket proxy: Missing upgrade header');
    return new Response('Expected WebSocket upgrade', { status: 426 });
  }

  try {
    const wsKey = req.headers.get('sec-websocket-key');
    const wsVersion = req.headers.get('sec-websocket-version');

    if (!wsKey || !wsVersion) {
      console.log('WebSocket proxy: Missing required headers');
      return new Response('Missing required WebSocket headers', { status: 400 });
    }

    const response = await fetch(bunServerUrl.toString(), {
      method: 'GET',
      headers: {
        'Upgrade': 'websocket',
        'Connection': 'Upgrade',
        'Sec-WebSocket-Key': wsKey,
        'Sec-WebSocket-Version': wsVersion,
        'Sec-WebSocket-Protocol': req.headers.get('sec-websocket-protocol') || ''
      }
    });

    console.log('WebSocket proxy: Response status:', response.status);
    console.log('WebSocket proxy: Response headers:', Object.fromEntries(response.headers));

    if (response.status !== 101) {
      console.log('WebSocket proxy: Failed to upgrade connection');
      return new Response('Failed to upgrade to WebSocket', { status: 500 });
    }

    const wsAccept = response.headers.get('sec-websocket-accept');
    if (!wsAccept) {
      console.log('WebSocket proxy: Missing Sec-WebSocket-Accept header');
      return new Response('Invalid WebSocket response', { status: 502 });
    }

    return new Response(null, {
      status: 101,
      headers: {
        'Upgrade': 'websocket',
        'Connection': 'Upgrade',
        'Sec-WebSocket-Accept': wsAccept,
        'Sec-WebSocket-Protocol': response.headers.get('sec-websocket-protocol') || ''
      }
    });
  } catch (error) {
    console.error('WebSocket proxy error:', error);
    return new Response('WebSocket proxy error', { status: 500 });
  }
}
