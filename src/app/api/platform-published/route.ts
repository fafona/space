import { NextResponse } from "next/server";
import { loadPublishedPlatformHomeBlocks } from "@/lib/platformPublished";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export { isMissingPlatformMerchantIdColumn, isMissingPlatformSlugColumn } from "@/lib/platformPublished";

export async function GET() {
  try {
    const { blocks, error } = await loadPublishedPlatformHomeBlocks();
    if (blocks && blocks.length > 0) {
      return NextResponse.json({
        ok: true,
        blocks,
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
}
