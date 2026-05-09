import type { MetadataRoute } from "next";

function readPublicOrigin() {
  const configured = String(process.env.NEXT_PUBLIC_PORTAL_BASE_DOMAIN ?? "").trim();
  if (!configured) return "https://www.faolla.com";
  try {
    return new URL(/^https?:\/\//i.test(configured) ? configured : `https://${configured}`).origin;
  } catch {
    return "https://www.faolla.com";
  }
}

export default function robots(): MetadataRoute.Robots {
  const origin = readPublicOrigin();
  return {
    rules: {
      userAgent: "*",
      allow: "/",
    },
    sitemap: `${origin}/sitemap.xml`,
    host: origin,
  };
}
