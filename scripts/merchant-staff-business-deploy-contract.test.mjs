import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [workflow, deploy, readiness, bootstrap, securityContract, compatibilityMarkerSource] = await Promise.all([
  readFile(new URL("../.github/workflows/deploy.yml", import.meta.url), "utf8"),
  readFile(new URL("./deploy.production.sh", import.meta.url), "utf8"),
  readFile(
    new URL("./check-ordinary-account-cutover-readiness.mjs", import.meta.url),
    "utf8",
  ),
  readFile(
    new URL(
      "./supabase-migrations/202608190036_ordinary_account_authorization_bootstrap.sql",
      import.meta.url,
    ),
    "utf8",
  ),
  readFile(
    new URL("../docs/merchant-staff-business-rbac.md", import.meta.url),
    "utf8",
  ),
  readFile(
    new URL("./merchant-staff-business-rbac-compatibility-v1.json", import.meta.url),
    "utf8",
  ),
]);

test("production transports the staff rollout as an exact fail-closed configuration", () => {
  for (const key of [
    "MERCHANT_STAFF_BUSINESS_RBAC_MODE",
    "MERCHANT_STAFF_BUSINESS_RBAC_SITE_IDS",
    "FAOLLA_CANONICAL_PORTAL_ORIGIN",
  ]) {
    assert.match(workflow, new RegExp(`${key}: \\$\\{\\{ vars\\.${key} \\}\\}`));
    assert.match(workflow, new RegExp(`"${key}"`));
    assert.match(deploy, new RegExp(`\\n  ${key}\\n`));
  }

  assert.match(
    workflow,
    /FAOLLA_CANONICAL_PORTAL_ORIGIN="\$\{FAOLLA_CANONICAL_PORTAL_ORIGIN:-https:\/\/launch\.faolla\.com\}"/,
  );
  assert.match(
    workflow,
    /MERCHANT_STAFF_BUSINESS_RBAC_MODE="\$\{MERCHANT_STAFF_BUSINESS_RBAC_MODE:-off\}"/,
  );
  assert.match(workflow, /off\)\s+MERCHANT_STAFF_BUSINESS_RBAC_SITE_IDS=""/);
  assert.match(workflow, /\^\[0-9\]\{8\}\(,\[0-9\]\{8\}\)\{0,49\}\$/);
  assert.match(workflow, /new Set\(siteIds\)\.size !== siteIds\.length/);

  assert.match(
    deploy,
    /FAOLLA_CANONICAL_PORTAL_ORIGIN" != "https:\/\/launch\.faolla\.com"/,
  );
  assert.match(deploy, /case "\$MERCHANT_STAFF_BUSINESS_RBAC_MODE" in[\s\S]+off\)[\s\S]+enforce\)[\s\S]+\*\)/);
  assert.match(deploy, /merchant_staff_business_site_ids_seen/);
  assert.match(deploy, /write_env_value "MERCHANT_STAFF_BUSINESS_RBAC_MODE"/);
  assert.match(deploy, /remove_env_value "MERCHANT_STAFF_BUSINESS_RBAC_SITE_IDS"/);
  assert.match(deploy, /write_env_value "FAOLLA_CANONICAL_PORTAL_ORIGIN"/);

  const persist = deploy.indexOf(
    'write_env_value "MERCHANT_STAFF_BUSINESS_RBAC_MODE"',
  );
  const releaseCopy = deploy.indexOf(
    'cp -p -- "$APP_DIR/.env.local" "$RELEASE_BUILD_DIR/.env.local"',
  );
  const build = deploy.indexOf("npm run build", releaseCopy);
  assert.ok(persist >= 0 && releaseCopy > persist && build > releaseCopy);
});

test("staff rollout deployment remains bound to authoritative owner readiness", () => {
  assert.match(workflow, /workflows:\s+\- Ordinary Account Cutover Readiness/);
  assert.match(workflow, /workflow_run\.conclusion == 'success'/);
  assert.match(workflow, /workflow_run\.head_sha/);
  assert.match(workflow, /github\.repository/);
  assert.match(readiness, /--fail-on-blocked/);
  assert.match(readiness, /readiness\.merchantInvalidBindingCount === 0/);

  for (const ownerColumn of [
    "user_id",
    "auth_user_id",
    "owner_user_id",
    "owner_id",
    "auth_id",
    "created_by",
    "created_by_user_id",
  ]) {
    assert.match(bootstrap, new RegExp(`merchant\\.${ownerColumn}`));
  }
  assert.match(bootstrap, /alias_value_count = 7/);
  assert.match(bootstrap, /alias_count = 1/);
  assert.match(bootstrap, /auth_user_exists/);
  assert.match(bootstrap, /v_merchant_invalid_count = 0/);
});

test("the rollout contract requires a compatible off release before enforce and a zero-row rollback", () => {
  assert.match(securityContract, /首次上线必须作为兼容发布保持 `off`/);
  assert.match(securityContract, /禁止创建或保留任何业务权限/);
  assert.match(securityContract, /上一份可回滚 release 已能解析 39 项新权限/);
  assert.match(
    securityContract,
    /回滚到不认识新权限的旧版本前[\s\S]+先切回 `off`[\s\S]+验证数量为零/,
  );
  assert.match(securityContract, /不得让自动回滚越过这项数据库兼容性检查/);

  const compatibilityCheck = deploy.indexOf(
    "merchant-staff-business-rbac-compatibility-v1.json",
  );
  const firstEnvironmentMutation = deploy.indexOf(
    'write_env_value "WEB_PUSH_PUBLIC_KEY"',
  );
  assert.ok(
    compatibilityCheck >= 0 &&
      firstEnvironmentMutation > compatibilityCheck,
    "rollback compatibility must be proven before environment mutation",
  );
  assert.match(
    deploy,
    /MERCHANT_STAFF_BUSINESS_RBAC_MODE" = "enforce"[\s\S]+permissionContractSha256,permissionCount,permissionKeysSha256,schema,version[\s\S]+marker\.permissionCount !== 39[\s\S]+marker\.permissionKeysSha256 !==[\s\S]+marker\.permissionContractSha256 !==/,
  );
  const compatibilityMarkerBytes = Buffer.from(
    compatibilityMarkerSource,
    "utf8",
  );
  assert.equal(
    createHash("sha256").update(compatibilityMarkerBytes).digest("hex"),
    "88b0e93afe8c9e470a19583d1fc803b182fd59f066308fa1390fbbdc0fed1890",
    "the deployed marker bytes are an immutable v1 contract",
  );
  assert.equal(
    createHash("sha1")
      .update(`blob ${compatibilityMarkerBytes.length}\0`, "utf8")
      .update(compatibilityMarkerBytes)
      .digest("hex"),
    "3b4b076c830aee36d2d8d5f8664264f4edae6ac8",
    "the frozen previous commit must resolve the exact v1 marker blob",
  );
  assert.deepEqual(JSON.parse(compatibilityMarkerSource), {
    schema: "faolla.merchant-staff-business-rbac-compatibility",
    version: 1,
    permissionCount: 39,
    permissionKeysSha256:
      "bf35ba5e297d8a9dc0f164cd02063758ed245fd4d66ccfd71e45929c884c09a2",
    permissionContractSha256:
      "4d82b7912ff8acfd21550cc9d6884bb5bd75189aaef89fd7a4b0acd89ea3c2e5",
  });
  assert.match(
    deploy,
    /v1:39:bf35ba5e297d8a9dc0f164cd02063758ed245fd4d66ccfd71e45929c884c09a2:4d82b7912ff8acfd21550cc9d6884bb5bd75189aaef89fd7a4b0acd89ea3c2e5/,
  );
  assert.match(
    deploy,
    /git -C "\$APP_DIR" rev-parse --verify[\s\S]+\$\{PREVIOUS_BUILD_ID\}:scripts\/merchant-staff-business-rbac-compatibility-v1\.json[\s\S]+3b4b076c830aee36d2d8d5f8664264f4edae6ac8/,
  );
  assert.match(
    deploy,
    /constants\.O_NOFOLLOW[\s\S]+fstatSync\(descriptor, \{ bigint: true \}\)[\s\S]+ctimeNs[\s\S]+\/proc\/self\/fd\//,
  );
  assert.match(
    deploy,
    /88b0e93afe8c9e470a19583d1fc803b182fd59f066308fa1390fbbdc0fed1890/,
  );
  assert.match(
    deploy,
    /staff business enforce requires a compatible frozen rollback release/,
  );
  assert.match(
    deploy,
    /git archive --format=tar "\$EXPECTED_DEPLOY_SHA"[\s\S]+tar --no-same-owner --no-same-permissions -xf - -C "\$RELEASE_BUILD_DIR"/,
  );
  assert.match(
    deploy,
    /compatibilityDirectoryIdentity[\s\S]+mode & 0o022[\s\S]+compatibilityMarkerIdentity[\s\S]+nlink !== 1[\s\S]+88b0e93afe8c9e470a19583d1fc803b182fd59f066308fa1390fbbdc0fed1890/,
  );
  assert.match(
    deploy,
    /deploy_preflight_staff_compatibility_marker_failed/,
  );
  assert.match(
    deploy,
    /deploy_preflight_staff_rollout_environment_failed/,
  );

  const supabaseSnapshotValidation = deploy.slice(
    deploy.indexOf('if ! PREVIOUS_SUPABASE_INTERNAL_URL="$('),
    deploy.indexOf('if ! PREVIOUS_MERCHANT_STAFF_BUSINESS_RBAC_MODE="$('),
  );
  assert.ok(supabaseSnapshotValidation.length > 0);
  assert.doesNotMatch(
    supabaseSnapshotValidation,
    /deploy_preflight_staff_rollout_environment_failed/,
  );
  const staffSnapshotValidation = deploy.slice(
    deploy.indexOf('if ! PREVIOUS_MERCHANT_STAFF_BUSINESS_RBAC_MODE="$('),
    deploy.indexOf("unset PREVIOUS_ENVIRONMENT_SNAPSHOT_PARTS"),
  );
  assert.match(
    staffSnapshotValidation,
    /deploy_preflight_staff_rollout_environment_failed/,
  );
});
