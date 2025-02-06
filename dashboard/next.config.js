/** @type {import('next').NextConfig} */
const nextConfig = {
  env: {
    NEXT_PUBLIC_WS_URL:
      process.env.NODE_ENV === 'production'
        ? process.env.PUBLIC_URL?.replace('http', 'ws') ||
          'wss://localhost:3902'
        : 'ws://localhost:3902',
  },
}

export default nextConfig
