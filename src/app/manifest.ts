import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "faolla.com",
    short_name: "faolla.com",
    description: "faolla.com mobile workspace",
    start_url: "/",
    display: "standalone",
    background_color: "#f2f5f9",
    theme_color: "#0f172a",
    orientation: "portrait",
    icons: [
      {
        src: "/icon.svg",
        sizes: "any",
        type: "image/svg+xml",
        purpose: "any",
      },
      {
        src: "/favicon.ico",
        sizes: "48x48",
        type: "image/x-icon",
      },
    ],
  };
}
