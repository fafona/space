import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { verifyFrontendAuthProof } from "@/lib/frontendAuthProof.server";
import {
  buildPollSnapshot,
  buildPollSummary,
  findPublishedPollConfig,
  getPollConfigurationIssue,
  normalizeStoredPollBallot,
  validatePollAnswers,
  type PollStoredBallot,
} from "@/lib/merchantPolls";
import { isMerchantNumericId } from "@/lib/merchantIdentity";
import { resolvePersonalAccountSessionFromRequest } from "@/lib/personalAccountSession.server";
import { readPersonalCustomerProfileFromSession } from "@/lib/personalCustomerProfile";
import { hashPersonalGuestMergeToken } from "@/lib/personalGuestMerge.server";
import { fetchPublishedSiteBlocksFromSupabase } from "@/lib/publishedSiteData";
import { getTrustedMutationRequestErrorResponse, isTrustedSameOriginMutationRequest } from "@/lib/requestMutationGuard";
import { resolveMerchantSessionFromRequest } from "@/lib/serverMerchantSession";
import { createServerSupabaseServiceClient } from "@/lib/superAdminServer";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const POLL_BALLOT_PAGE_SIZE = 1000;
const POLL_BALLOT_READ_LIMIT = 50_000;

function trimText(value: unknown, maxLength = 4096) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function hashParticipantIdentity(value: string) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function createPollStore() {
  const client = createServerSupabaseServiceClient();
  if (!client) throw new Error("poll_store_unavailable");
  return client;
}

function getPollStoreErrorCode(error: unknown) {
  if (!error || typeof error !== "object") return "";
  const record = error as { code?: unknown; message?: unknown };
  return trimText(record.code, 80) || trimText(record.message, 300);
}

function isPollStoreUnavailable(error: unknown) {
  const code = getPollStoreErrorCode(error);
  return /poll_store_unavailable|42P01|PGRST205|merchant_poll_ballots/i.test(code);
}

async function loadPollBallots(siteId: string, pollId: string) {
  const client = createPollStore();
  const rows: unknown[] = [];
  for (let offset = 0; offset < POLL_BALLOT_READ_LIMIT; offset += POLL_BALLOT_PAGE_SIZE) {
    const result = await client
      .from("merchant_poll_ballots")
      .select("id,participant_type,participant_name,anonymous,answers,poll_snapshot,created_at")
      .eq("merchant_id", siteId)
      .eq("poll_id", pollId)
      .order("created_at", { ascending: true })
      .order("id", { ascending: true })
      .range(offset, offset + POLL_BALLOT_PAGE_SIZE - 1);
    if (result.error) throw result.error;
    const page = Array.isArray(result.data) ? result.data : [];
    rows.push(...page);
    if (page.length < POLL_BALLOT_PAGE_SIZE) break;
  }
  return rows.map(normalizeStoredPollBallot).filter((ballot): ballot is PollStoredBallot => Boolean(ballot));
}

function noStoreJson(body: unknown, init?: { status?: number }) {
  const response = NextResponse.json(body, init);
  response.headers.set("cache-control", "no-store");
  return response;
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const siteId = trimText(url.searchParams.get("siteId"), 64);
    const pollId = trimText(url.searchParams.get("pollId"), 96);
    if (!isMerchantNumericId(siteId) || !pollId) {
      return noStoreJson({ error: "invalid_poll_request" }, { status: 400 });
    }
    const session = await resolveMerchantSessionFromRequest(request, { hintedMerchantId: siteId });
    if (!session || session.merchantId !== siteId) {
      return noStoreJson({ error: "unauthorized" }, { status: 401 });
    }

    const [ballots, published] = await Promise.all([
      loadPollBallots(siteId, pollId),
      fetchPublishedSiteBlocksFromSupabase(siteId).catch(() => null),
    ]);
    const publishedPoll = published ? findPublishedPollConfig(published.blocks, pollId) : null;
    const summary = buildPollSummary(ballots, publishedPoll?.config.questions ?? [], { includeTextResponses: true });
    return noStoreJson({
      ok: true,
      pollId,
      published: Boolean(publishedPoll),
      summary,
      ballots,
      truncated: ballots.length >= POLL_BALLOT_READ_LIMIT,
    });
  } catch (error) {
    return noStoreJson(
      {
        error: isPollStoreUnavailable(error) ? "poll_store_unavailable" : "poll_results_load_failed",
        message: error instanceof Error ? error.message : getPollStoreErrorCode(error) || "unknown_error",
      },
      { status: isPollStoreUnavailable(error) ? 503 : 500 },
    );
  }
}

export async function POST(request: Request) {
  if (!isTrustedSameOriginMutationRequest(request)) {
    return getTrustedMutationRequestErrorResponse();
  }

  try {
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    const siteId = trimText(body?.siteId, 64);
    const pollId = trimText(body?.pollId, 96);
    const blockId = trimText(body?.blockId, 160);
    if (!isMerchantNumericId(siteId) || !pollId) {
      return noStoreJson({ error: "invalid_poll_request" }, { status: 400 });
    }

    const published = await fetchPublishedSiteBlocksFromSupabase(siteId);
    const publishedPoll = published ? findPublishedPollConfig(published.blocks, pollId, blockId) : null;
    if (!publishedPoll) {
      return noStoreJson({ error: "poll_not_published" }, { status: 404 });
    }
    const config = publishedPoll.config;
    const configurationIssue = getPollConfigurationIssue(config);
    if (configurationIssue) {
      return noStoreJson({ error: "invalid_poll_configuration", issue: configurationIssue }, { status: 409 });
    }
    if (config.status !== "open") {
      return noStoreJson({ error: "poll_closed" }, { status: 409 });
    }

    const validatedAnswers = validatePollAnswers(config, body?.answers);
    if (!validatedAnswers.ok) {
      return noStoreJson(
        { error: validatedAnswers.code, questionId: validatedAnswers.questionId ?? "" },
        { status: 400 },
      );
    }

    const personalSession = await resolvePersonalAccountSessionFromRequest(request).catch(() => null);
    const frontendProof = personalSession ? null : verifyFrontendAuthProof(body?.frontendAuthProof);
    const personalProof = frontendProof?.accountType === "personal" ? frontendProof : null;
    const personalProfile = personalSession
      ? readPersonalCustomerProfileFromSession({
          authenticated: true,
          accountType: "personal",
          accountId: personalSession.accountId,
          user: personalSession.user,
        })
      : null;
    const isMember = Boolean(personalSession || personalProof);
    const requestedAnonymous = body?.anonymous === true;
    const anonymous = config.allowAnonymous && requestedAnonymous;
    const fallbackMemberName =
      personalProfile?.name ||
      (personalSession?.email || personalProof?.email || "").split("@")[0] ||
      personalSession?.accountId ||
      personalProof?.accountId ||
      "";
    const participantName = anonymous ? "" : trimText(body?.participantName, 120) || trimText(fallbackMemberName, 120);
    if (!anonymous && !participantName) {
      return noStoreJson({ error: "participant_name_required" }, { status: 400 });
    }

    const memberIdentity = personalSession?.userId || personalProof?.userId || personalSession?.accountId || personalProof?.accountId || "";
    const participantKeyHash = isMember
      ? hashParticipantIdentity(`member:${memberIdentity}`)
      : hashPersonalGuestMergeToken(body?.guestToken);
    if (!participantKeyHash) {
      return noStoreJson({ error: "guest_identity_required" }, { status: 400 });
    }

    const client = createPollStore();
    const insertResult = await client
      .from("merchant_poll_ballots")
      .insert({
        merchant_id: siteId,
        poll_id: config.pollId,
        block_id: publishedPoll.blockId,
        participant_key_hash: participantKeyHash,
        participant_type: isMember ? "member" : "guest",
        participant_name: participantName,
        anonymous,
        answers: validatedAnswers.answers,
        poll_snapshot: buildPollSnapshot(config),
      })
      .select("id,participant_type,participant_name,anonymous,answers,poll_snapshot,created_at")
      .single();
    if (insertResult.error) {
      if (getPollStoreErrorCode(insertResult.error) === "23505") {
        return noStoreJson({ error: "already_voted" }, { status: 409 });
      }
      throw insertResult.error;
    }

    const ballot = normalizeStoredPollBallot(insertResult.data);
    let summary = null;
    if (config.showResultsAfterSubmit) {
      const ballots = await loadPollBallots(siteId, config.pollId);
      summary = buildPollSummary(ballots, config.questions);
    }
    return noStoreJson({ ok: true, ballot, summary }, { status: 201 });
  } catch (error) {
    return noStoreJson(
      {
        error: isPollStoreUnavailable(error) ? "poll_store_unavailable" : "poll_submit_failed",
        message: error instanceof Error ? error.message : getPollStoreErrorCode(error) || "unknown_error",
      },
      { status: isPollStoreUnavailable(error) ? 503 : 500 },
    );
  }
}
