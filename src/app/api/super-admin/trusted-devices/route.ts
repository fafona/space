import { NextResponse } from "next/server";
import { createServerSupabaseServiceClient } from "@/lib/superAdminServer";
import {
  loadSuperAdminTrustedDevicesFromStore,
  removeSuperAdminTrustedDevice,
  saveSuperAdminTrustedDevicesToStore,
} from "@/lib/superAdminTrustedDevices";
import { SUPER_ADMIN_SESSION_COOKIE, SUPER_ADMIN_SESSION_VALUE, SUPER_ADMIN_TRUSTED_DEVICE_COOKIE } from "@/lib/superAdminSession";
import { readSuperAdminTrustedDeviceToken } from "@/lib/superAdminVerification";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function parseCookieValue(cookieHeader: string, key: string) {
  return cookieHeader
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${key}=`))
    ?.slice(key.length + 1) ?? "";
}

function unauthorizedJson() {
  return NextResponse.json({ error: "unauthorized" }, { status: 401 });
}

function ensureAuthorized(request: Request) {
  const cookieHeader = request.headers.get("cookie") ?? "";
  return parseCookieValue(cookieHeader, SUPER_ADMIN_SESSION_COOKIE) === SUPER_ADMIN_SESSION_VALUE;
}

export async function GET(request: Request) {
  if (!ensureAuthorized(request)) {
    return unauthorizedJson();
  }

  const supabase = createServerSupabaseServiceClient();
  if (!supabase) {
    return NextResponse.json({ error: "super_admin_trusted_devices_env_missing" }, { status: 503 });
  }

  try {
    const { devices } = await loadSuperAdminTrustedDevicesFromStore(supabase);
    return NextResponse.json({ items: devices });
  } catch (error) {
    return NextResponse.json(
      {
        error: "super_admin_trusted_devices_load_failed",
        message: error instanceof Error ? error.message : "unknown_error",
      },
      { status: 500 },
    );
  }
}

export async function DELETE(request: Request) {
  if (!ensureAuthorized(request)) {
    return unauthorizedJson();
  }

  const supabase = createServerSupabaseServiceClient();
  if (!supabase) {
    return NextResponse.json({ error: "super_admin_trusted_devices_env_missing" }, { status: 503 });
  }

  try {
    const payload = (await request.json().catch(() => null)) as { deviceId?: unknown } | null;
    const deviceId = typeof payload?.deviceId === "string" ? payload.deviceId.trim() : "";
    if (!deviceId) {
      return NextResponse.json({ error: "invalid_device_id" }, { status: 400 });
    }

    const { rowId, devices } = await loadSuperAdminTrustedDevicesFromStore(supabase);
    const nextDevices = removeSuperAdminTrustedDevice(devices, deviceId);
    if (nextDevices.length === devices.length) {
      return NextResponse.json({ error: "device_not_found" }, { status: 404 });
    }

    await saveSuperAdminTrustedDevicesToStore(supabase, rowId, nextDevices);

    const response = NextResponse.json({ ok: true, deviceId });
    const currentDeviceToken = parseCookieValue(request.headers.get("cookie") ?? "", SUPER_ADMIN_TRUSTED_DEVICE_COOKIE);
    const currentDevice = readSuperAdminTrustedDeviceToken(currentDeviceToken);
    if (currentDevice?.deviceId === deviceId) {
      response.cookies.set(SUPER_ADMIN_TRUSTED_DEVICE_COOKIE, "", {
        path: "/",
        maxAge: 0,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
        httpOnly: true,
      });
    }
    return response;
  } catch (error) {
    return NextResponse.json(
      {
        error: "super_admin_trusted_devices_delete_failed",
        message: error instanceof Error ? error.message : "unknown_error",
      },
      { status: 500 },
    );
  }
}
