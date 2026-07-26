import {
  buildMerchantConversationBackfillPlan,
  MERCHANT_CONVERSATION_BACKFILL_MAX_BATCH_SIZE,
} from "../src/lib/merchantConversationBackfill.server";
import { reconcileMerchantConversationStorage } from "../src/lib/merchantConversationReconciliation";
import {
  assertConversationWriteReady,
  createConversationRestRuntime,
  loadConversationV1,
  loadLegacyConversationSnapshots,
  requestConversationJson,
  trimConversationCliText,
} from "./conversation-v1-runtime";

type CliOptions = {
  accountId: string;
  batchSize: number;
  write: boolean;
  confirmation: string;
};

function readOptions(): CliOptions {
  const args = process.argv.slice(2);
  const knownArguments = args.filter(
    (value) =>
      value === "--write" ||
      value.startsWith("--site=") ||
      value.startsWith("--batch-size=") ||
      value.startsWith("--confirm="),
  );
  if (knownArguments.length !== args.length) {
    const unknown = args.filter((value) => !knownArguments.includes(value));
    throw new Error(`unknown_arguments:${unknown.join(",")}`);
  }
  const accountId = trimConversationCliText(
    args.find((value) => value.startsWith("--site="))?.slice("--site=".length),
  );
  if (!/^\d{8}$/.test(accountId)) {
    throw new Error(
      "a single numeric merchant id is required, for example --site=10000000",
    );
  }
  const batchText = trimConversationCliText(
    args
      .find((value) => value.startsWith("--batch-size="))
      ?.slice("--batch-size=".length),
  );
  const batchSize = batchText ? Number.parseInt(batchText, 10) : 10;
  if (
    (batchText && !/^\d+$/.test(batchText)) ||
    !Number.isInteger(batchSize) ||
    batchSize < 1 ||
    batchSize > MERCHANT_CONVERSATION_BACKFILL_MAX_BATCH_SIZE
  ) {
    throw new Error(
      `batch_size_must_be_between_1_and_${MERCHANT_CONVERSATION_BACKFILL_MAX_BATCH_SIZE}`,
    );
  }
  return {
    accountId,
    batchSize,
    write: args.includes("--write"),
    confirmation: trimConversationCliText(
      args
        .find((value) => value.startsWith("--confirm="))
        ?.slice("--confirm=".length),
    ),
  };
}

function assertWriteAuthorized(options: CliOptions) {
  if (!options.write) return;
  if (
    trimConversationCliText(
      process.env.CONVERSATION_V1_BACKFILL_WRITE_ENABLED,
    ).toLowerCase() !== "true"
  ) {
    throw new Error(
      "write_disabled:set_CONVERSATION_V1_BACKFILL_WRITE_ENABLED=true_for_this_command",
    );
  }
  if (options.confirmation !== options.accountId) {
    throw new Error(
      `merchant_confirmation_required:--confirm=${options.accountId}`,
    );
  }
}

async function main() {
  const options = readOptions();
  const runtime = createConversationRestRuntime();
  assertWriteAuthorized(options);
  const legacy = await loadLegacyConversationSnapshots(runtime);
  const plan = buildMerchantConversationBackfillPlan({
    accountId: options.accountId,
    ...legacy,
    batchSize: options.batchSize,
  });
  console.log(
    `[conversation-v1-backfill] account=${options.accountId} mode=${options.write ? "write" : "dry-run"} threads=${plan.threadCount} participants=${plan.participantCount} messages=${plan.messageCount} contacts=${plan.contactCount} cursors=${plan.readCursorCount} batches=${plan.batches.length} batch-size=${plan.batchSize} blockers=${plan.blockers.length}`,
  );
  if (plan.blockers.length > 0) {
    plan.blockers.slice(0, 30).forEach((blocker) => {
      console.error(
        `[conversation-v1-backfill] blocker record=${blocker.recordId} code=${blocker.code}`,
      );
    });
    process.exitCode = 2;
    return;
  }
  if (!options.write) {
    console.log(
      "[conversation-v1-backfill] dry-run complete; no database writes were attempted",
    );
    return;
  }

  await assertConversationWriteReady(runtime);
  for (let index = 0; index < plan.batches.length; index += 1) {
    const batch = plan.batches[index]!;
    const expectedCount =
      batch.threads.length +
      batch.contacts.length +
      batch.read_cursors.length +
      batch.archived_threads.length;
    const result = await requestConversationJson(
      runtime,
      "/rest/v1/rpc/faolla_upsert_merchant_conversations_v1",
      {
        method: "POST",
        body: JSON.stringify({ p_mutations: batch }),
      },
      30000,
    );
    if (Number(result) !== expectedCount) {
      throw new Error(
        `backfill_rpc_count_mismatch:expected=${expectedCount}:actual=${String(result)}`,
      );
    }
    console.log(
      `[conversation-v1-backfill] progress batch=${index + 1}/${plan.batches.length}`,
    );
  }

  const [latestLegacy, latestV1] = await Promise.all([
    loadLegacyConversationSnapshots(runtime),
    loadConversationV1(runtime, options.accountId),
  ]);
  const report = reconcileMerchantConversationStorage({
    accountId: options.accountId,
    ...latestLegacy,
    v1Threads: latestV1.threads,
    v1Participants: latestV1.participants,
    v1Messages: latestV1.messages,
    v1Contacts: latestV1.contacts,
    v1ReadCursors: latestV1.readCursors,
  });
  console.log(
    `[conversation-v1-backfill] reconciliation expected-threads=${report.expectedThreadCount} v1-threads=${report.v1ThreadCount} missing-threads=${report.missingThreads.length} unexpected-active=${report.unexpectedActiveThreads.length} missing-messages=${report.missingMessages.length} unexpected-messages=${report.unexpectedMessages.length} allowed-history=${report.allowedHistoricalMessages.length} missing-contacts=${report.missingContacts.length} missing-cursors=${report.missingReadCursors.length} mismatched=${report.mismatches.length}`,
  );
  if (!report.isMatch) {
    process.exitCode = 2;
    return;
  }
  console.log(
    "[conversation-v1-backfill] complete; legacy remains the source of truth",
  );
}

main().catch((error) => {
  console.error(
    `[conversation-v1-backfill] failed: ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exitCode = 1;
});
