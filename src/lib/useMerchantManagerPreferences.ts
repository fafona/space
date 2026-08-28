"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import {
  loadMerchantBookingManagerPreferences,
  normalizeMerchantBookingManagerPreferences,
  saveMerchantBookingManagerPreferences,
  type MerchantBookingHistoryVisibility,
  type MerchantBookingManagerPreferences,
  type MerchantBookingSortMode,
} from "@/lib/merchantBookingManagerPreferences";
import {
  loadMerchantOrderManagerPreferences,
  normalizeMerchantOrderManagerPreferences,
  saveMerchantOrderManagerPreferences,
  type MerchantOrderHistoryVisibility,
  type MerchantOrderManagerPreferences,
  type MerchantOrderSortMode,
} from "@/lib/merchantOrderManagerPreferences";
import type { MerchantBookingStatus } from "@/lib/merchantBookings";
import type { MerchantOrderStatus } from "@/lib/merchantOrders";
import type { MerchantBusinessCachePolicy } from "@/lib/merchantBusinessApiClient";
import type {
  MerchantManagerPreferenceKind,
  MerchantManagerPreferencesStoredState,
} from "@/lib/merchantManagerPreferences";

type RemotePreferencesResponse = {
  preferences: {
    booking: MerchantBookingManagerPreferences | null;
    order: MerchantOrderManagerPreferences | null;
  };
  stored: MerchantManagerPreferencesStoredState;
};

type PendingRemoteWrite = {
  siteId: string;
  kind: MerchantManagerPreferenceKind;
  preferences: MerchantBookingManagerPreferences | MerchantOrderManagerPreferences;
  fingerprint: string;
  timer: ReturnType<typeof setTimeout> | null;
};

const pendingRemoteWrites = new Map<string, PendingRemoteWrite>();
const remoteWriteChains = new Map<string, Promise<void>>();
const knownRemoteFingerprints = new Map<string, string>();
const remoteLoadRequests = new Map<string, Promise<RemotePreferencesResponse>>();
let pageHideListenerAttached = false;

function normalizeText(value: unknown, maxLength = 4096) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function buildPreferenceKey(siteId: string, kind: MerchantManagerPreferenceKind) {
  return `${siteId}:${kind}`;
}

function preferenceFingerprint(value: unknown) {
  return JSON.stringify(value);
}

function normalizeRemoteResponse(value: unknown): RemotePreferencesResponse {
  const input =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  const rawPreferences =
    input.preferences && typeof input.preferences === "object" && !Array.isArray(input.preferences)
      ? (input.preferences as Record<string, unknown>)
      : {};
  const rawStored =
    input.stored && typeof input.stored === "object" && !Array.isArray(input.stored)
      ? (input.stored as Record<string, unknown>)
      : {};
  const bookingStored = rawStored.booking === true;
  const orderStored = rawStored.order === true;
  return {
    preferences: {
      booking: bookingStored
        ? normalizeMerchantBookingManagerPreferences(rawPreferences.booking)
        : null,
      order: orderStored
        ? normalizeMerchantOrderManagerPreferences(rawPreferences.order)
        : null,
    },
    stored: {
      booking: bookingStored,
      order: orderStored,
    },
  };
}

async function requestRemotePreferences(siteId: string) {
  const existing = remoteLoadRequests.get(siteId);
  if (existing) return existing;
  const request = fetch(
    `/api/merchant-admin/manager-preferences?siteId=${encodeURIComponent(siteId)}`,
    {
      method: "GET",
      credentials: "same-origin",
      cache: "no-store",
      headers: {
        accept: "application/json",
      },
    },
  )
    .then(async (response) => {
      if (!response.ok) throw new Error(`manager_preferences_load_failed:${response.status}`);
      return normalizeRemoteResponse(await response.json());
    })
    .finally(() => {
      if (remoteLoadRequests.get(siteId) === request) remoteLoadRequests.delete(siteId);
    });
  remoteLoadRequests.set(siteId, request);
  return request;
}

function markKnownRemotePreference(
  siteId: string,
  kind: MerchantManagerPreferenceKind,
  preferences: MerchantBookingManagerPreferences | MerchantOrderManagerPreferences,
) {
  knownRemoteFingerprints.set(
    buildPreferenceKey(siteId, kind),
    preferenceFingerprint(preferences),
  );
}

async function persistRemoteWrite(entry: PendingRemoteWrite) {
  let lastError: unknown = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const response = await fetch("/api/merchant-admin/manager-preferences", {
        method: "PATCH",
        credentials: "same-origin",
        cache: "no-store",
        keepalive: true,
        headers: {
          accept: "application/json",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          siteId: entry.siteId,
          kind: entry.kind,
          preferences: entry.preferences,
        }),
      });
      if (!response.ok) throw new Error(`manager_preferences_save_failed:${response.status}`);
      knownRemoteFingerprints.set(
        buildPreferenceKey(entry.siteId, entry.kind),
        entry.fingerprint,
      );
      return;
    } catch (error) {
      lastError = error;
      if (attempt < 2) {
        await new Promise((resolve) => setTimeout(resolve, 250 * (attempt + 1)));
      }
    }
  }
  throw lastError instanceof Error ? lastError : new Error("manager_preferences_save_failed");
}

function enqueueRemoteWrite(entry: PendingRemoteWrite) {
  const key = buildPreferenceKey(entry.siteId, entry.kind);
  const previous = remoteWriteChains.get(key) ?? Promise.resolve();
  const result = previous
    .catch(() => undefined)
    .then(() => persistRemoteWrite(entry))
    .catch(() => undefined);
  remoteWriteChains.set(key, result);
  void result.finally(() => {
    if (remoteWriteChains.get(key) === result) remoteWriteChains.delete(key);
  });
}

function flushPendingRemoteWrite(key: string) {
  const entry = pendingRemoteWrites.get(key);
  if (!entry) return;
  if (entry.timer) clearTimeout(entry.timer);
  pendingRemoteWrites.delete(key);
  enqueueRemoteWrite({ ...entry, timer: null });
}

function ensurePageHideFlush() {
  if (pageHideListenerAttached || typeof window === "undefined") return;
  pageHideListenerAttached = true;
  window.addEventListener("pagehide", () => {
    [...pendingRemoteWrites.keys()].forEach(flushPendingRemoteWrite);
  });
}

function scheduleRemotePreferenceWrite(
  siteId: string,
  kind: MerchantManagerPreferenceKind,
  preferences: MerchantBookingManagerPreferences | MerchantOrderManagerPreferences,
  delay = 280,
) {
  const normalizedSiteId = normalizeText(siteId, 64);
  if (!normalizedSiteId) return;
  const key = buildPreferenceKey(normalizedSiteId, kind);
  const fingerprint = preferenceFingerprint(preferences);
  if (knownRemoteFingerprints.get(key) === fingerprint) return;
  const current = pendingRemoteWrites.get(key);
  if (current?.timer) clearTimeout(current.timer);
  const entry: PendingRemoteWrite = {
    siteId: normalizedSiteId,
    kind,
    preferences,
    fingerprint,
    timer: null,
  };
  entry.timer = setTimeout(() => flushPendingRemoteWrite(key), Math.max(0, delay));
  pendingRemoteWrites.set(key, entry);
  ensurePageHideFlush();
}

function cancelPendingRemotePreferenceWrite(
  siteId: string,
  kind: MerchantManagerPreferenceKind,
) {
  const normalizedSiteId = normalizeText(siteId, 64);
  if (!normalizedSiteId) return;
  const key = buildPreferenceKey(normalizedSiteId, kind);
  const entry = pendingRemoteWrites.get(key);
  if (entry?.timer) clearTimeout(entry.timer);
  pendingRemoteWrites.delete(key);
}

type SyncedPreferenceState<T> = {
  siteId: string;
  persistenceEnabled: boolean;
  value: T;
};

export type MerchantManagerPreferencesOptions = {
  cachePolicy?: MerchantBusinessCachePolicy;
};

export function shouldPersistMerchantManagerPreferences(
  cachePolicy: MerchantBusinessCachePolicy | undefined,
) {
  return (
    cachePolicy === undefined ||
    (cachePolicy.mode !== "disabled" &&
      cachePolicy.allowPersistentRead &&
      cachePolicy.allowPersistentWrite)
  );
}

function useSyncedManagerPreferences<
  T extends MerchantBookingManagerPreferences | MerchantOrderManagerPreferences,
>(input: {
  siteId: string;
  kind: MerchantManagerPreferenceKind;
  loadLocal: (siteId: string) => T;
  saveLocal: (siteId: string, value: T) => void;
  normalize: (value: unknown) => T;
  selectRemote: (response: RemotePreferencesResponse) => T | null;
  persistenceEnabled?: boolean;
}): [T, Dispatch<SetStateAction<T>>] {
  const {
    siteId,
    kind,
    loadLocal,
    saveLocal,
    normalize,
    selectRemote,
    persistenceEnabled = true,
  } = input;
  const normalizedSiteId = normalizeText(siteId, 64);
  const readInitialValue = useCallback(
    (targetSiteId: string) =>
      persistenceEnabled
        ? normalize(loadLocal(targetSiteId))
        : normalize({}),
    [loadLocal, normalize, persistenceEnabled],
  );
  const [state, setState] = useState<SyncedPreferenceState<T>>(() => ({
    siteId: normalizedSiteId,
    persistenceEnabled,
    value: persistenceEnabled
      ? normalize(loadLocal(normalizedSiteId))
      : normalize({}),
  }));
  const stateRef = useRef(state);
  const remoteReadySiteRef = useRef("");
  const revisionRef = useRef({
    siteId: normalizedSiteId,
    persistenceEnabled,
    count: 0,
  });

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  useEffect(() => {
    let cancelled = false;
    remoteReadySiteRef.current = "";
    if (
      revisionRef.current.siteId !== normalizedSiteId ||
      revisionRef.current.persistenceEnabled !== persistenceEnabled
    ) {
      revisionRef.current = {
        siteId: normalizedSiteId,
        persistenceEnabled,
        count: 0,
      };
    }
    const local = readInitialValue(normalizedSiteId);
    queueMicrotask(() => {
      if (cancelled) return;
      setState((current) =>
        current.siteId === normalizedSiteId &&
        current.persistenceEnabled === persistenceEnabled
          ? current
          : {
              siteId: normalizedSiteId,
              persistenceEnabled,
              value: local,
            },
      );
    });

    if (!normalizedSiteId || !persistenceEnabled) {
      if (!persistenceEnabled) {
        cancelPendingRemotePreferenceWrite(normalizedSiteId, kind);
      }
      return () => {
        cancelled = true;
      };
    }

    void requestRemotePreferences(normalizedSiteId)
      .then((response) => {
        if (cancelled) return;
        const remote = selectRemote(response);
        const isStored = response.stored[kind];
        if (isStored && remote) {
          markKnownRemotePreference(
            normalizedSiteId,
            kind,
            remote,
          );
        }
        remoteReadySiteRef.current = normalizedSiteId;
        const current =
          stateRef.current.siteId === normalizedSiteId &&
          stateRef.current.persistenceEnabled
            ? stateRef.current.value
            : local;
        const hasLocalEdits =
          revisionRef.current.siteId === normalizedSiteId &&
          revisionRef.current.persistenceEnabled &&
          revisionRef.current.count > 0;
        if (isStored && remote && !hasLocalEdits) {
          setState((latest) => {
            if (
              latest.siteId !== normalizedSiteId ||
              !latest.persistenceEnabled ||
              revisionRef.current.siteId !== normalizedSiteId ||
              !revisionRef.current.persistenceEnabled ||
              revisionRef.current.count > 0
            ) {
              return latest;
            }
            return {
              siteId: normalizedSiteId,
              persistenceEnabled: true,
              value: normalize(remote),
            };
          });
          return;
        }
        scheduleRemotePreferenceWrite(
          normalizedSiteId,
          kind,
          normalize(current),
          0,
        );
      })
      .catch(() => {
        // Local preferences remain available when the session or network is unavailable.
      });

    return () => {
      cancelled = true;
    };
  }, [
    kind,
    normalize,
    normalizedSiteId,
    persistenceEnabled,
    readInitialValue,
    selectRemote,
  ]);

  useEffect(() => {
    if (
      !persistenceEnabled ||
      !normalizedSiteId ||
      state.siteId !== normalizedSiteId ||
      !state.persistenceEnabled
    ) return;
    const normalized = normalize(state.value);
    saveLocal(normalizedSiteId, normalized);
    if (remoteReadySiteRef.current === normalizedSiteId) {
      scheduleRemotePreferenceWrite(
        normalizedSiteId,
        kind,
        normalized,
      );
    }
  }, [kind, normalize, normalizedSiteId, persistenceEnabled, saveLocal, state]);

  const setValue = useCallback<Dispatch<SetStateAction<T>>>(
    (action) => {
      if (!normalizedSiteId) return;
      if (
        revisionRef.current.siteId !== normalizedSiteId ||
        revisionRef.current.persistenceEnabled !== persistenceEnabled
      ) {
        revisionRef.current = {
          siteId: normalizedSiteId,
          persistenceEnabled,
          count: 0,
        };
      }
      revisionRef.current.count += 1;
      setState((current) => {
        const currentValue =
          current.siteId === normalizedSiteId &&
          current.persistenceEnabled === persistenceEnabled
            ? current.value
            : readInitialValue(normalizedSiteId);
        const nextValue =
          typeof action === "function"
            ? (action as (current: T) => T)(currentValue)
            : action;
        return {
          siteId: normalizedSiteId,
          persistenceEnabled,
          value: normalize(nextValue),
        };
      });
    },
    [normalize, normalizedSiteId, persistenceEnabled, readInitialValue],
  );

  return [
    state.siteId === normalizedSiteId &&
    state.persistenceEnabled === persistenceEnabled
      ? state.value
      : readInitialValue(normalizedSiteId),
    setValue,
  ];
}

const selectRemoteBooking = (response: RemotePreferencesResponse) =>
  response.preferences.booking;
const selectRemoteOrder = (response: RemotePreferencesResponse) =>
  response.preferences.order;

export function useMerchantBookingManagerPreferences(
  siteId: string,
  options: MerchantManagerPreferencesOptions = {},
) {
  const [preferences, setPreferences] = useSyncedManagerPreferences({
    siteId,
    kind: "booking",
    loadLocal: loadMerchantBookingManagerPreferences,
    saveLocal: saveMerchantBookingManagerPreferences,
    normalize: normalizeMerchantBookingManagerPreferences,
    selectRemote: selectRemoteBooking,
    persistenceEnabled: shouldPersistMerchantManagerPreferences(options.cachePolicy),
  });
  const setSelectedStatuses = useCallback<Dispatch<SetStateAction<MerchantBookingStatus[]>>>(
    (action) => {
      setPreferences((current) => ({
        ...current,
        selectedStatuses:
          typeof action === "function" ? action(current.selectedStatuses) : action,
      }));
    },
    [setPreferences],
  );
  const setSortMode = useCallback<Dispatch<SetStateAction<MerchantBookingSortMode>>>(
    (action) => {
      setPreferences((current) => ({
        ...current,
        sortMode: typeof action === "function" ? action(current.sortMode) : action,
      }));
    },
    [setPreferences],
  );
  const setHistoryVisibility = useCallback<
    Dispatch<SetStateAction<MerchantBookingHistoryVisibility>>
  >(
    (action) => {
      setPreferences((current) => ({
        ...current,
        historyVisibility:
          typeof action === "function" ? action(current.historyVisibility) : action,
      }));
    },
    [setPreferences],
  );
  return {
    selectedStatuses: preferences.selectedStatuses,
    setSelectedStatuses,
    sortMode: preferences.sortMode,
    setSortMode,
    historyVisibility: preferences.historyVisibility,
    setHistoryVisibility,
  };
}

export function useMerchantOrderManagerPreferences(
  siteId: string,
  options: MerchantManagerPreferencesOptions = {},
) {
  const [preferences, setPreferences] = useSyncedManagerPreferences({
    siteId,
    kind: "order",
    loadLocal: loadMerchantOrderManagerPreferences,
    saveLocal: saveMerchantOrderManagerPreferences,
    normalize: normalizeMerchantOrderManagerPreferences,
    selectRemote: selectRemoteOrder,
    persistenceEnabled: shouldPersistMerchantManagerPreferences(options.cachePolicy),
  });
  const setSelectedStatuses = useCallback<Dispatch<SetStateAction<MerchantOrderStatus[]>>>(
    (action) => {
      setPreferences((current) => ({
        ...current,
        selectedStatuses:
          typeof action === "function" ? action(current.selectedStatuses) : action,
      }));
    },
    [setPreferences],
  );
  const setSortMode = useCallback<Dispatch<SetStateAction<MerchantOrderSortMode>>>(
    (action) => {
      setPreferences((current) => ({
        ...current,
        sortMode: typeof action === "function" ? action(current.sortMode) : action,
      }));
    },
    [setPreferences],
  );
  const setHistoryVisibility = useCallback<
    Dispatch<SetStateAction<MerchantOrderHistoryVisibility>>
  >(
    (action) => {
      setPreferences((current) => ({
        ...current,
        historyVisibility:
          typeof action === "function" ? action(current.historyVisibility) : action,
      }));
    },
    [setPreferences],
  );
  return {
    selectedStatuses: preferences.selectedStatuses,
    setSelectedStatuses,
    sortMode: preferences.sortMode,
    setSortMode,
    historyVisibility: preferences.historyVisibility,
    setHistoryVisibility,
  };
}
