import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/launch",
    name: "Faolla.com",
    short_name: "Faolla",
    description: "Faolla.com mobile workspace",
    lang: "en",
    dir: "ltr",
    start_url: "/launch",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#081121",
    theme_color: "#081121",
    categories: ["business", "productivity", "utilities"],
    icons: [
      {
        src: "/faolla-app-icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/faolla-app-icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
    shortcuts: [
      {
        name: "Merchant Login",
        short_name: "Login",
        description: "Open merchant backend sign in",
        url: "/login",
        icons: [
          {
            src: "/faolla-app-icon-192.png",
            sizes: "192x192",
            type: "image/png",
          },
        ],
      },
      {
        name: "Personal Center",
        short_name: "Me",
        description: "Open personal user center",
        url: "/me",
        icons: [
          {
            src: "/faolla-app-icon-192.png",
            sizes: "192x192",
            type: "image/png",
          },
        ],
      },
      {
        name: "Platform Home",
        short_name: "Home",
        description: "Open the Faolla platform home page",
        url: "/",
        icons: [
          {
            src: "/faolla-app-icon-192.png",
            sizes: "192x192",
            type: "image/png",
          },
        ],
      },
      {
        name: "PWA Settings",
        short_name: "PWA",
        description: "Open the Faolla PWA settings page",
        url: "/pwa",
        icons: [
          {
            src: "/faolla-app-icon-192.png",
            sizes: "192x192",
            type: "image/png",
          },
        ],
      },
      {
        name: "Super Admin",
        short_name: "Admin",
        description: "Open super admin sign in",
        url: "/super-admin/login",
        icons: [
          {
            src: "/faolla-app-icon-192.png",
            sizes: "192x192",
            type: "image/png",
          },
        ],
      },
    ],
  };
}
