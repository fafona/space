export const FAOLLA_SERVICE_WORKER_BASE_PATH = "/faolla-sw.js";

export function buildFaollaServiceWorkerPath(buildId = process.env.NEXT_PUBLIC_FAOLLA_WEB_BUILD_ID) {
  const normalizedBuildId = String(buildId ?? "").trim();
  if (!normalizedBuildId) return FAOLLA_SERVICE_WORKER_BASE_PATH;
  const marker = normalizedBuildId.slice(0, 12);
  return `${FAOLLA_SERVICE_WORKER_BASE_PATH}?build=${encodeURIComponent(marker)}`;
}
