import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  transpilePackages: ['@fifa/shared'],
  images: {
    remotePatterns: [{ protocol: 'https', hostname: 'flagcdn.com' }],
  },
  async rewrites() {
    const api = process.env.API_INTERNAL_URL ?? 'http://localhost:4000';
    return [
      { source: '/api/v1/:path*', destination: `${api}/api/v1/:path*` },
      { source: '/graphql', destination: `${api}/graphql` },
    ];
  },
};

export default nextConfig;
