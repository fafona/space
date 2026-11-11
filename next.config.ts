import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "faolla.com",
        pathname: "/storage/v1/object/public/**",
      },
      {
        protocol: "https",
        hostname: "*.faolla.com",
        pathname: "/storage/v1/object/public/**",
      },
      {
        protocol: "https",
        hostname: "**.supabase.co",
        pathname: "/storage/v1/object/public/**",
      },
      {
        protocol: "http",
        hostname: "localhost",
        pathname: "/storage/v1/object/public/**",
      },
      {
        protocol: "http",
        hostname: "127.0.0.1",
        pathname: "/storage/v1/object/public/**",
      },
    ],
  },
  serverExternalPackages: ["ffmpeg-static"],
  experimental: {
    proxyClientMaxBodySize: "96mb",
    // Opt in only for the resource-bounded online candidate build. Keep the
    // ordinary build/runtime configuration unchanged when the flag is absent.
    ...(process.env.FAOLLA_BUILD_SINGLE_WORKER === "1" ? { cpus: 1 } : {}),
  },
  async headers() {
    return [
      // Read-only template previews use standalone windows. Protect only these
      // new routes; the existing proxy matcher scope remains unchanged.
      ...["/admin/template-preview", "/super-admin/template-preview"].map((source) => ({
        source,
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Content-Security-Policy", value: "frame-ancestors 'none'; object-src 'none'; base-uri 'self'; form-action 'none'" },
          { key: "Cache-Control", value: "private, no-store, max-age=0" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), payment=()" },
        ],
      })),
      {
        source: "/storage/v1/object/public/:path*",
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=31536000, immutable",
          },
        ],
      },
      {
        source: "/faolla-sw.js",
        headers: [
          {
            key: "Cache-Control",
            value: "no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0",
          },
          { key: "Pragma", value: "no-cache" },
          { key: "Expires", value: "0" },
        ],
      },
    ];
  },
};

export default nextConfig;
