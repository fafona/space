import { NextResponse } from "next/server";
import {
  normalizeOrigin,
  readOriginFromReferer,
  resolvePublicOriginFromHeaders,
  resolveRequestOrigin,
} from "@/lib/requestOrigin";

function trimText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function resolveTrustedMutationTargetOrigins(request: Request) {
  const candidates = new Set<string>();
  const pushCandidate = (value: string | null | undefined, fallbackProtocol = "https") => {
    const normalized = normalizeOrigin(value, fallbackProtocol);
    if (normalized) {
      candidates.add(normalized);
    }
  };

  const originHeader = trimText(request.headers.get("origin"));
  const refererOrigin = readOriginFromReferer(request.headers.get("referer"));
  const requestOrigin = resolveRequestOrigin(request);

  pushCandidate(requestOrigin);
  pushCandidate(resolvePublicOriginFromHeaders(request.headers, requestOrigin));

  return {
    originHeader,
    refererOrigin,
    candidates,
  };
}

export function isTrustedSameOriginMutationRequest(request: Request) {
  const method = request.method.toUpperCase();
  if (!["POST", "PUT", "PATCH", "DELETE"].includes(method)) {
    return true;
  }

  const { originHeader, refererOrigin, candidates } = resolveTrustedMutationTargetOrigins(request);
  if (candidates.size === 0) return false;

  if (originHeader) {
    return candidates.has(originHeader);
  }

  if (refererOrigin) {
    return candidates.has(refererOrigin);
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
