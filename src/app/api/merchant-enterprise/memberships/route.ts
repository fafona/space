import { NextResponse } from "next/server";
import {
  MerchantEnterpriseAccessError,
  resolveValidatedMerchantEnterpriseAuthUser,
  toMerchantEnterpriseAccessResponse,
} from "@/lib/merchantEnterpriseAuth.server";
import {
  buildMerchantEnterpriseMembershipList,
  loadMerchantEnterpriseMembershipRecords,
  type MerchantEnterpriseMembershipRecord,
  type MerchantEnterpriseMembershipSiteSource,
} from "@/lib/merchantEnterpriseMemberships.server";
import { loadAuthoritativeCurrentMerchantSnapshotSites } from "@/lib/publishedMerchantService";
import { createServerSupabaseServiceClient } from "@/lib/superAdminServer";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const RESPONSE_HEADERS = {
  "Cache-Control": "private, no-store",
} as const;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type MerchantEnterpriseMembershipsRouteDependencies = {
  resolveAuthUser: (
    request: Request,
  ) => Promise<{ id?: unknown } | null>;
  loadMemberships: (
    authUserId: string,
  ) => Promise<MerchantEnterpriseMembershipRecord[]>;
  loadCurrentSites: () => Promise<MerchantEnterpriseMembershipSiteSource[]>;
};

async function loadMemberships(authUserId: string) {
  const client = createServerSupabaseServiceClient();
  if (!client) {
    throw new MerchantEnterpriseAccessError(
      "enterprise_store_unavailable",
      503,
    );
  }
  return loadMerchantEnterpriseMembershipRecords(client, authUserId);
}

const DEFAULT_DEPENDENCIES: MerchantEnterpriseMembershipsRouteDependencies = {
  resolveAuthUser: resolveValidatedMerchantEnterpriseAuthUser,
  loadMemberships,
  loadCurrentSites: loadAuthoritativeCurrentMerchantSnapshotSites,
};

function text(value: unknown, maxLength = 4096) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function response(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: RESPONSE_HEADERS,
  });
}

function fail(error: unknown) {
  const resolved = toMerchantEnterpriseAccessResponse(error);
  return response(resolved.body, resolved.status);
}

function requireExplicitEnterpriseAccessToken(request: Request) {
  if (
    !request.headers.has("x-merchant-access-token") ||
    !text(request.headers.get("x-merchant-access-token"), 16_384)
  ) {
    throw new MerchantEnterpriseAccessError("unauthorized", 401);
  }
}

export async function handleMerchantEnterpriseMembershipsGet(
  request: Request,
  dependencyOverrides: Partial<MerchantEnterpriseMembershipsRouteDependencies> = {},
) {
  const dependencies = { ...DEFAULT_DEPENDENCIES, ...dependencyOverrides };
  try {
    requireExplicitEnterpriseAccessToken(request);
    const user = await dependencies.resolveAuthUser(request);
    const authUserId = text(user?.id, 80);
    if (!UUID_PATTERN.test(authUserId)) {
      throw new MerchantEnterpriseAccessError("unauthorized", 401);
    }

    let membershipList;
    try {
      const [memberships, sites] = await Promise.all([
        dependencies.loadMemberships(authUserId),
        dependencies.loadCurrentSites(),
      ]);
      membershipList = buildMerchantEnterpriseMembershipList(
        memberships,
        sites,
      );
    } catch (error) {
      if (error instanceof MerchantEnterpriseAccessError) throw error;
      throw new MerchantEnterpriseAccessError(
        "enterprise_memberships_unavailable",
        503,
      );
    }

    return response({
      ok: true,
      memberships: membershipList,
    });
  } catch (error) {
    return fail(error);
  }
}

export async function GET(request: Request) {
  return handleMerchantEnterpriseMembershipsGet(request);
}
