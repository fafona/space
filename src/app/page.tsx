import HomePageClient from "./HomePageClient";
import { homeBlocks } from "@/data/homeBlocks";
import { loadPublishedPlatformHomeBlocks } from "@/lib/platformPublished";

export const revalidate = 30;
export const dynamic = "force-dynamic";

type HomePageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

function readSearchParamValue(searchParams: Record<string, string | string[] | undefined> | undefined, key: string) {
  const value = searchParams?.[key];
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

function shouldUseLocalTemplate(searchParams: Record<string, string | string[] | undefined> | undefined) {
  const template = readSearchParamValue(searchParams, "template").trim().toLowerCase();
  const localTemplate = readSearchParamValue(searchParams, "localTemplate").trim().toLowerCase();
  return template === "local" || localTemplate === "1" || localTemplate === "true";
}

export default async function Page({ searchParams }: HomePageProps) {
  const resolvedSearchParams = await searchParams;
  const useLocalTemplate = shouldUseLocalTemplate(resolvedSearchParams);
  const { blocks } = useLocalTemplate ? { blocks: null } : await loadPublishedPlatformHomeBlocks();
  const initialBlocks = blocks ?? homeBlocks;
  return <HomePageClient initialBlocks={initialBlocks} />;
}
