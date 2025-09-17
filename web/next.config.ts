import type { NextConfig } from "next";

const isDev = process.env.NODE_ENV !== "production";

const csp = [
  "default-src 'self'",
  // Next.js และสคริปต์บางส่วน (เช่น runtime/inline bootstrap) ต้องใช้ inline ในโปรดักชันด้วย
  // เพื่อแก้ CSP บล็อก inline scripts บน Netlify จึงอนุญาต 'unsafe-inline'.
  // หมายเหตุ: ถ้าต้องการคงความเข้มงวด สามารถเปลี่ยนเป็น nonce/hash ภายหลังได้
  `script-src 'self' 'unsafe-inline' 'unsafe-eval' 'wasm-unsafe-eval' blob: https://apis.google.com https://accounts.google.com https://www.gstatic.com`.trim(),
  // Inline styles ที่ Next ใช้
  "style-src 'self' 'unsafe-inline'",
  // Media and images
  "img-src 'self' blob: data:",
  "font-src 'self' data:",
  // Firestore/Firebase and WebSocket for signaling
  "connect-src 'self' https://*.googleapis.com https://www.googleapis.com https://securetoken.googleapis.com https://identitytoolkit.googleapis.com https://accounts.google.com https://firestore.googleapis.com https://*.googleusercontent.com ws: wss:",
  // Allow using blobs for audio/video streams and workers
  "media-src 'self' blob:",
  "worker-src 'self' blob:",
  "frame-src 'self' https://accounts.google.com https://*.google.com https://*.firebaseapp.com",
  // For older UAs treating child-src
  "child-src 'self' https://accounts.google.com https://*.google.com https://*.firebaseapp.com",
  "base-uri 'self'",
  "form-action 'self'",
].join("; ");

const nextConfig: NextConfig = {
  async redirects() {
    return [
      { source: "/", destination: "/login", permanent: false },
      { source: "/room/:id", destination: "/room/:id/lobby", permanent: false },
    ];
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: csp },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          // Allow auth popups to communicate with opener (Google sign-in)
          { key: "Cross-Origin-Opener-Policy", value: "same-origin-allow-popups" },
        ],
      },
    ];
  },
};

export default nextConfig;
