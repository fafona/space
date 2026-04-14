import { NextResponse } from "next/server";
import { readOriginFromReferer, resolveRequestOrigin } from "@/lib/requestOrigin";

function trimText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

export function isTrustedSameOriginMutationRequest(request: Request) {
  const method = request.method.toUpperCase();
  if (!["POST", "PUT", "PATCH", "DELETE"].includes(method)) {
    return true;
  }

  const targetOrigin = resolveRequestOrigin(request);
  if (!targetOrigin) return false;

  const origin = trimText(request.headers.get("origin"));
  if (origin) {
    return origin === targetOrigin;
  }

  const refererOrigin = readOriginFromReferer(request.headers.get("referer"));
  if (refererOrigin) {
    return refererOrigin === targetOrigin;
  }

  return false;
}

export function getTrustedMutationRequestErrorResponse() {
  return NextResponse.json(
    {
      error: "forbidden_origin",
      message: "Cross-origin mutation requests are not allowed.",
    },
    { status: 403 },
  );
}
