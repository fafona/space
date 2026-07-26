import { buildMerchantConversationBackfillPlan } from "../src/lib/merchantConversationBackfill.server";
import { reconcileMerchantConversationStorage } from "../src/lib/merchantConversationReconciliation";
import {
  createConversationRestRuntime,
  loadConversationV1,
  loadLegacyConversationSnapshots,
  trimConversationCliText,
} from "./conversation-v1-runtime";

function readAccountId() {
  const args = process.argv.slice(2);
  if (args.length !== 1 || !args[0]?.startsWith("--site=")) {
    throw new Error(
      "a single numeric merchant id is required, for example --site=10000000",
    );
  }
  const accountId = trimConversationCliText(
    args[0].slice("--site=".length),
  );
  if (!/^\d{8}$/.test(accountId)) {
    throw new Error(
      "a single numeric merchant id is required, for example --site=10000000",
    );
  }
  return accountId;
}

async function main() {
  const accountId = readAccountId();
  const runtime = createConversationRestRuntime();
  const legacy = await loadLegacyConversationSnapshots(runtime);
  const plan = buildMerchantConversationBackfillPlan({
    accountId,
    ...legacy,
  });
  if (plan.blockers.length > 0) {
    console.error(
      `[conversation-v1-audit] account=${accountId} legacy-blockers=${plan.blockers.length}`,
    );
    plan.blockers.slice(0, 30).forEach((blocker) => {
      console.error(
        `[conversation-v1-audit] blocker record=${blocker.recordId} code=${blocker.code}`,
      );
    });
    process.exitCode = 2;
    return;
  }
  const v1 = await loadConversationV1(runtime, accountId);
  const report = reconcileMerchantConversationStorage({
    accountId,
    ...legacy,
    v1Threads: v1.threads,
    v1Participants: v1.participants,
    v1Messages: v1.messages,
    v1Contacts: v1.contacts,
    v1ReadCursors: v1.readCursors,
  });
  console.log(
    `[conversation-v1-audit] account=${accountId} expected-threads=${report.expectedThreadCount} v1-threads=${report.v1ThreadCount} missing-threads=${report.missingThreads.length} unexpected-active=${report.unexpectedActiveThreads.length} allowed-archived=${report.allowedArchivedThreads.length} missing-participants=${report.missingParticipants.length} missing-messages=${report.missingMessages.length} unexpected-messages=${report.unexpectedMessages.length} allowed-history=${report.allowedHistoricalMessages.length} missing-contacts=${report.missingContacts.length} contacts-without-customer=${report.contactsWithoutCustomer.length} missing-cursors=${report.missingReadCursors.length} mismatched=${report.mismatches.length}`,
  );
  report.mismatches.slice(0, 30).forEach((mismatch) => {
    console.log(
      `[conversation-v1-audit] mismatch entity=${mismatch.entity} record=${mismatch.recordId} fields=${mismatch.fields.join(",")}`,
    );
  });
  if (!report.isMatch) process.exitCode = 2;
}

main().catch((error) => {
  console.error(
    `[conversation-v1-audit] failed: ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exitCode = 1;
});
