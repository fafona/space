import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const readSource = (path) => readFileSync(path, "utf8");

const managerSource = readSource(
  "src/components/admin/MerchantOrderManagerDialog.tsx",
);
const workbenchSource = readSource(
  "src/components/admin/OrderWorkbenchPanel.tsx",
);
const catalogSource = readSource(
  "src/components/admin/MerchantCatalogManagerPanel.tsx",
);
const preferencesSource = readSource(
  "src/lib/useMerchantManagerPreferences.ts",
);
const assetUploadRouteSource = readSource(
  "src/app/api/assets/upload/route.ts",
);
const assetProcessingSource = readSource(
  "src/lib/editorAssetProcessing.ts",
);

test("order manager exposes the injected employee security contract", () => {
  for (const prop of ["apiClient", "cachePolicy", "permissions"]) {
    assert.match(managerSource, new RegExp(`${prop}\\?:`));
  }
  assert.doesNotMatch(managerSource, /await\s+fetchWithAdminPerformance\s*\(/);
  assert.match(managerSource, /const requestOrderApi = useMemo\(/);
  assert.match(managerSource, /requestOrderApi\(\s*"\/api\/orders"/);
  assert.match(managerSource, /effectiveCachePolicy\.allowPersistentRead/);
  assert.match(managerSource, /effectiveCachePolicy\.allowPersistentWrite/);
  assert.match(managerSource, /effectiveCachePolicy\.allowStaleOnError/);
  assert.match(
    managerSource,
    /useMerchantOrderManagerPreferences\(siteId, \{ cachePolicy: effectiveCachePolicy \}\)/,
  );
});

test("completion UI uses semantic complete actions instead of a status write", () => {
  assert.match(managerSource, /status === "completed"\s*\? "complete"/);
  assert.match(managerSource, /order\.status === "completed"\s*\? "uncomplete"/);
  assert.match(
    managerSource,
    /requestOrderAction\(orderWithItems, completionAction\)/,
  );
  assert.match(managerSource, /throw new Error\("order_completion_action_required"\)/);
});

test("workbench order and export requests cannot bypass the injected client", () => {
  assert.doesNotMatch(workbenchSource, /await\s+fetch\s*\(/);
  for (const endpoint of [
    "/api/orders/workbench",
    "/api/orders/export",
    "/api/orders",
  ]) {
    assert.ok(
      workbenchSource.includes(endpoint),
      `missing workbench endpoint ${endpoint}`,
    );
  }
  assert.match(workbenchSource, /requestApi\(\s*"\/api\/orders\/export"/);
  assert.match(workbenchSource, /requestApi\(\s*"\/api\/orders"/);
  assert.match(
    workbenchSource,
    /canOpenMerchantOrderWorkbenchView\(effectivePermissions, view\)/,
  );
});

test("employee catalog uses injected reads, writes and business-scoped uploads", () => {
  assert.doesNotMatch(catalogSource, /await\s+fetch\s*\(/);
  assert.match(catalogSource, /if \(employeeCatalogBlocked\)/);
  assert.match(catalogSource, /data-employee-catalog="blocked"/);
  assert.match(catalogSource, /data-employee-catalog="read-only"/);
  assert.match(catalogSource, /requestCatalogApi\(\s*"\/api\/orders\/catalog"/);
  assert.match(catalogSource, /apiClient:\s*requestCatalogApi/);
  assert.match(catalogSource, /businessPurpose:\s*"order-catalog"/);
});

test("catalog asset uploads are token-authoritative and freshly authorized before storage writes", () => {
  assert.match(
    assetUploadRouteSource,
    /request\.headers\.has\("x-merchant-access-token"\)/,
  );
  assert.match(
    assetUploadRouteSource,
    /"order-catalog":\s*"orders\.catalog\.manage"/,
  );
  assert.match(assetUploadRouteSource, /siteId:\s*businessSiteId/);
  assert.match(assetProcessingSource, /requestOptions\.apiClient\("\/api\/assets\/upload", init\)/);
  const storageWrites = [...assetUploadRouteSource.matchAll(/\.upload\(/g)].length;
  const freshAuthorizationChecks = [
    ...assetUploadRouteSource.matchAll(/await authorizeStorageWrite\(\)/g),
  ].length;
  assert.ok(storageWrites > 0);
  assert.equal(freshAuthorizationChecks, storageWrites);
});

test("memory-only preferences skip local and owner-only remote persistence", () => {
  assert.match(
    preferencesSource,
    /if \(!normalizedSiteId \|\| !persistenceEnabled\)/,
  );
  assert.match(
    preferencesSource,
    /if \(\s*!persistenceEnabled \|\|\s*!normalizedSiteId/,
  );
  assert.match(
    preferencesSource,
    /persistenceEnabled\s*\? normalize\(loadLocal\(targetSiteId\)\)\s*:\s*normalize\(\{\}\)/,
  );
});
