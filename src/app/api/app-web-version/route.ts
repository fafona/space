import { NextResponse } from "next/server";
import { resolveFaollaWebBuildId, resolveFaollaWebReleasedAt } from "@/lib/faollaWebBuild";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  return NextResponse.json(
    {
      ok: true,
      buildId: resolveFaollaWebBuildId(),
      releasedAt: resolveFaollaWebReleasedAt(),
    },
    {
      headers: {
        "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0",
        Pragma: "no-cache",
        Expires: "0",
      },
    },
  );
}
