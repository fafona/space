"use client";

import { useCallback, useEffect, useMemo, useState, type ChangeEvent } from "react";
import {
  normalizeMerchantMembershipProfileDraft,
  readPersonalMembershipCardsFromUserMetadata,
  type MerchantMembershipProfileDraft,
  type PersonalMembershipCard,
} from "@/lib/merchantMemberships";
import type { MerchantCookieSessionPayload } from "@/lib/authSessionRecovery";

type MerchantMembershipEntryProps = {
  siteId: string;
  siteName?: string;
  className?: string;
};

type PersonalMembershipsPayload = {
  ok?: unknown;
  memberships?: PersonalMembershipCard[];
  profile?: Partial<MerchantMembershipProfileDraft> | null;
};

type MembershipMutationPayload = {
  ok?: unknown;
  membership?: PersonalMembershipCard;
  message?: unknown;
};

const MEMBERSHIP_CHANGED_MESSAGE = "faolla:membership-changed";
const MONTH_OPTIONS = Array.from({ length: 12 }, (_, index) => String(index + 1).padStart(2, "0"));
const DAY_OPTIONS = Array.from({ length: 31 }, (_, index) => String(index + 1).padStart(2, "0"));

const EMPTY_MEMBER_PROFILE: MerchantMembershipProfileDraft = {
  nickname: "",
  name: "",
  phone: "",
  email: "",
  avatarUrl: "",
  birthday: "",
  birthdayMonthDayOnly: false,
  gender: "",
  country: "",
  province: "",
  city: "",
  address: "",
  taxName: "",
  taxNumber: "",
  taxCountry: "",
  taxProvince: "",
  taxCity: "",
  taxAddress: "",
  allergens: [],
};

function trimText(value: unknown, maxLength = 4096) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function buildPersonalLoginHref() {
  if (typeof window === "undefined") return "/login?accountType=personal";
  const loginFrom = window.location.href;
  return `/login?accountType=personal&loginFrom=${encodeURIComponent(loginFrom)}`;
}

function redirectToPersonalLogin() {
  if (typeof window === "undefined") return;
  const href = buildPersonalLoginHref();
  try {
    if (window.top && window.top !== window) {
      window.top.location.assign(href);
      return;
    }
  } catch {
    // Cross-origin frames fall back to navigating the current frame.
  }
  window.location.assign(href);
}

function readPayloadMessage(value: unknown, fallback: string) {
  const message = trimText(value);
  return message || fallback;
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function readStringFromRecord(record: Record<string, unknown> | null | undefined, ...keys: string[]) {
  for (const key of keys) {
    const value = record?.[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function readBooleanFromRecord(record: Record<string, unknown> | null | undefined, ...keys: string[]) {
  for (const key of keys) {
    const value = record?.[key];
    if (typeof value === "boolean") return value;
    if (typeof value === "string") {
      const normalized = value.trim().toLowerCase();
      if (["1", "true", "yes", "on"].includes(normalized)) return true;
      if (["0", "false", "no", "off"].includes(normalized)) return false;
    }
  }
  return false;
}

function normalizeMonthDay(value: string) {
  const match = value.trim().match(/^(\d{1,2})[/-](\d{1,2})$/);
  if (!match) return "";
  const month = Number.parseInt(match[1] ?? "", 10);
  const day = Number.parseInt(match[2] ?? "", 10);
  if (!Number.isFinite(month) || !Number.isFinite(day) || month < 1 || month > 12 || day < 1 || day > 31) return "";
  return `${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function extractMonthDay(value: string) {
  const normalized = value.trim().replace(/\//g, "-");
  const dateMatch = normalized.match(/^\d{4}-(\d{1,2})-(\d{1,2})$/);
  if (dateMatch) return normalizeMonthDay(`${dateMatch[1]}-${dateMatch[2]}`);
  return normalizeMonthDay(normalized);
}

function normalizeFullDate(value: string) {
  const normalized = value.trim().replace(/\//g, "-");
  const match = normalized.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (!match) return "";
  const year = Number.parseInt(match[1] ?? "", 10);
  const month = Number.parseInt(match[2] ?? "", 10);
  const day = Number.parseInt(match[3] ?? "", 10);
  if (!Number.isFinite(year) || year < 1900 || year > 9999) return "";
  if (!Number.isFinite(month) || month < 1 || month > 12) return "";
  if (!Number.isFinite(day) || day < 1 || day > 31) return "";
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function readMonthDayParts(value: string) {
  const normalized = normalizeMonthDay(value) || "06-15";
  const [month = "06", day = "15"] = normalized.split("-");
  return { month, day };
}

function escapeCssUrl(value: string) {
  return value.replace(/["\\\n\r]/g, (match) => encodeURIComponent(match));
}

function readAvatarInitial(profile: MerchantMembershipProfileDraft) {
  const label = profile.nickname || profile.name || profile.email || "会";
  return label.trim().slice(0, 1).toUpperCase() || "会";
}

function normalizeProfileDraftForSubmit(draft: MerchantMembershipProfileDraft): MerchantMembershipProfileDraft {
  return normalizeMerchantMembershipProfileDraft({
    ...draft,
    nickname: trimText(draft.nickname, 120),
    name: trimText(draft.name, 120),
    phone: trimText(draft.phone, 80),
    email: trimText(draft.email, 320).toLowerCase(),
    birthday: draft.birthdayMonthDayOnly ? normalizeMonthDay(draft.birthday) : trimText(draft.birthday, 32),
    taxName: trimText(draft.taxName, 160),
    taxNumber: trimText(draft.taxNumber, 120),
    taxCountry: trimText(draft.taxCountry, 80),
    taxProvince: trimText(draft.taxProvince, 80),
    taxCity: trimText(draft.taxCity, 80),
    taxAddress: trimText(draft.taxAddress, 240),
  });
}

function readProfileFromAuthPayload(payload: MerchantCookieSessionPayload | null | undefined) {
  const user = payload?.user ?? null;
  const metadata = readRecord(user?.user_metadata);
  const appMetadata = readRecord(user?.app_metadata);
  const profile = readRecord(metadata?.personal_profile);
  const email = trimText(user?.email, 320).toLowerCase();
  return normalizeMerchantMembershipProfileDraft(profile, {
    nickname:
      readStringFromRecord(profile, "nickname", "displayName", "display_name", "name", "username") ||
      readStringFromRecord(metadata, "nickname", "displayName", "display_name", "name", "username") ||
      readStringFromRecord(appMetadata, "nickname", "displayName", "display_name", "name", "username") ||
      (email.includes("@") ? email.split("@")[0] ?? "" : ""),
    name:
      readStringFromRecord(profile, "name", "displayName", "display_name", "username") ||
      readStringFromRecord(metadata, "name", "displayName", "display_name", "username") ||
      readStringFromRecord(appMetadata, "name", "displayName", "display_name", "username") ||
      (email.includes("@") ? email.split("@")[0] ?? "" : ""),
    phone:
      readStringFromRecord(profile, "phone", "contact_phone", "contactPhone") ||
      readStringFromRecord(metadata, "phone", "contact_phone", "contactPhone"),
    email: readStringFromRecord(profile, "email", "contact_email", "contactEmail") || readStringFromRecord(metadata, "email") || email,
    avatarUrl:
      readStringFromRecord(profile, "avatarUrl", "avatar_url") ||
      readStringFromRecord(metadata, "avatarUrl", "avatar_url", "personalAvatarUrl", "chatAvatarImageUrl"),
    birthday: readStringFromRecord(profile, "birthday", "birthdate") || readStringFromRecord(metadata, "birthday", "birthdate"),
    birthdayMonthDayOnly:
      readBooleanFromRecord(profile, "birthdayMonthDayOnly", "birthday_month_day_only") ||
      readBooleanFromRecord(metadata, "birthdayMonthDayOnly", "birthday_month_day_only"),
    gender: readStringFromRecord(profile, "gender") || readStringFromRecord(metadata, "gender"),
    country: readStringFromRecord(profile, "country") || readStringFromRecord(metadata, "country"),
    province: readStringFromRecord(profile, "province", "state") || readStringFromRecord(metadata, "province", "state"),
    city: readStringFromRecord(profile, "city") || readStringFromRecord(metadata, "city"),
    address: readStringFromRecord(profile, "address", "contactAddress") || readStringFromRecord(metadata, "address", "contactAddress"),
    taxName: readStringFromRecord(profile, "taxName", "invoiceName") || readStringFromRecord(metadata, "taxName", "invoiceName"),
    taxNumber:
      readStringFromRecord(profile, "taxNumber", "invoiceTaxNumber") ||
      readStringFromRecord(metadata, "taxNumber", "invoiceTaxNumber"),
    taxCountry:
      readStringFromRecord(profile, "taxCountry", "invoiceCountry") ||
      readStringFromRecord(metadata, "taxCountry", "invoiceCountry"),
    taxProvince:
      readStringFromRecord(profile, "taxProvince", "invoiceProvince") ||
      readStringFromRecord(metadata, "taxProvince", "invoiceProvince"),
    taxCity:
      readStringFromRecord(profile, "taxCity", "invoiceCity") ||
      readStringFromRecord(metadata, "taxCity", "invoiceCity"),
    taxAddress:
      readStringFromRecord(profile, "taxAddress", "invoiceAddress") ||
      readStringFromRecord(metadata, "taxAddress", "invoiceAddress"),
  });
}

async function resolveDeferredFrontendAuthPayload(timeoutMs: number) {
  const { requestParentFrontendAuthPayload } = await import("@/lib/frontendAuthBridge");
  const parentPayload = await requestParentFrontendAuthPayload(Math.max(800, Math.min(6200, timeoutMs))).catch(() => null);
  if (parentPayload?.authenticated === true && parentPayload.accountType === "personal") return parentPayload;

  const { resolveFrontendAuthPayload } = await import("@/lib/authSessionRecovery");
  return resolveFrontendAuthPayload(timeoutMs);
}

function notifyMembershipChanged(membership: PersonalMembershipCard) {
  if (typeof window === "undefined") return;
  const detail = { membership };
  try {
    window.dispatchEvent(new CustomEvent(MEMBERSHIP_CHANGED_MESSAGE, { detail }));
  } catch {
    // Ignore event dispatch failures in older embedded browsers.
  }
  try {
    if (window.parent && window.parent !== window) {
      window.parent.postMessage({ type: MEMBERSHIP_CHANGED_MESSAGE, ...detail }, "*");
    }
  } catch {
    // The parent notification is a refresh hint only.
  }
}

export default function MerchantMembershipEntry({ siteId, siteName = "", className = "" }: MerchantMembershipEntryProps) {
  const [resolved, setResolved] = useState(false);
  const [authenticated, setAuthenticated] = useState<boolean | null>(null);
  const [membership, setMembership] = useState<PersonalMembershipCard | null>(null);
  const [personalProfile, setPersonalProfile] = useState<MerchantMembershipProfileDraft>(EMPTY_MEMBER_PROFILE);
  const [profileDraft, setProfileDraft] = useState<MerchantMembershipProfileDraft>(EMPTY_MEMBER_PROFILE);
  const [birthdayFullBackup, setBirthdayFullBackup] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const normalizedSiteId = siteId.trim();
  const joinable = /^\d{8}$/.test(normalizedSiteId);
  const active = membership?.status === "active";
  const memberAvatarUrl = trimText(personalProfile.avatarUrl, 1200);
  const memberAvatarInitial = useMemo(() => readAvatarInitial(personalProfile), [personalProfile]);
  const buttonLabel = useMemo(() => {
    if (busy) return "处理中...";
    if (membership?.status === "left") return "重新加入";
    return "加入";
  }, [busy, membership?.status]);

  const applyAuthPayload = useCallback(
    (payload: MerchantCookieSessionPayload | null | undefined) => {
      if (payload?.authenticated !== true || payload.accountType !== "personal") return false;
      const memberships = readPersonalMembershipCardsFromUserMetadata(payload.user?.user_metadata ?? {});
      const current = memberships.find((item) => item.siteId === normalizedSiteId) ?? null;
      const profile = readProfileFromAuthPayload(payload);
      setAuthenticated(true);
      setMembership(current);
      setPersonalProfile(profile);
      setProfileDraft(profile);
      setBirthdayFullBackup(profile.birthdayMonthDayOnly ? "" : normalizeFullDate(profile.birthday));
      setResolved(true);
      return true;
    },
    [normalizedSiteId],
  );

  useEffect(() => {
    if (!joinable) return;
    let cancelled = false;

    void resolveDeferredFrontendAuthPayload(4200)
      .then(async (authPayload) => {
        if (cancelled) return;
        if (applyAuthPayload(authPayload)) return;

        const response = await fetch(`/api/personal-memberships?siteId=${encodeURIComponent(normalizedSiteId)}`, {
          method: "GET",
          cache: "no-store",
          credentials: "same-origin",
          headers: {
            accept: "application/json",
          },
        });
        if (cancelled) return;
        if (response.status === 401) {
          setAuthenticated(false);
          setResolved(true);
          return;
        }
        const payload = (await response.json().catch(() => null)) as PersonalMembershipsPayload | null;
        const current = Array.isArray(payload?.memberships) ? payload.memberships[0] ?? null : null;
        const profile = normalizeMerchantMembershipProfileDraft(payload?.profile, EMPTY_MEMBER_PROFILE);
        setAuthenticated(true);
        setMembership(current);
        setPersonalProfile(profile);
        setProfileDraft(profile);
        setBirthdayFullBackup(profile.birthdayMonthDayOnly ? "" : normalizeFullDate(profile.birthday));
        setResolved(true);
      })
      .catch(() => {
        if (!cancelled) setResolved(true);
      });
    return () => {
      cancelled = true;
    };
  }, [applyAuthPayload, joinable, normalizedSiteId]);

  function updateProfileDraft(field: keyof MerchantMembershipProfileDraft, value: string) {
    setProfileDraft((current) => ({ ...current, [field]: value }));
  }

  function handleInputChange(field: keyof MerchantMembershipProfileDraft) {
    return (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
      updateProfileDraft(field, event.target.value);
    };
  }

  function setBirthdayMonthDay(part: "month" | "day", value: string) {
    setProfileDraft((current) => {
      const currentParts = readMonthDayParts(current.birthday);
      return {
        ...current,
        birthday: `${part === "month" ? value : currentParts.month}-${part === "day" ? value : currentParts.day}`,
      };
    });
  }

  async function openJoinDialog() {
    if (!joinable || busy || active) return;
    if (authenticated !== true) {
      setMessage("正在确认登录状态...");
      const latestAuthPayload = await resolveDeferredFrontendAuthPayload(6200).catch(() => null);
      if (applyAuthPayload(latestAuthPayload)) {
        const profile = readProfileFromAuthPayload(latestAuthPayload);
        setMessage("");
        setProfileDraft(profile);
        setBirthdayFullBackup(profile.birthdayMonthDayOnly ? "" : normalizeFullDate(profile.birthday));
        setDialogOpen(true);
        return;
      }
      setResolved(true);
      setAuthenticated(false);
      redirectToPersonalLogin();
      return;
    }
    setMessage("");
    setProfileDraft(personalProfile);
    setBirthdayFullBackup(personalProfile.birthdayMonthDayOnly ? "" : normalizeFullDate(personalProfile.birthday));
    setDialogOpen(true);
  }

  async function handleJoin() {
    if (!joinable || busy || active) return;
    setBusy(true);
    setMessage("");
    try {
      const submitProfile = normalizeProfileDraftForSubmit(profileDraft);
      if (!submitProfile.nickname) {
        throw new Error("请填写昵称");
      }
      if (!submitProfile.phone) {
        throw new Error("请填写手机");
      }
      if (!submitProfile.email) {
        throw new Error("请填写邮箱");
      }
      if (!submitProfile.birthday || (submitProfile.birthdayMonthDayOnly && !normalizeMonthDay(submitProfile.birthday))) {
        throw new Error(submitProfile.birthdayMonthDayOnly ? "请填写生日月日" : "请填写生日");
      }
      const latestAuthPayload = await resolveDeferredFrontendAuthPayload(2600).catch(() => null);
      if (latestAuthPayload?.authenticated === true && latestAuthPayload.accountType === "personal") {
        const nextProfile = readProfileFromAuthPayload(latestAuthPayload);
        setAuthenticated(true);
        setPersonalProfile(nextProfile);
      }
      const response = await fetch("/api/memberships", {
        method: "POST",
        cache: "no-store",
        credentials: "same-origin",
        headers: {
          "Content-Type": "application/json",
          accept: "application/json",
        },
        body: JSON.stringify({
          siteId: normalizedSiteId,
          siteName,
          profile: submitProfile,
        }),
      });
      if (response.status === 401) {
        throw new Error("当前登录态未同步，请关闭弹窗后刷新 Faolla 再试");
      }
      const payload = (await response.json().catch(() => null)) as MembershipMutationPayload | null;
      if (!response.ok || payload?.ok !== true || !payload.membership) {
        throw new Error(readPayloadMessage(payload?.message, "加入失败，请稍后重试"));
      }
      setMembership(payload.membership);
      setPersonalProfile(submitProfile);
      setProfileDraft(submitProfile);
      setDialogOpen(false);
      setMessage("已加入");
      notifyMembershipChanged(payload.membership);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "加入失败，请稍后重试");
    } finally {
      setBusy(false);
    }
  }

  if (!joinable) return null;

  return (
    <div className={className}>
      <button
        type="button"
        className={`inline-flex items-center justify-center overflow-hidden rounded-full border text-sm font-semibold shadow-[0_12px_30px_rgba(15,23,42,0.12)] backdrop-blur transition disabled:cursor-default ${
          active
            ? "h-12 w-12 border-white/80 bg-white/95 p-1 text-slate-900"
            : "border-slate-200/80 bg-white/90 px-4 py-2 text-slate-900 hover:bg-white"
        }`}
        aria-label={active ? "会员头像" : buttonLabel}
        aria-busy={!resolved || busy}
        title={active ? "已是会员" : undefined}
        onClick={() => {
          void openJoinDialog();
        }}
        disabled={busy || active}
      >
        {active ? (
          <span
            className="flex h-full w-full items-center justify-center rounded-full bg-slate-950 bg-cover bg-center text-sm font-semibold text-white"
            style={memberAvatarUrl ? { backgroundImage: `url(\"${escapeCssUrl(memberAvatarUrl)}\")` } : undefined}
          >
            {memberAvatarUrl ? <span className="sr-only">{memberAvatarInitial}</span> : memberAvatarInitial}
          </span>
        ) : (
          buttonLabel
        )}
      </button>
      {message && !active ? (
        <div className="mt-2 max-w-[220px] rounded-xl bg-slate-950/85 px-3 py-2 text-xs font-medium text-white shadow-lg">
          {message}
        </div>
      ) : null}
      {dialogOpen ? (
        <div className="fixed inset-0 z-[2147483200] flex items-center justify-center bg-slate-950/55 px-4 py-6 backdrop-blur-sm">
          <form
            className="w-full max-w-xl overflow-hidden rounded-[24px] border border-slate-200 bg-white shadow-[0_24px_80px_rgba(15,23,42,0.22)]"
            onSubmit={(event) => {
              event.preventDefault();
              void handleJoin();
            }}
          >
            <div className="flex items-start justify-between gap-3 border-b border-slate-100 px-5 py-4">
              <div>
                <div className="text-lg font-semibold text-slate-950">加入</div>
                <div className="mt-1 text-sm text-slate-500">{siteName || normalizedSiteId}</div>
              </div>
              <button
                type="button"
                className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                onClick={() => setDialogOpen(false)}
                disabled={busy}
              >
                关闭
              </button>
            </div>
            <div className="max-h-[72vh] overflow-y-auto px-5 py-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block text-sm font-medium text-slate-700">
                  昵称 <span className="text-rose-500">*</span>
                  <input
                    className="mt-1 h-10 w-full rounded-xl border border-slate-200 px-3 text-sm outline-none focus:border-slate-900"
                    value={profileDraft.nickname}
                    onChange={handleInputChange("nickname")}
                    autoComplete="nickname"
                    required
                  />
                </label>
                <label className="block text-sm font-medium text-slate-700">
                  姓名
                  <input
                    className="mt-1 h-10 w-full rounded-xl border border-slate-200 px-3 text-sm outline-none focus:border-slate-900"
                    value={profileDraft.name}
                    onChange={handleInputChange("name")}
                    autoComplete="name"
                  />
                </label>
                <label className="block text-sm font-medium text-slate-700">
                  手机 <span className="text-rose-500">*</span>
                  <input
                    className="mt-1 h-10 w-full rounded-xl border border-slate-200 px-3 text-sm outline-none focus:border-slate-900"
                    value={profileDraft.phone}
                    onChange={handleInputChange("phone")}
                    autoComplete="tel"
                    required
                  />
                </label>
                <label className="block text-sm font-medium text-slate-700">
                  邮箱 <span className="text-rose-500">*</span>
                  <input
                    type="email"
                    className="mt-1 h-10 w-full rounded-xl border border-slate-200 px-3 text-sm outline-none focus:border-slate-900"
                    value={profileDraft.email}
                    onChange={handleInputChange("email")}
                    autoComplete="email"
                    required
                  />
                </label>
                <div className="block text-sm font-medium text-slate-700">
                  <div className="flex items-center justify-between gap-2">
                    <span>
                      生日 <span className="text-rose-500">*</span>
                    </span>
                    <label className="inline-flex items-center gap-1 text-xs font-semibold text-slate-500">
                      <input
                        type="checkbox"
                        className="h-3.5 w-3.5 accent-slate-950"
                        checked={profileDraft.birthdayMonthDayOnly}
                        onChange={(event) => {
                          const checked = event.target.checked;
                          const backup = normalizeFullDate(profileDraft.birthday) || birthdayFullBackup;
                          if (checked && backup) setBirthdayFullBackup(backup);
                          setProfileDraft((current) => ({
                            ...current,
                            birthdayMonthDayOnly: checked,
                            birthday: checked ? extractMonthDay(current.birthday) || "06-15" : backup,
                          }));
                        }}
                      />
                      仅月日
                    </label>
                  </div>
                  {profileDraft.birthdayMonthDayOnly ? (
                    <div className="mt-1 grid grid-cols-2 gap-2">
                      <select
                        className="h-10 w-full rounded-xl border border-slate-200 px-3 text-sm outline-none focus:border-slate-900"
                        value={readMonthDayParts(profileDraft.birthday).month}
                        onChange={(event) => setBirthdayMonthDay("month", event.target.value)}
                        required
                      >
                        {MONTH_OPTIONS.map((month) => (
                          <option key={month} value={month}>
                            {Number(month)}月
                          </option>
                        ))}
                      </select>
                      <select
                        className="h-10 w-full rounded-xl border border-slate-200 px-3 text-sm outline-none focus:border-slate-900"
                        value={readMonthDayParts(profileDraft.birthday).day}
                        onChange={(event) => setBirthdayMonthDay("day", event.target.value)}
                        required
                      >
                        {DAY_OPTIONS.map((day) => (
                          <option key={day} value={day}>
                            {Number(day)}日
                          </option>
                        ))}
                      </select>
                    </div>
                  ) : (
                    <input
                      type="date"
                      className="mt-1 h-10 w-full rounded-xl border border-slate-200 px-3 text-sm outline-none focus:border-slate-900"
                      value={normalizeFullDate(profileDraft.birthday)}
                      onChange={(event) => {
                        const value = event.target.value;
                        setBirthdayFullBackup(value);
                        updateProfileDraft("birthday", value);
                      }}
                      required
                    />
                  )}
                </div>
                <label className="block text-sm font-medium text-slate-700">
                  性别
                  <select
                    className="mt-1 h-10 w-full rounded-xl border border-slate-200 px-3 text-sm outline-none focus:border-slate-900"
                    value={profileDraft.gender}
                    onChange={handleInputChange("gender")}
                  >
                    <option value="">未填写</option>
                    <option value="male">男</option>
                    <option value="female">女</option>
                    <option value="other">其他</option>
                  </select>
                </label>
                <label className="block text-sm font-medium text-slate-700">
                  国家
                  <input
                    className="mt-1 h-10 w-full rounded-xl border border-slate-200 px-3 text-sm outline-none focus:border-slate-900"
                    value={profileDraft.country}
                    onChange={handleInputChange("country")}
                    autoComplete="country-name"
                  />
                </label>
                <label className="block text-sm font-medium text-slate-700">
                  省
                  <input
                    className="mt-1 h-10 w-full rounded-xl border border-slate-200 px-3 text-sm outline-none focus:border-slate-900"
                    value={profileDraft.province}
                    onChange={handleInputChange("province")}
                    autoComplete="address-level1"
                  />
                </label>
                <label className="block text-sm font-medium text-slate-700">
                  市
                  <input
                    className="mt-1 h-10 w-full rounded-xl border border-slate-200 px-3 text-sm outline-none focus:border-slate-900"
                    value={profileDraft.city}
                    onChange={handleInputChange("city")}
                    autoComplete="address-level2"
                  />
                </label>
                <label className="block text-sm font-medium text-slate-700 sm:col-span-2">
                  地址
                  <textarea
                    className="mt-1 min-h-20 w-full resize-y rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-slate-900"
                    value={profileDraft.address}
                    onChange={handleInputChange("address")}
                    autoComplete="street-address"
                  />
                </label>
                <div className="sm:col-span-2 rounded-2xl border border-slate-200 bg-slate-50 p-3">
                  <div className="text-sm font-semibold text-slate-900">税务信息</div>
                  <div className="mt-3 grid gap-3 sm:grid-cols-2">
                    <label className="block text-sm font-medium text-slate-700">
                      税务名称
                      <input
                        className="mt-1 h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none focus:border-slate-900"
                        value={profileDraft.taxName}
                        onChange={handleInputChange("taxName")}
                      />
                    </label>
                    <label className="block text-sm font-medium text-slate-700">
                      税号
                      <input
                        className="mt-1 h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none focus:border-slate-900"
                        value={profileDraft.taxNumber}
                        onChange={handleInputChange("taxNumber")}
                      />
                    </label>
                    <label className="block text-sm font-medium text-slate-700 sm:col-span-2">
                      税务国家
                      <input
                        className="mt-1 h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none focus:border-slate-900"
                        value={profileDraft.taxCountry}
                        onChange={handleInputChange("taxCountry")}
                        autoComplete="country-name"
                      />
                    </label>
                    <label className="block text-sm font-medium text-slate-700">
                      税务省
                      <input
                        className="mt-1 h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none focus:border-slate-900"
                        value={profileDraft.taxProvince}
                        onChange={handleInputChange("taxProvince")}
                        autoComplete="address-level1"
                      />
                    </label>
                    <label className="block text-sm font-medium text-slate-700">
                      税务市
                      <input
                        className="mt-1 h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none focus:border-slate-900"
                        value={profileDraft.taxCity}
                        onChange={handleInputChange("taxCity")}
                        autoComplete="address-level2"
                      />
                    </label>
                    <label className="block text-sm font-medium text-slate-700 sm:col-span-2">
                      税务详细地址
                      <textarea
                        className="mt-1 min-h-16 w-full resize-y rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-slate-900"
                        value={profileDraft.taxAddress}
                        onChange={handleInputChange("taxAddress")}
                      />
                    </label>
                  </div>
                </div>
              </div>
              {message ? (
                <div className="mt-3 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{message}</div>
              ) : null}
            </div>
            <div className="flex justify-end gap-2 border-t border-slate-100 px-5 py-4">
              <button
                type="button"
                className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                onClick={() => setDialogOpen(false)}
                disabled={busy}
              >
                取消
              </button>
              <button
                type="submit"
                className="rounded-xl bg-slate-950 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
                disabled={busy}
              >
                {busy ? "保存中..." : "确认加入"}
              </button>
            </div>
          </form>
        </div>
      ) : null}
    </div>
  );
}
