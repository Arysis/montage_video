// Fichier .mjs (et non .ts) : en production, Next le charge sans TypeScript, retiré de l'image.

const dev = process.env.NODE_ENV !== "production";

/** @param {string | undefined} url */
function origin(url) {
  try {
    return url ? new URL(url).origin : "";
  } catch {
    return "";
  }
}

// Vidéo de démo de la page d'accueil, si elle est hébergée ailleurs.
const demoOrigins = [
  origin(process.env.NEXT_PUBLIC_DEMO_VIDEO_URL),
  origin(process.env.NEXT_PUBLIC_DEMO_POSTER_URL),
]
  .filter(Boolean)
  .join(" ");

const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${dev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  `img-src 'self' data: blob: ${demoOrigins}`.trim(),
  `media-src 'self' blob: ${demoOrigins}`.trim(),
  "font-src 'self' data:",
  `connect-src 'self'${dev ? " ws:" : ""}`,
  "frame-src 'none'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self' https://checkout.stripe.com https://billing.stripe.com https://*.ayrshare.com",
  "frame-ancestors 'none'",
  ...(dev ? [] : ["upgrade-insecure-requests"]),
].join("; ");

/** @type {import("next").NextConfig} */
const nextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  serverExternalPackages: ["@node-rs/argon2", "sharp", "pg-boss", "pg"],
  experimental: {
    serverActions: { bodySizeLimit: "1mb" },
  },
  async headers() {
    return [
      {
        // Les fichiers servis par l'API ont leur propre politique (bac à sable).
        source: "/((?!api/files|api/public-files).*)",
        headers: [{ key: "Content-Security-Policy", value: csp }],
      },
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Permissions-Policy", value: "camera=(), geolocation=(), microphone=(self)" },
          ...(dev
            ? []
            : [{ key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" }]),
        ],
      },
    ];
  },
};

export default nextConfig;
