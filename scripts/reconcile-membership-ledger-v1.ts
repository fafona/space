import { reconcileMerchantMembershipLedger } from "../src/lib/merchantMembershipLedgerReconciliation";
import {
  createMembershipLedgerRestRuntime,
  loadLegacyMemberships,
  loadMembershipLedgerV1,
  trimCliText,
} from "./membership-ledger-v1-runtime";

function readOptions() {
  const args = process.argv.slice(2);
  const knownArguments = args.filter(
    (value) => value.startsWith("--site=") || value.startsWith("--currency="),
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
  const currency = (
    trimCliText(
      args
        .find((value) => value.startsWith("--currency="))
        ?.slice("--currency=".length),
    ) ||
    trimCliText(process.env.MERCHANT_MEMBERSHIP_V1_STORED_VALUE_CURRENCY) ||
    "EUR"
  ).toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) throw new Error("currency_must_be_iso_4217");
  return { siteId, currency };
}

async function main() {
  const runtime = createMembershipLedgerRestRuntime();
  const options = readOptions();
  const [memberships, [customers, ledgerEntries]] = await Promise.all([
    loadLegacyMemberships(runtime, options.siteId),
    loadMembershipLedgerV1(runtime, options.siteId),
  ]);
  const report = reconcileMerchantMembershipLedger({
    merchantId: options.siteId,
    legacyMemberships: memberships,
    customers,
    ledgerEntries,
    currency: options.currency,
  });

  console.log(
    `[membership-ledger-v1-audit] merchant=${options.siteId} currency=${
      options.currency
    } legacy=${report.legacyMembershipCount} customers=${report.customerCount} ledger=${
      report.ledgerEntryCount
    } matched-customers=${report.matchedCustomerCount}`,
  );
  console.log(
    `[membership-ledger-v1-audit] missing-customers=${
      report.missingCustomerMembershipIds.length
    } unexpected-customers=${report.unexpectedCustomerMembershipIds.length} duplicate-customers=${
      report.duplicateCustomerMembershipIds.length
    } customer-mismatches=${report.customerMismatches.length}`,
  );
  console.log(
    `[membership-ledger-v1-audit] missing-transactions=${
      report.missingTransactionEntryKeys.length
    } unexpected-transactions=${report.unexpectedTransactionEntryKeys.length} entry-mismatches=${
      report.entryMismatches.length
    } balance-mismatches=${report.balanceMismatches.length}`,
  );

  report.balanceMismatches.slice(0, 20).forEach((mismatch) => {
    console.log(
      `[membership-ledger-v1-audit] balance-mismatch membership=${
        mismatch.membershipId
      } account=${mismatch.accountType} expected=${mismatch.expected} actual=${
        mismatch.actual
      }`,
    );
  });
  report.entryMismatches.slice(0, 20).forEach((mismatch) => {
    console.log(
      `[membership-ledger-v1-audit] entry-mismatch membership=${
        mismatch.membershipId
      } key=${mismatch.idempotencyKey} fields=${mismatch.fields.join(",")}`,
    );
  });
  if (!report.isMatch) process.exitCode = 2;
}

main().catch((error) => {
  console.error(
    `[membership-ledger-v1-audit] failed: ${
      error instanceof Error ? error.message : String(error)
    }`,
  );
  process.exitCode = 1;
});
