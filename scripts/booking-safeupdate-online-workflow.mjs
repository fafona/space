import assert from 'node:assert/strict';

// This separate, one-off workflow retains every existing CI, backup,
// attestation, SSH, database identity, source and public-smoke gate verbatim.
// Only the maintenance admission is replaced by the approved, pinned online
// function migration and its transaction-local serialization/postconditions.
export function bookingSafeupdateOnlineWorkflow(original) {
  let source=original.replaceAll('\r\n','\n');
  const once=(before,after)=>{
    assert.equal(source.split(before).length,2,'workflow template changed: '+before.slice(0,70));
    source=source.replace(before,after);
  };
  once('name: Apply Production Database Migrations','name: Apply Booking Safeupdate Online');
  const start=source.indexOf('\non:\n'),end=source.indexOf('\nconcurrency:\n');
  assert.ok(start>0&&end>start);
  source=source.slice(0,start)+`\non:
  workflow_dispatch:
    inputs:
      target_sha:
        description: Exact current main commit with successful push CI
        required: true
      expected_live_app_sha:
        description: Must be f274ad615550c83717aa7af2ad32339608e6f8aa
        required: true
      backup_run_id:
        description: Successful signed encrypted backup for this target_sha
        required: true
      confirmation:
        description: Type APPLY_BOOKING_SAFEUPDATE_202611050213
        required: true
`+source.slice(end);
  once("MAINTENANCE_MODE: ${{ inputs.maintenance_mode && 'maintenance' || 'off' }}",'MAINTENANCE_MODE: "off"');
  once('MAINTENANCE_OPERATION_ID: ${{ inputs.maintenance_operation_id }}','MAINTENANCE_OPERATION_ID: ""');
  once("EXPECTED_OLD_SHA: ${{ inputs.maintenance_mode && inputs.expected_live_app_sha || '' }}",'EXPECTED_OLD_SHA: ""');
  once('THROUGH_VERSION: ${{ inputs.through }}','THROUGH_VERSION: "202611050213"');
  once('FORWARD_REPAIR_CONFIRMED: ${{ inputs.forward_repair_confirmed }}','FORWARD_REPAIR_CONFIRMED: "false"');
  once('FORWARD_REPAIR_CONFIRMATION: ${{ inputs.forward_repair_confirmation }}','FORWARD_REPAIR_CONFIRMATION: ""');
  once('          MAINTENANCE_WINDOW_CONFIRMED: ${{ inputs.maintenance_window_confirmed }}\n','');
  once('test "$CONFIRMATION" = "APPLY_PRODUCTION_MIGRATIONS"','test "$CONFIRMATION" = "APPLY_BOOKING_SAFEUPDATE_202611050213"');
  once('          test "$MAINTENANCE_WINDOW_CONFIRMED" = "true"',
    '          test "$THROUGH_VERSION" = "202611050213"\n          test "$EXPECTED_LIVE_APP_SHA" = "f274ad615550c83717aa7af2ad32339608e6f8aa"');
  once('      - name: Verify Exact Current Main And Through Boundary',`      - name: Verify Pinned Booking Safeupdate Online Scope
        shell: bash
        run: node scripts/booking-safeupdate-online.mjs source

      - name: Verify Exact Current Main And Through Boundary`);
  once('          # The existing advisory lock serializes migration runners, not arbitrary DML.\n'+
    '          # The preflight-to-apply DML exclusion boundary is the operator-confirmed maintenance window.\n'+
    "          printf '%s\\n' '[migration] preflight-to-apply DML exclusion depends on the confirmed maintenance window' >&2",
    '          # The pinned migration holds the existing booking singleton lock and\n'+
    '          # verifies unchanged booking rows/control/ACLs inside its transaction.\n'+
    '          node scripts/booking-safeupdate-online.mjs dry-run "$dry_report_path"\n'+
    '          node scripts/booking-safeupdate-online.mjs prepare "$FAOLLA_REPORT_DIR" >&2');
  const plan='          node --env-file="$repository_dir/.env.local" \\\n            scripts/apply-production-database-migrations.mjs \\\n            --dry-run --through="$FAOLLA_THROUGH" --json > "$dry_report_path"';
  once(plan,'          node scripts/booking-safeupdate-online.mjs plan > "$dry_report_path"');
  const apply='          node --env-file="$repository_dir/.env.local" scripts/apply-production-database-migrations.mjs --apply --through="$FAOLLA_THROUGH" --json > "$apply_report_path"';
  once(apply,'          node scripts/booking-safeupdate-online.mjs apply "$FAOLLA_REPORT_DIR" > "$apply_report_path"\n          node scripts/booking-safeupdate-online.mjs verify "$FAOLLA_REPORT_DIR" >&2');
  // This lane pins the independent ACL forward repair to false. Remove only
  // its unreachable host postflight branch so the retained JIT shell program
  // remains below GitHub Actions' 21,000-character run-step limit.
  const inactive='          if [ "$FAOLLA_FORWARD_REPAIR_CONFIRMED" = "true" ]; then\n'+
    '            node --input-type=module - \\\n              "$apply_report_path" "$expected_container_name" <<\'NODE\'';
  const tail='          fi\n          assert_exact_source\n          assert_container\n          cat "$apply_report_path"';
  const begin=source.indexOf(inactive),endInactive=source.indexOf(tail,begin);
  assert.ok(begin>=0&&endInactive>begin,'inactive ACL branch template changed');
  source=source.slice(0,begin)+source.slice(endInactive+'          fi\n'.length);
  const oldSourceStart='          if [ "$FAOLLA_FORWARD_REPAIR_CONFIRMED" = "true" ]; then\n            node --input-type=module - <<\'NODE\'';
  const oldSourceEnd='          fi\n          node scripts/booking-safeupdate-online.mjs plan';
  const sourceBegin=source.indexOf(oldSourceStart),sourceEnd=source.indexOf(oldSourceEnd,sourceBegin);
  assert.ok(sourceBegin>=0&&sourceEnd>sourceBegin,'inactive ACL source branch template changed');
  source=source.slice(0,sourceBegin)+source.slice(sourceEnd+'          fi\n'.length);
  return source;
}
