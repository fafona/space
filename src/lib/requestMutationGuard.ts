import { NextResponse } from "next/server";
import { normalizeOrigin, readOriginFromReferer, resolveConfiguredPublicOrigin, resolveRequestOrigin } from "@/lib/requestOrigin";

function trimText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function readOriginProtocol(value: string) {
  const normalized = trimText(value);
  if (!normalized) return "";
  try {
    return new URL(normalized).protocol.replace(/:$/, "");
  } catch {
    return "";
  }
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
  const hostHeader = trimText(request.headers.get("host"));
  const requestOrigin = resolveRequestOrigin(request);
  const configuredOrigin = resolveConfiguredPublicOrigin();

  pushCandidate(requestOrigin);
  pushCandidate(configuredOrigin);
  if (hostHeader) {
    pushCandidate(hostHeader, readOriginProtocol(originHeader) || readOriginProtocol(refererOrigin) || readOriginProtocol(requestOrigin) || "https");
  }

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
