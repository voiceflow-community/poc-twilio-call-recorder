/** @type {import('next').NextConfig} */
const nextConfig = {
  env: {
    NEXT_PUBLIC_BUN_SERVER: process.env.BUN_SERVER,
  },
}

module.exports = nextConfig
