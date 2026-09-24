import type { NextConfig } from 'next';
import { fileURLToPath } from 'node:url';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Image Docker minimale (apps/web/Dockerfile) : serveur autonome, tracé depuis la racine du monorepo.
  output: 'standalone',
  outputFileTracingRoot: fileURLToPath(new URL('../../', import.meta.url)),
  // Les paquets internes sont consommés depuis leur dist compilé (ESM) ; domain reste transpilé pour ses sources partagées.
  transpilePackages: ['@neomoov/domain'],
  headers: async () => [
    {
      source: '/(.*)',
      headers: [
        { key: 'X-Content-Type-Options', value: 'nosniff' },
        { key: 'X-Frame-Options', value: 'DENY' },
        { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
        { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(self)' },
      ],
    },
  ],
};

export default nextConfig;
