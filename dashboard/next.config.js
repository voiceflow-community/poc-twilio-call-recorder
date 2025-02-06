/** @type {import('next').NextConfig} */
const nextConfig = {
  env: {
    NEXT_PUBLIC_WS_URL:
      process.env.NODE_ENV === 'production'
        ? process.env.PUBLIC_URL?.replace('http', 'ws') ||
          'wss://localhost:3902'
        : 'ws://localhost:3902',
  },
  typescript: {
    // !! WARN !!
    // Dangerously allow production builds to successfully complete even if
    // your project has type errors.
    ignoreBuildErrors: true,
  },
  eslint: {
    // Warning: This allows production builds to successfully complete even if
    // your project has ESLint errors.
    ignoreDuringBuilds: true,
  },
}

export default nextConfig
