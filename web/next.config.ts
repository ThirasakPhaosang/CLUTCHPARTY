import type { NextConfig } from "next";

const isDev = process.env.NODE_ENV !== "production";

const csp = [
  "default-src 'self'",
  // Next.js และสคริปต์บางส่วน (เช่น runtime/inline bootstrap) ต้องใช้ inline ในโปรดักชันด้วย
  // เพื่อแก้ CSP บล็อก inline scripts บน Netlify จึงอนุญาต 'unsafe-inline'.
  // หมายเหตุ: ถ้าต้องการคงความเข้มงวด สามารถเปลี่ยนเป็น nonce/hash ภายหลังได้
  `script-src 'self' 'unsafe-inline' ${isDev ? "'unsafe-eval'" : ""} blob:`.trim(),
  // Inline styles ที่ Next ใช้
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
