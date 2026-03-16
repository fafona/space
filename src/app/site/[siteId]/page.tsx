import { headers } from "next/headers";
import SitePageClient from "./SitePageClient";
import { isMobileViewportRequest } from "@/lib/deviceViewport";

export default async function SitePage() {
  const initialIsMobileViewport = isMobileViewportRequest(await headers());
  return <SitePageClient initialIsMobileViewport={initialIsMobileViewport} />;
}
