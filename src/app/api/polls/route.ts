import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { verifyFrontendAuthProof } from "@/lib/frontendAuthProof.server";
import {
  buildPollSnapshot,
  buildPollRoundOverviews,
  buildPollSummary,
  collectPublishedPollRounds,
  findPublishedPollConfig,
  getPollAvailability,
  getPollAudienceAccessError,
  getPollConfigurationIssue,
  getPollIdentityIds,
  hasActivePollMerchantMembership,
  normalizePollRoundBallotMetadata,
  normalizeStoredPollBallot,
  validatePollAnswers,
  type PublishedPollRound,
  type PollSubmissionSource,
  type PollStoredBallot,
} from "@/lib/merchantPolls";
import { isMerchantNumericId } from "@/lib/merchantIdentity";
import { getMerchantMembershipsSnapshot } from "@/lib/merchantMemberships.server";
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
const POLL_BALLOT_SELECT = "id,ballot_no,participant_type,participant_name,anonymous,answers,poll_snapshot,source,invalidated_at,invalidated_by,created_at";

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

function normalizePollSource(value: unknown): PollSubmissionSource | "" {
  if (value === "pc_web" || value === "mobile_web" || value === "contact_card") return value;
  return "";
}

async function resolveCanonicalPollId(siteId: string, aliases: string[]) {
  const normalizedAliases = [...new Set(aliases.map((value) => trimText(value, 96)).filter(Boolean))];
  if (normalizedAliases.length === 0) throw new Error("missing_poll_alias");
  const result = await createPollStore().rpc("resolve_merchant_poll_id", {
    p_merchant_id: siteId,
    p_aliases: normalizedAliases,
  });
  if (result.error) throw result.error;
  const pollId = trimText(result.data, 96);
  if (!/^TP\d{16}$/.test(pollId)) throw new Error("invalid_canonical_poll_id");
  return pollId;
}

async function resolvePublishedRounds(siteId: string, blocks: Parameters<typeof collectPublishedPollRounds>[0]) {
  const rounds = collectPublishedPollRounds(blocks);
  return Promise.all(rounds.map(async (round) => {
    const aliases = getPollIdentityIds(round.config);
    const pollId = await resolveCanonicalPollId(siteId, aliases);
    return {
      ...round,
      config: {
        ...round.config,
        pollId,
        legacyPollIds: [...new Set([...aliases, ...round.config.legacyPollIds].filter((value) => value !== pollId))],
      },
    } satisfies PublishedPollRound;
  }));
}

async function loadPollIdentity(siteId: string, requestedPollId: string, aliases: string[] = []) {
  let canonicalPollId = "";
  const requested = trimText(requestedPollId, 96);
  const candidates = [...new Set([requested, ...aliases].map((value) => trimText(value, 96)).filter(Boolean))];
  if (candidates.length > 1 || !/^TP\d{16}$/.test(requested)) {
    canonicalPollId = await resolveCanonicalPollId(siteId, candidates);
  } else {
    canonicalPollId = requested;
  }
  const aliasResult = await createPollStore()
    .from("merchant_poll_aliases")
    .select("alias_poll_id")
    .eq("merchant_id", siteId)
    .eq("poll_id", canonicalPollId);
  if (aliasResult.error) throw aliasResult.error;
  const storedAliases = Array.isArray(aliasResult.data)
    ? aliasResult.data.map((row) => trimText((row as { alias_poll_id?: unknown }).alias_poll_id, 96)).filter(Boolean)
    : [];
  return {
    pollId: canonicalPollId,
    aliases: [...new Set([canonicalPollId, ...candidates, ...storedAliases])],
  };
}

async function loadPollBallots(siteId: string, pollIds: string[]) {
  const client = createPollStore();
  const rows: unknown[] = [];
  const normalizedPollIds = [...new Set(pollIds.map((value) => trimText(value, 96)).filter(Boolean))];
  if (normalizedPollIds.length === 0) return [];
  for (let offset = 0; offset < POLL_BALLOT_READ_LIMIT; offset += POLL_BALLOT_PAGE_SIZE) {
    const result = await client
      .from("merchant_poll_ballots")
      .select(POLL_BALLOT_SELECT)
      .eq("merchant_id", siteId)
      .in("poll_id", normalizedPollIds)
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

async function loadPollRoundMetadata(siteId: string) {
  const client = createPollStore();
  const rows: unknown[] = [];
  for (let offset = 0; offset < POLL_BALLOT_READ_LIMIT; offset += POLL_BALLOT_PAGE_SIZE) {
    const result = await client
      .from("merchant_poll_ballots")
      .select("poll_id,block_id,anonymous,poll_snapshot,invalidated_at,created_at")
      .eq("merchant_id", siteId)
      .order("created_at", { ascending: false })
      .range(offset, offset + POLL_BALLOT_PAGE_SIZE - 1);
    if (result.error) throw result.error;
    const page = Array.isArray(result.data) ? result.data : [];
    rows.push(...page);
    if (page.length < POLL_BALLOT_PAGE_SIZE) break;
  }
  return rows
    .map(normalizePollRoundBallotMetadata)
    .filter((row): row is NonNullable<ReturnType<typeof normalizePollRoundBallotMetadata>> => Boolean(row));
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
    if (!isMerchantNumericId(siteId)) {
      return noStoreJson({ error: "invalid_poll_request" }, { status: 400 });
    }
    const session = await resolveMerchantSessionFromRequest(request, { hintedMerchantId: siteId });
    if (!session || session.merchantId !== siteId) {
      return noStoreJson({ error: "unauthorized" }, { status: 401 });
    }

    const publishedPromise = fetchPublishedSiteBlocksFromSupabase(siteId).catch(() => null);
    if (!pollId) {
      const [metadata, published] = await Promise.all([loadPollRoundMetadata(siteId), publishedPromise]);
      const publishedRounds = published ? await resolvePublishedRounds(siteId, published.blocks) : [];
      const canonicalByAlias = new Map<string, string>();
      for (const round of publishedRounds) {
        for (const alias of getPollIdentityIds(round.config)) canonicalByAlias.set(alias, round.config.pollId);
      }
      const unmappedPollIds = [...new Set(metadata.map((row) => row.pollId).filter((value) => !canonicalByAlias.has(value)))];
      await Promise.all(unmappedPollIds.map(async (legacyPollId) => {
        canonicalByAlias.set(legacyPollId, await resolveCanonicalPollId(siteId, [legacyPollId]));
      }));
      const normalizedMetadata = metadata.map((row) => ({
        ...row,
        pollId: canonicalByAlias.get(row.pollId) ?? row.pollId,
      }));
      const rounds = buildPollRoundOverviews(normalizedMetadata, publishedRounds);
      return noStoreJson({
        ok: true,
        rounds,
        totalRounds: rounds.length,
        totalBallots: rounds.reduce((total, round) => total + round.totalBallots, 0),
        truncated: normalizedMetadata.length >= POLL_BALLOT_READ_LIMIT,
      });
    }

    const published = await publishedPromise;
    const publishedRounds = published ? await resolvePublishedRounds(siteId, published.blocks) : [];
    const publishedPoll = publishedRounds.find((round) => getPollIdentityIds(round.config).includes(pollId)) ?? null;
    const identity = await loadPollIdentity(
      siteId,
      publishedPoll?.config.pollId ?? pollId,
      publishedPoll ? getPollIdentityIds(publishedPoll.config) : [],
    );
    const ballots = await loadPollBallots(siteId, identity.aliases);
    const summary = buildPollSummary(ballots, publishedPoll?.config.questions ?? [], { includeTextResponses: true });
    return noStoreJson({
      ok: true,
      pollId: identity.pollId,
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

export async function DELETE(request: Request) {
  if (!isTrustedSameOriginMutationRequest(request)) {
    return getTrustedMutationRequestErrorResponse();
  }

  try {
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    const siteId = trimText(body?.siteId, 64);
    const pollId = trimText(body?.pollId, 96);
    if (!isMerchantNumericId(siteId) || !pollId) {
      return noStoreJson({ error: "invalid_poll_request" }, { status: 400 });
    }

    const session = await resolveMerchantSessionFromRequest(request, { hintedMerchantId: siteId });
    if (!session || session.merchantId !== siteId) {
      return noStoreJson({ error: "unauthorized" }, { status: 401 });
    }

    const identity = await loadPollIdentity(siteId, pollId);
    const result = await createPollStore()
      .from("merchant_poll_ballots")
      .delete({ count: "exact" })
      .eq("merchant_id", siteId)
      .in("poll_id", identity.aliases);
    if (result.error) throw result.error;
    return noStoreJson({ ok: true, pollId: identity.pollId, deletedCount: result.count ?? 0 });
  } catch (error) {
    return noStoreJson(
      {
        error: isPollStoreUnavailable(error) ? "poll_store_unavailable" : "poll_results_delete_failed",
        message: error instanceof Error ? error.message : getPollStoreErrorCode(error) || "unknown_error",
      },
      { status: isPollStoreUnavailable(error) ? 503 : 500 },
    );
  }
}

export async function PATCH(request: Request) {
  if (!isTrustedSameOriginMutationRequest(request)) {
    return getTrustedMutationRequestErrorResponse();
  }

  try {
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    const siteId = trimText(body?.siteId, 64);
    const pollId = trimText(body?.pollId, 96);
    const ballotId = trimText(body?.ballotId, 128);
    const invalidated = body?.invalidated === true;
    if (!isMerchantNumericId(siteId) || !pollId || !ballotId) {
      return noStoreJson({ error: "invalid_poll_request" }, { status: 400 });
    }

    const session = await resolveMerchantSessionFromRequest(request, { hintedMerchantId: siteId });
    if (!session || session.merchantId !== siteId) {
      return noStoreJson({ error: "unauthorized" }, { status: 401 });
    }

    const identity = await loadPollIdentity(siteId, pollId);
    const result = await createPollStore()
      .from("merchant_poll_ballots")
      .update({
        invalidated_at: invalidated ? new Date().toISOString() : null,
        invalidated_by: invalidated ? session.merchantEmail || session.merchantId : null,
      })
      .eq("merchant_id", siteId)
      .eq("id", ballotId)
      .in("poll_id", identity.aliases)
      .select(POLL_BALLOT_SELECT)
      .maybeSingle();
    if (result.error) throw result.error;
    const ballot = normalizeStoredPollBallot(result.data);
    if (!ballot) return noStoreJson({ error: "poll_ballot_not_found" }, { status: 404 });
    return noStoreJson({ ok: true, pollId: identity.pollId, ballot });
  } catch (error) {
    return noStoreJson(
      {
        error: isPollStoreUnavailable(error) ? "poll_store_unavailable" : "poll_ballot_update_failed",
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
    if (body?.action === "allocate_poll_id") {
      if (!isMerchantNumericId(siteId)) {
        return noStoreJson({ error: "invalid_poll_request" }, { status: 400 });
      }
      const session = await resolveMerchantSessionFromRequest(request, { hintedMerchantId: siteId });
      if (!session || session.merchantId !== siteId) {
        return noStoreJson({ error: "unauthorized" }, { status: 401 });
      }
      const allocation = await createPollStore().rpc("allocate_merchant_poll_id", { p_merchant_id: siteId });
      if (allocation.error) throw allocation.error;
      const allocatedPollId = trimText(allocation.data, 96);
      if (!/^TP\d{16}$/.test(allocatedPollId)) throw new Error("invalid_allocated_poll_id");
      return noStoreJson({ ok: true, pollId: allocatedPollId }, { status: 201 });
    }
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
    const identity = await loadPollIdentity(siteId, publishedPoll.config.pollId, getPollIdentityIds(publishedPoll.config));
    const config = {
      ...publishedPoll.config,
      pollId: identity.pollId,
      legacyPollIds: identity.aliases.filter((value) => value !== identity.pollId),
    };
    const configurationIssue = getPollConfigurationIssue(config);
    if (configurationIssue) {
      return noStoreJson({ error: "invalid_poll_configuration", issue: configurationIssue }, { status: 409 });
    }
    const availability = getPollAvailability(config);
    if (availability === "scheduled") {
      return noStoreJson({ error: "poll_not_started", openAt: config.openAt }, { status: 409 });
    }
    if (availability !== "open") {
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
    const registeredIdentity = {
      accountId: personalSession?.accountId || personalProof?.accountId || "",
      userId: personalSession?.userId || personalProof?.userId || "",
      email: (personalSession?.email || personalProof?.email || "").trim().toLowerCase(),
    };
    const isRegistered = Boolean(registeredIdentity.accountId || registeredIdentity.userId);
    let isMerchantMember = false;
    if (config.audience === "merchant-members" && isRegistered) {
      const membershipSnapshot = await getMerchantMembershipsSnapshot(siteId, { applyScheduledRules: false });
      isMerchantMember = hasActivePollMerchantMembership(siteId, membershipSnapshot.memberships, registeredIdentity);
    }
    const audienceAccessError = getPollAudienceAccessError(config.audience, {
      registered: isRegistered,
      merchantMember: isMerchantMember,
    });
    if (audienceAccessError) {
      return noStoreJson(
        { error: audienceAccessError },
        { status: audienceAccessError === "registered_user_required" ? 401 : 403 },
      );
    }
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

    const accountIdentity = registeredIdentity.userId || registeredIdentity.accountId;
    const participantKeyHash = isRegistered
      ? hashParticipantIdentity(`member:${accountIdentity}`)
      : hashPersonalGuestMergeToken(body?.guestToken);
    if (!participantKeyHash) {
      return noStoreJson({ error: "guest_identity_required" }, { status: 400 });
    }

    const client = createPollStore();
    const existingBallot = await client
      .from("merchant_poll_ballots")
      .select("id")
      .eq("merchant_id", siteId)
      .eq("participant_key_hash", participantKeyHash)
      .in("poll_id", identity.aliases)
      .limit(1);
    if (existingBallot.error) throw existingBallot.error;
    if (Array.isArray(existingBallot.data) && existingBallot.data.length > 0) {
      return noStoreJson({ error: "already_voted" }, { status: 409 });
    }
    const source = normalizePollSource(body?.source);
    const insertResult = await client
      .from("merchant_poll_ballots")
      .insert({
        merchant_id: siteId,
        poll_id: config.pollId,
        block_id: publishedPoll.blockId,
        participant_key_hash: participantKeyHash,
        participant_type: isMerchantMember ? "member" : isRegistered ? "registered" : "guest",
        participant_name: participantName,
        anonymous,
        answers: validatedAnswers.answers,
        poll_snapshot: buildPollSnapshot(config),
        source: source || null,
      })
      .select(POLL_BALLOT_SELECT)
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
      const ballots = await loadPollBallots(siteId, identity.aliases);
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
