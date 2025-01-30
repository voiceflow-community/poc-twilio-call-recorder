import { NextRequest } from 'next/server';

const BUN_SERVER = process.env.BUN_SERVER || 'http://localhost:3902';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const bunServerUrl = new URL('/ws', BUN_SERVER);
  bunServerUrl.protocol = bunServerUrl.protocol.replace('http', 'ws');

  if (!req.headers.get('upgrade')?.toLowerCase().includes('websocket')) {
    return new Response('Expected WebSocket upgrade', { status: 426 });
  }

  try {
    const res = await fetch(bunServerUrl.toString(), {
      method: 'GET',
      headers: {
        'Upgrade': 'websocket',
        'Connection': 'Upgrade',
        ...Object.fromEntries(req.headers)
      }
    });

    if (res.status !== 101) {
      return new Response('Failed to upgrade to WebSocket', { status: 500 });
    }

    return res;
  } catch (error) {
    console.error('WebSocket proxy error:', error);
    return new Response('WebSocket proxy error', { status: 500 });
  }
}
