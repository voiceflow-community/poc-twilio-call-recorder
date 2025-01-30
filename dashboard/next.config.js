/** @type {import('next').NextConfig} */
const nextConfig = {
  env: {
    NEXT_PUBLIC_BUN_SERVER: process.env.BUN_SERVER || 'http://bun-server:3902',
  },
  async rewrites() {
    return [
      {
        source: '/api/ws',
        destination: `${process.env.BUN_SERVER || 'http://bun-server:3902'}/ws`,
      },
    ]
  },
}

module.exports = nextConfig
