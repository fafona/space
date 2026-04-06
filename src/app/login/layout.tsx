import type { ReactNode } from "react";
import type { Viewport } from "next";

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
  themeColor: "#081121",
  interactiveWidget: "resizes-content",
};

export default function LoginLayout({
  children,
}: {
  children: ReactNode;
}) {
  return children;
}
