import {
  buildMerchantMembershipLedgerBackfillPlan,
  MERCHANT_MEMBERSHIP_BACKFILL_MAX_BATCH_SIZE,
} from "../src/lib/merchantMembershipLedgerBackfill.server";
import { reconcileMerchantMembershipLedger } from "../src/lib/merchantMembershipLedgerReconciliation";
import {
  assertMembershipLedgerWriteReady,
  createMembershipLedgerRestRuntime,
  loadLegacyMemberships,
  loadMembershipLedgerV1,
  requestMembershipLedgerJson,
  trimCliText,
} from "./membership-ledger-v1-runtime";

type CliOptions = {
  siteId: string;
  batchSize: number;
  currency: string;
  write: boolean;
  confirmation: string;
};

function normalizeCurrency(value: unknown) {
  const currency = trimCliText(value).toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) throw new Error("currency_must_be_iso_4217");
  return currency;
}

function readOptions(): CliOptions {
  const args = process.argv.slice(2);
  const knownArguments = args.filter(
    (value) =>
      value === "--write" ||
      value.startsWith("--site=") ||
      value.startsWith("--batch-size=") ||
      value.startsWith("--currency=") ||
      value.startsWith("--confirm="),
  );
  if (knownArguments.length !== args.length) {
    const unknown = args.filter((value) => !knownArguments.includes(value));
    throw new Error(`unknown_arguments:${unknown.join(",")}`);
  }

  const siteId = trimCliText(
    args.find((value) => value.startsWith("--site="))?.slice("--site=".length),
  );
  if (!/^\d{8}$/.test(siteId)) {
    throw new Error(
      "a single numeric merchant id is required, for example --site=10000000",
    );
  }
  const batchText = trimCliText(
    args
      .find((value) => value.startsWith("--batch-size="))
      ?.slice("--batch-size=".length),
  );
  const batchSize = batchText ? Number.parseInt(batchText, 10) : 20;
  if (
    (batchText && !/^\d+$/.test(batchText)) ||
    !Number.isInteger(batchSize) ||
    batchSize < 1 ||
    batchSize > MERCHANT_MEMBERSHIP_BACKFILL_MAX_BATCH_SIZE
  ) {
    throw new Error(
      `batch_size_must_be_between_1_and_${MERCHANT_MEMBERSHIP_BACKFILL_MAX_BATCH_SIZE}`,
    );
  }
  const requestedCurrency =
    trimCliText(
      args
        .find((value) => value.startsWith("--currency="))
        ?.slice("--currency=".length),
    ) ||
    trimCliText(process.env.MERCHANT_MEMBERSHIP_V1_STORED_VALUE_CURRENCY) ||
    "EUR";

  return {
    siteId,
    batchSize,
    currency: normalizeCurrency(requestedCurrency),
    write: args.includes("--write"),
    confirmation: trimCliText(
      args.find((value) => value.startsWith("--confirm="))?.slice("--confirm=".length),
    ),
  };
}

function assertWriteAuthorized(options: CliOptions) {
  if (!options.write) return;
  if (
    trimCliText(process.env.MEMBERSHIP_V1_BACKFILL_WRITE_ENABLED).toLowerCase() !==
    "true"
  ) {
    throw new Error(
      "write_disabled:set_MEMBERSHIP_V1_BACKFILL_WRITE_ENABLED=true_for_this_command",
    );
  }
  if (options.confirmation !== options.siteId) {
    throw new Error(`merchant_confirmation_required:--confirm=${options.siteId}`);
  }
}

async function writeBatch(
  runtime: ReturnType<typeof createMembershipLedgerRestRuntime>,
  mutations: ReturnType<typeof buildMerchantMembershipLedgerBackfillPlan>["batches"][number],
) {
  const expectedEntries = mutations.reduce(
    (sum, mutation) => sum + mutation.entries.length,
    0,
  );
  const result = await requestMembershipLedgerJson(
    runtime,
    "/rest/v1/rpc/faolla_upsert_merchant_membership_ledger_v1",
    {
      method: "POST",
      body: JSON.stringify({ p_mutations: mutations }),
    },
    30000,
  );
  const insertedEntries = Number(result);
  if (
    !Number.isInteger(insertedEntries) ||
    insertedEntries < 0 ||
    insertedEntries > expectedEntries
  ) {
    throw new Error(
      `backfill_rpc_count_invalid:maximum=${expectedEntries}:actual=${String(result)}`,
    );
  }
  return insertedEntries;
}

async function main() {
  const runtime = createMembershipLedgerRestRuntime();
  const options = readOptions();
  assertWriteAuthorized(options);

  const memberships = await loadLegacyMemberships(runtime, options.siteId);
  const plan = buildMerchantMembershipLedgerBackfillPlan({
    merchantId: options.siteId,
    memberships,
    batchSize: options.batchSize,
    currency: options.currency,
  });
  console.log(
    `[membership-ledger-v1-backfill] merchant=${options.siteId} mode=${
      options.write ? "write" : "dry-run"
    } currency=${options.currency} memberships=${plan.membershipCount} entries=${
      plan.entryCount
    } batches=${plan.batches.length} batch-size=${plan.batchSize} blockers=${
      plan.blockers.length
    }`,
  );

  if (plan.blockers.length > 0) {
    plan.blockers.slice(0, 20).forEach((blocker) => {
      console.error(
        `[membership-ledger-v1-backfill] blocker membership=${
          blocker.membershipId
        } transaction=${blocker.transactionId ?? "-"} code=${blocker.code}`,
      );
    });
    process.exitCode = 2;
    return;
  }
  if (!options.write) {
    console.log(
      "[membership-ledger-v1-backfill] dry-run complete; no database writes were attempted",
    );
    return;
  }

  await assertMembershipLedgerWriteReady(runtime);
  let completedMemberships = 0;
  let insertedEntries = 0;
  for (let index = 0; index < plan.batches.length; index += 1) {
    const batch = plan.batches[index] ?? [];
    insertedEntries += await writeBatch(runtime, batch);
    completedMemberships += batch.length;
    console.log(
      `[membership-ledger-v1-backfill] progress batch=${index + 1}/${
        plan.batches.length
      } memberships=${completedMemberships}/${plan.membershipCount} inserted-entries=${insertedEntries}`,
    );
  }

  const [latestMemberships, [customers, ledgerEntries]] = await Promise.all([
    loadLegacyMemberships(runtime, options.siteId),
    loadMembershipLedgerV1(runtime, options.siteId),
  ]);
  const report = reconcileMerchantMembershipLedger({
    merchantId: options.siteId,
    legacyMemberships: latestMemberships,
    customers,
    ledgerEntries,
    currency: options.currency,
  });
  console.log(
    `[membership-ledger-v1-backfill] reconciliation legacy=${
      report.legacyMembershipCount
    } customers=${report.customerCount} ledger=${report.ledgerEntryCount} missing-customers=${
      report.missingCustomerMembershipIds.length
    } missing-transactions=${report.missingTransactionEntryKeys.length} entry-mismatches=${
      report.entryMismatches.length
    } balance-mismatches=${report.balanceMismatches.length}`,
  );
  if (!report.isMatch) {
    process.exitCode = 2;
    return;
  }
  console.log(
    "[membership-ledger-v1-backfill] complete; legacy remains the source of truth",
  );
}

main().catch((error) => {
  console.error(
    `[membership-ledger-v1-backfill] failed: ${
      error instanceof Error ? error.message : String(error)
    }`,
  );
  process.exitCode = 1;
});
