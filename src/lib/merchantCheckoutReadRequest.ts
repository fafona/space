import { isTrustedSameOriginMutationRequest } from "./requestMutationGuard";

/** New private reads also work inside no-referrer pages. Never interpret the
 * old mutation guard's unconditional GET allowance as a same-origin check.
 * Browser-controlled Fetch Metadata is only a fallback when both URL-origin
 * headers are absent; contradictory explicit headers still fail. */
export function isTrustedCheckoutReadRequest(request: Request) {
  if (request.method !== "GET") return false;
  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite !== null && fetchSite !== "same-origin") return false;
  const explicit = ["origin", "referer"].filter(key => request.headers.has(key));
  if (explicit.length) return explicit.every(key => {
    // Validate BOTH supplied headers, rather than inheriting the mutation
    // guard's Origin-first fallback and ignoring a contradictory Referer.
    const headers = new Headers(request.headers);
    headers.delete(key === "origin" ? "referer" : "origin");
    return isTrustedSameOriginMutationRequest(new Request(request, { method: "POST", headers }));
  });
  return request.headers.get("sec-fetch-site") === "same-origin";
}
