export const MOBILE_BREAKPOINT = 768;

type HeaderSource = {
  get: (name: string) => string | null | undefined;
};

function readHeader(headersLike: HeaderSource, name: string) {
  return String(headersLike.get(name) ?? "").trim();
}

export function isMobileViewportRequest(headersLike: HeaderSource) {
  const chMobile = readHeader(headersLike, "sec-ch-ua-mobile");
  if (chMobile === "?1") return true;

  const viewportWidth = Number.parseInt(readHeader(headersLike, "viewport-width"), 10);
  if (Number.isFinite(viewportWidth) && viewportWidth > 0) {
    return viewportWidth <= MOBILE_BREAKPOINT;
  }

  const userAgent = readHeader(headersLike, "user-agent");
  return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini|Mobile|Windows Phone/i.test(userAgent);
}
