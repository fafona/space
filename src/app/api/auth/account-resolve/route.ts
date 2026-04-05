import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function normalizeAccountValue(value: string | null | undefined) {
  return String(value ?? "").trim().toLowerCase();
}

export async function POST(request: Request) {
  const payload = (await request.json().catch(() => null)) as { account?: unknown } | null;
  const account = typeof payload?.account === "string" ? payload.account.trim() : "";
  const normalizedAccount = normalizeAccountValue(account);

  if (!normalizedAccount) {
    return NextResponse.json({ error: "invalid_account" }, { status: 400 });
  }

  // Keep this endpoint generic so it cannot be used to enumerate merchant ids or emails.
  return NextResponse.json({ ok: true });
}
