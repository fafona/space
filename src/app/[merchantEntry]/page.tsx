import { headers } from "next/headers";
import MerchantEntryPageClient from "./MerchantEntryPageClient";
import { isMobileViewportRequest } from "@/lib/deviceViewport";

export default async function MerchantEntryPage() {
  const initialIsMobileViewport = isMobileViewportRequest(await headers());
  return <MerchantEntryPageClient initialIsMobileViewport={initialIsMobileViewport} />;
}
