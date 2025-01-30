import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

export function middleware(request: NextRequest) {
  if (request.nextUrl.pathname.startsWith('/api/ws')) {
    const bunServer = process.env.NEXT_PUBLIC_BUN_SERVER || 'http://bun-server:3902'
    const bunServerUrl = new URL(bunServer)
    const wsUrl = bunServerUrl.toString().replace('http:', 'ws:').replace('https:', 'wss:')

    console.log('Proxying WebSocket request to:', wsUrl)

    // For WebSocket upgrade requests
    if (request.headers.get('upgrade')?.toLowerCase() === 'websocket') {
      const url = new URL('/ws', wsUrl)
      console.log('Upgrading WebSocket connection to:', url.toString())

      return NextResponse.rewrite(url, {
        headers: {
          'Upgrade': 'websocket',
          'Connection': 'Upgrade',
          'Sec-WebSocket-Key': request.headers.get('sec-websocket-key') || '',
          'Sec-WebSocket-Version': request.headers.get('sec-websocket-version') || '',
          'Sec-WebSocket-Protocol': request.headers.get('sec-websocket-protocol') || ''
        }
      })
    }

    // For regular HTTP requests (like CORS preflight)
    return NextResponse.rewrite(new URL('/ws', wsUrl))
  }
}

export const config = {
  matcher: '/api/ws'
}
