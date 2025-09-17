import type { NextConfig } from "next";

const isDev = process.env.NODE_ENV !== "production";

const csp = [
  "default-src 'self'",
  // Allow eval/inline only in development to satisfy turbopack dev runtime
  `script-src 'self' ${isDev ? "'unsafe-eval' 'unsafe-inline'" : ""} blob:`.trim(),
  // Inline styles are commonly used by Next/React dev tools
  "style-src 'self' 'unsafe-inline'",
  // Media and images
  "img-src 'self' blob: data:",
  "font-src 'self' data:",
  // Firestore/Firebase and WebSocket for signaling
  "connect-src 'self' https://*.googleapis.com https://firestore.googleapis.com https://*.googleusercontent.com ws: wss:",
  // Allow using blobs for audio/video streams and workers
  "media-src 'self' blob:",
  "worker-src 'self' blob:",
  "frame-src 'self'",
  "base-uri 'self'",
  "form-action 'self'",
].join("; ");

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: csp },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
        ],
      },
    ];
  },
};

export default nextConfig;
