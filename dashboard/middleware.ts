import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

export function middleware(request: NextRequest) {
  if (request.nextUrl.pathname.startsWith('/api/ws')) {
    const bunServer = process.env.NEXT_PUBLIC_BUN_SERVER || 'http://localhost:3902'
    const bunServerUrl = new URL(bunServer)
    const wsUrl = bunServerUrl.toString().replace('http:', 'ws:').replace('https:', 'wss:')

    console.log('Proxying WebSocket request to:', wsUrl)

    return NextResponse.rewrite(new URL('/ws', wsUrl))
  }
}

export const config = {
  matcher: '/api/ws'
}
