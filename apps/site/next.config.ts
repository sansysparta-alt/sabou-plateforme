import type { NextConfig } from 'next';

// API de SABOU, jointe sous la même origine que le site (/api, /auth) : cookie de session
// SameSite=Lax et contrôle de l'en-tête Origin (lot D). En recette et en production, le
// serveur frontal route /api et /auth vers l'API avant le site ; ce relais sert au poste
// local et aux tests de bout en bout.
const apiUrl = process.env.SABOU_API_URL ?? 'http://localhost:4000';

const nextConfig: NextConfig = {
  poweredByHeader: false,
  async rewrites() {
    return [
      { source: '/api/:path*', destination: `${apiUrl}/api/:path*` },
      { source: '/auth/:path*', destination: `${apiUrl}/auth/:path*` },
    ];
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          // Caméra pour la lecture du QR (/verifier), rien d'autre
          { key: 'Permissions-Policy', value: 'camera=(self), microphone=(), geolocation=()' },
        ],
      },
      {
        // Une nouvelle version du service worker doit être vue tout de suite
        source: '/verifier-sw.js',
        headers: [{ key: 'Cache-Control', value: 'no-cache' }],
      },
    ];
  },
};

export default nextConfig;
