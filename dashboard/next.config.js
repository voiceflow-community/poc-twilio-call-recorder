/** @type {import('next').NextConfig} */
const nextConfig = {
  env: {
    NEXT_PUBLIC_BUN_SERVER: process.env.BUN_SERVER || 'http://localhost:3902',
  },
}

module.exports = nextConfig
