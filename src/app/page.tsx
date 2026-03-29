import { headers } from "next/headers";
import HomePageClient from "./HomePageClient";
import { homeBlocks } from "@/data/homeBlocks";
import { isMobileViewportRequest } from "@/lib/deviceViewport";
import { loadPublishedPlatformHomeBlocks } from "@/lib/platformPublished";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function Page() {
  const requestHeaders = await headers();
  const { blocks } = await loadPublishedPlatformHomeBlocks();
  const initialBlocks = blocks ?? homeBlocks;
  const initialIsMobileViewport = isMobileViewportRequest(requestHeaders);
  return <HomePageClient initialBlocks={initialBlocks} initialIsMobileViewport={initialIsMobileViewport} />;
}
