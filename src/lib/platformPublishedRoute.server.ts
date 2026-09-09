import { NextResponse } from "next/server";
import type { PublishedPlatformBlocksResult } from "@/lib/platformPublished";

type PlatformPublishedLoader = () => Promise<PublishedPlatformBlocksResult>;

export function createPlatformPublishedGetHandler(loadBlocks: PlatformPublishedLoader) {
  return async function getPlatformPublished() {
    try {
      const { blocks, error } = await loadBlocks();
      if (blocks && blocks.length > 0) {
        return NextResponse.json({
          ok: true,
          blocks,
        }, {
          headers: {
            "Cache-Control": "public, s-maxage=30, stale-while-revalidate=120",
          },
        });
      }
      return NextResponse.json({ error: error || "platform_published_not_found" }, { status: 404 });
    } catch (error) {
      return NextResponse.json(
        {
          error: "platform_published_failed",
          message: error instanceof Error ? error.message : "unknown_error",
        },
        { status: 500 },
      );
    }
  };
}
