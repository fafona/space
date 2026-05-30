import HomePageClient from "./HomePageClient";
import { homeBlocks } from "@/data/homeBlocks";
import { loadPublishedPlatformHomeBlocks } from "@/lib/platformPublished";

export const revalidate = 30;

export default async function Page() {
  const { blocks } = await loadPublishedPlatformHomeBlocks();
  const initialBlocks = blocks ?? homeBlocks;
  return <HomePageClient initialBlocks={initialBlocks} />;
}
