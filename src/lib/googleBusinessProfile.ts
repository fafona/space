import type { GoogleReviewItem } from "@/data/homeBlocks";

export type GoogleBusinessProfileAccount = {
  name: string;
  displayName: string;
  type: string;
  role: string;
};

export type GoogleBusinessProfileLocation = {
  accountName: string;
  name: string;
  title: string;
  address: string;
  mapsUri: string;
  newReviewUri: string;
  websiteUri: string;
};

export type GoogleBusinessProfileReviewSnapshot = {
  reviews: GoogleReviewItem[];
  averageRating: number;
  totalReviewCount: number;
  syncedAt: string;
};

export type GoogleBusinessProfileClientStatus = {
  configured: boolean;
  connected: boolean;
  accounts: GoogleBusinessProfileAccount[];
  locations: GoogleBusinessProfileLocation[];
  selectedAccountName: string;
  selectedLocationName: string;
  selectedLocation: GoogleBusinessProfileLocation | null;
  snapshot: GoogleBusinessProfileReviewSnapshot | null;
  connectedAt: string;
  updatedAt: string;
  lastError: string;
  lastErrorAt: string;
};

function trimText(value: unknown, maxLength = 4096) {
  const text = typeof value === "string" ? value.trim() : "";
  return text.length > maxLength ? text.slice(0, maxLength).trimEnd() : text;
}

export function buildGoogleBusinessProfileLocationKey(
  accountName: string | null | undefined,
  locationName: string | null | undefined,
) {
  return `${trimText(accountName, 240)}::${trimText(locationName, 240)}`;
}

export function findGoogleBusinessProfileLocation(
  locations: GoogleBusinessProfileLocation[],
  accountName: string | null | undefined,
  locationName: string | null | undefined,
) {
  const key = buildGoogleBusinessProfileLocationKey(accountName, locationName);
  return locations.find((location) => buildGoogleBusinessProfileLocationKey(location.accountName, location.name) === key) ?? null;
}
