import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

import {
  discoverProductionDatabaseMigrations,
} from "./apply-production-database-migrations.mjs";

const root = process.cwd();
const repairPath = path.join(
  root,
  "scripts",
  "supabase-migrations",
  "202608300042_merchant_enterprise_pgcrypto_schema_repair.sql",
);
const outboxPath = path.join(
  root,
  "scripts",
  "supabase-migrations",
  "202607250007_reliable_outbox_runtime.sql",
);
const invitationPath = path.join(
  root,
  "scripts",
  "supabase-migrations",
  "202608190033_merchant_enterprise_invitation_delivery_outbox.sql",
);

const repair = fs.readFileSync(repairPath, "utf8").replaceAll("\r\n", "\n");
const packageManifest = JSON.parse(
  fs.readFileSync(path.join(root, "package.json"), "utf8"),
);
const enterpriseRunner = fs
  .readFileSync(path.join(root, "scripts", "enterprise-integration", "run.sh"), "utf8")
  .replaceAll("\r\n", "\n");
const enterpriseWorkflow = fs
  .readFileSync(
    path.join(root, ".github", "workflows", "enterprise-integration.yml"),
    "utf8",
  )
  .replaceAll("\r\n", "\n");
const productionWorkflow = fs
  .readFileSync(
    path.join(root, ".github", "workflows", "database-migrate.yml"),
    "utf8",
  )
  .replaceAll("\r\n", "\n");
const runtimeAcceptance = fs
  .readFileSync(
    path.join(
      root,
      "scripts",
      "enterprise-integration",
      "61-runtime-rpc-execute-acl-hardening.sql",
    ),
    "utf8",
  )
  .replaceAll("\r\n", "\n");
const ordinaryReadiness = fs
  .readFileSync(
    path.join(root, "scripts", "check-ordinary-account-cutover-readiness.mjs"),
    "utf8",
  )
  .replaceAll("\r\n", "\n");
const repairAcceptance = fs
  .readFileSync(
    path.join(
      root,
      "scripts",
      "enterprise-integration",
      "64-pgcrypto-schema-repair.sql",
    ),
    "utf8",
  )
  .replaceAll("\r\n", "\n");
const sourceByFile = new Map([
  [outboxPath, fs.readFileSync(outboxPath, "utf8").replaceAll("\r\n", "\n")],
  [
    invitationPath,
    fs.readFileSync(invitationPath, "utf8").replaceAll("\r\n", "\n"),
  ],
]);

const functions = [
  {
    file: invitationPath,
    name: "faolla_begin_merchant_employee_invitation_exchange_v1",
    signature:
      "public.faolla_begin_merchant_employee_invitation_exchange_v1(jsonb)",
    digestCount: 1,
    sourceMd5: "031ca32996cdf97b026b61b8a8b9fdec",
    repairedMd5: "aa9e0203469de98b0da0b7c3b23d87a1",
  },
  {
    file: invitationPath,
    name: "faolla_bind_merchant_employee_invitation_identity_v2",
    signature:
      "public.faolla_bind_merchant_employee_invitation_identity_v2(jsonb)",
    digestCount: 3,
    sourceMd5: "7100ad0b517c0d68f1ad5c11a80a0c10",
    repairedMd5: "897e075e63d93f995d74f42bd71432b9",
  },
  {
    file: invitationPath,
    name: "faolla_complete_merchant_employee_invitation_delivery_v1",
    signature:
      "public.faolla_complete_merchant_employee_invitation_delivery_v1(jsonb)",
    digestCount: 1,
    sourceMd5: "10382a58cade0512e2649347663f2ea4",
    repairedMd5: "3e66f5fdb159a04bad2637695afca05a",
  },
  {
    file: invitationPath,
    name: "faolla_create_merchant_enterprise_employee_invitation_v2",
    signature:
      "public.faolla_create_merchant_enterprise_employee_invitation_v2(jsonb)",
    digestCount: 1,
    sourceMd5: "f7122c8bb4fc4ed375b4826823df9201",
    repairedMd5: "31eff80d7894509ca2033ae846db4b4f",
  },
  {
    file: outboxPath,
    name: "faolla_fail_merchant_outbox_v1",
    signature:
      "public.faolla_fail_merchant_outbox_v1(uuid,text,text,text,boolean,integer)",
    digestCount: 1,
    sourceMd5: "8257998a8a5121e8d4076ff0cc66a883",
    repairedMd5: "36c3010e94db4ba1618a4c636faa4577",
  },
  {
    file: invitationPath,
    name: "faolla_lookup_merchant_enterprise_staff_identity_v1",
    signature:
      "public.faolla_lookup_merchant_enterprise_staff_identity_v1(text)",
    digestCount: 1,
    sourceMd5: "3364d153fd3176b0f847743c9e9e9371",
    repairedMd5: "e8119318f0b31a58d684cd8b15102867",
  },
  {
    file: invitationPath,
    name: "faolla_mark_merchant_employee_invitation_exchange_issued_v1",
    signature:
      "public.faolla_mark_merchant_employee_invitation_exchange_issued_v1(jsonb)",
    digestCount: 1,
    sourceMd5: "e8c68f68895e1777ebbd6e6a3d6db551",
    repairedMd5: "a238928720ea9a0e24e4704a7f5c30e8",
  },
  {
    file: invitationPath,
    name: "faolla_prepare_merchant_employee_invitation_delivery_v1",
    signature:
      "public.faolla_prepare_merchant_employee_invitation_delivery_v1(jsonb)",
    digestCount: 1,
    sourceMd5: "71c68685e0c1ec1101464a3f2e36cece",
    repairedMd5: "ab3433f462c47356aaa9371a49e75b66",
  },
  {
    file: invitationPath,
    name: "faolla_recheck_merchant_employee_invitation_exchange_v1",
    signature:
      "public.faolla_recheck_merchant_employee_invitation_exchange_v1(jsonb)",
    digestCount: 1,
    sourceMd5: "aaa84a9c3c44db2f04af9970cb85ad64",
    repairedMd5: "fc5dcddf341a78201072411845bb8af2",
  },
  {
    file: invitationPath,
    name: "faolla_schedule_merchant_employee_invitation_delivery_v2",
    signature:
      "public.faolla_schedule_merchant_employee_invitation_delivery_v2(jsonb)",
    digestCount: 1,
    sourceMd5: "12bc175a4da0452985e9d3aeaa0d123a",
    repairedMd5: "cefbd251b31556168ae677b780026f4c",
  },
  {
    file: invitationPath,
    name: "faolla_sync_merchant_enterprise_staff_identity_v1",
    signature: "public.faolla_sync_merchant_enterprise_staff_identity_v1()",
    digestCount: 1,
    sourceMd5: "c7ba14a42946d31f4b39263b1e833aed",
    repairedMd5: "6d0ac1e7cbbb7e519f8a3e82b7eea06b",
  },
];

function md5(value) {
  return createHash("md5").update(value, "utf8").digest("hex");
}

function extractBody(source, name) {
  const compactNeedle = `create or replace function public.${name}`;
  const wrappedNeedle = `create or replace function\n  public.${name}`;
  const start = Math.max(
    source.indexOf(compactNeedle),
    source.indexOf(wrappedNeedle),
  );
  assert.notEqual(start, -1, `missing source function ${name}`);
  const bodyStart = source.indexOf("as $$", start);
  assert.notEqual(bodyStart, -1, `missing body start for ${name}`);
  const contentStart = bodyStart + "as $$".length;
  const bodyEnd = source.indexOf("$$;", contentStart);
  assert.notEqual(bodyEnd, -1, `missing body end for ${name}`);
  return source.slice(contentStart, bodyEnd);
}

test("042 freezes the exact production sources and their token-only repairs", () => {
  assert.equal(functions.length, 11);

  for (const expected of functions) {
    const body = extractBody(sourceByFile.get(expected.file), expected.name);
    const repairedBody = body.replaceAll("digest(", "extensions.digest(");

    assert.equal(md5(body), expected.sourceMd5, `${expected.name} source drift`);
    assert.equal(
      md5(repairedBody),
      expected.repairedMd5,
      `${expected.name} repaired source drift`,
    );
    assert.equal(
      body.split("digest(").length - 1,
      expected.digestCount,
      `${expected.name} digest count drift`,
    );
    assert.equal(body.includes("extensions.digest("), false);

    assert.match(repair, new RegExp(expected.signature.replace(/[()]/g, "\\$&")));
    assert.match(repair, new RegExp(expected.sourceMd5));
    assert.match(repair, new RegExp(expected.repairedMd5));
  }
});

test("042 preserves the hardened security boundary while qualifying pgcrypto", () => {
  assert.match(repair, /^--[\s\S]*\nbegin;/);
  assert.match(repair, /current_user <> 'supabase_admin'[\s\S]+rolsuper/i);
  assert.match(
    repair,
    /pg_advisory_xact_lock\(20260731, 1\)[\s\S]+lock table[\s\S]+pg_catalog\.pg_proc[\s\S]+public\.faolla_schema_migrations/i,
  );
  assert.match(
    repair,
    /pgcrypto[\s\S]+extension_namespace\.nspname = 'extensions'[\s\S]+extensions\.digest\(bytea,text\)/i,
  );
  assert.match(repair, /extensions\.digest\(text,text\)/i);
  assert.match(
    repair,
    /pg_get_functiondef[\s\S]+replace\([\s\S]+v_before_definition[\s\S]+'digest\('[\s\S]+'extensions\.digest\('/i,
  );
  assert.match(
    repair,
    /proowner = 'supabase_admin'::regrole[\s\S]+prosecdef[\s\S]+proconfig is not distinct from[\s\S]+search_path=public[\s\S]+proacl is not distinct from/i,
  );
  assert.match(
    repair,
    /tgtype = 21[\s\S]+tgenabled = 'O'[\s\S]+tgattr = '3 4'::pg_catalog\.int2vector/i,
  );
  assert.doesNotMatch(repair, /set(?: local)? search_path\s*=\s*[^;\n]*extensions/i);
  assert.doesNotMatch(repair, /\b(?:grant|revoke)\b/i);
  assert.doesNotMatch(repair, /alter\s+extension|create\s+function\s+public\.digest/i);
});

test("042 is forward-only, registered, replay-validating, and PostgREST aware", () => {
  assert.match(
    repair,
    /insert into public\.faolla_schema_migrations \(version, name\)[\s\S]+values \(202608300042, 'merchant_enterprise_pgcrypto_schema_repair'\)[\s\S]+on conflict \(version\) do nothing/i,
  );
  assert.match(
    repair,
    /when v_registered then v_expected\.repaired_source_md5[\s\S]+if v_registered then[\s\S]+continue;/i,
  );
  assert.match(repair, /notify pgrst, 'reload schema';\s*\n\s*commit;\s*$/i);
  assert.doesNotMatch(repair, /\bdrop\s+(?:table|function|trigger|column)\b/i);
});

test("042 is wired into PG15 acceptance and supersedes the 039 source pin", () => {
  assert.match(
    packageManifest.scripts["test:db-migrations"],
    /merchant-enterprise-pgcrypto-schema-repair-migration-contract\.test\.mjs/,
  );
  assert.equal(
    enterpriseWorkflow.match(
      /- "scripts\/merchant-enterprise-pgcrypto-schema-repair-migration-contract\.test\.mjs"/g,
    )?.length,
    2,
  );
  assert.match(
    enterpriseRunner,
    /pgcrypto_schema_repair_migration_path="\$\{REPOSITORY_ROOT\}\/scripts\/supabase-migrations\/202608300042_merchant_enterprise_pgcrypto_schema_repair\.sql"/,
  );
  assert.match(enterpriseRunner, /expected_registry_count=45/);
  assert.match(
    enterpriseRunner,
    /mirroring the hosted extensions-only pgcrypto layout[\s\S]+alter extension pgcrypto set schema extensions[\s\S]+rejecting an untrusted 042 migration actor atomically[\s\S]+64-pgcrypto-schema-repair\.sql[\s\S]+042 registered replay changed a function fingerprint or registry state/,
  );
  assert.match(
    runtimeAcceptance,
    /version = 202608300042[\s\S]+36c3010e94db4ba1618a4c636faa4577[\s\S]+else '8257998a8a5121e8d4076ff0cc66a883'/,
  );
  assert.match(
    repairAcceptance,
    /public\.digest\(bytea, text\)[\s\S]+public\.digest\(text, text\)[\s\S]+public_digest_hijacked[\s\S]+faolla_bind_merchant_employee_auth_user_v1[\s\S]+faolla_fail_merchant_outbox_v1[\s\S]+retry_scheduled/,
  );
  assert.match(
    ordinaryReadiness,
    /FAIL_OUTBOX_RUNTIME_SOURCE_MD5\s*=\s*[\s\S]+8257998a8a5121e8d4076ff0cc66a883/,
  );
  assert.match(
    ordinaryReadiness,
    /FAIL_OUTBOX_PGCRYPTO_REPAIRED_SOURCE_MD5\s*=\s*[\s\S]+36c3010e94db4ba1618a4c636faa4577/,
  );
  assert.match(
    ordinaryReadiness,
    /version = 202608300042[\s\S]+merchant_enterprise_pgcrypto_schema_repair[\s\S]+\["preflight", "definition_postcondition"\]/,
  );
});

test("production migration discovery selects exactly 042 as the requested boundary", async () => {
  const discovery = await discoverProductionDatabaseMigrations({
    rootDir: root,
    through: "202608300042",
  });

  assert.equal(discovery.selected.at(-1)?.version, "202608300042");
  assert.equal(
    discovery.migrations.filter(({ version }) => version === "202608300042")
      .length,
    1,
  );
  assert.deepEqual(
    discovery.selected.slice(-2).map(({ version }) => version),
    ["202608280041", "202608300042"],
  );
  assert.match(
    productionWorkflow,
    /discovery\.selected\.at\(-1\)\?\.version !== through/,
  );
});
