import { headers } from "next/headers";
import { redirect } from "next/navigation";
import HomePageClient from "./HomePageClient";
import { homeBlocks } from "@/data/homeBlocks";
import { isMobileViewportRequest } from "@/lib/deviceViewport";
import { loadPublishedPlatformHomeBlocks } from "@/lib/platformPublished";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type PageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

function firstSearchParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

export default async function Page({ searchParams }: PageProps) {
  const resolvedSearchParams = searchParams ? await searchParams : {};
  if (firstSearchParam(resolvedSearchParams.error_code).trim().toLowerCase() === "bad_oauth_state") {
    const params = new URLSearchParams();
    params.set("oauth_error", "bad_oauth_state");
    const appShell = firstSearchParam(resolvedSearchParams.appShell).trim();
    const loginFrom = firstSearchParam(resolvedSearchParams.loginFrom).trim();
    if (appShell) params.set("appShell", appShell);
    if (loginFrom) params.set("loginFrom", loginFrom);
    redirect(`/login?${params.toString()}`);
  }

  const requestHeaders = await headers();
  const { blocks } = await loadPublishedPlatformHomeBlocks();
  const initialBlocks = blocks ?? homeBlocks;
  const initialIsMobileViewport = isMobileViewportRequest(requestHeaders);
  return <HomePageClient initialBlocks={initialBlocks} initialIsMobileViewport={initialIsMobileViewport} />;
}
