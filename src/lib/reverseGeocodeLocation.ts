export type ReverseGeocodeAdministrative = {
  name?: string;
  description?: string;
  adminLevel?: number;
};

export type ReverseGeocodeResponse = {
  lookupSource?: string;
  countryName?: string;
  countryCode?: string;
  principalSubdivision?: string;
  principalSubdivisionCode?: string;
  city?: string;
  locality?: string;
  localityName?: string;
  localityInfo?: {
    administrative?: ReverseGeocodeAdministrative[];
  };
};

type ResolvedReverseGeocodeLocation = {
  provinceName: string;
  cityName: string;
  provinceSource: string;
  citySource: string;
};

const PROVINCE_PREFIX_PATTERNS = [
  /^(?:province of|province)\s+/i,
  /^(?:provincia de|provincia d'|provincia do|provincia da|provincia)\s+/i,
  /^(?:província de|província d'|província do|província da|província)\s+/i,
  /^(?:provinsje|provincie|provincija)\s+/i,
  /^(?:county of|county)\s+/i,
  /^(?:district of|district)\s+/i,
  /^(?:department of|department|departement de|departamento de)\s+/i,
  /^(?:prefecture of|prefecture)\s+/i,
];

function cleanLabel(value: string | undefined) {
  return String(value ?? "").trim();
}

function stripProvincePrefix(value: string) {
  let next = cleanLabel(value);
  for (const pattern of PROVINCE_PREFIX_PATTERNS) {
    next = next.replace(pattern, "");
  }
  return next.trim();
}

function pickAdministrativeCandidate(
  administrative: ReverseGeocodeAdministrative[],
  matcher: (entry: ReverseGeocodeAdministrative) => boolean,
) {
  return administrative.find((entry) => cleanLabel(entry.name) && matcher(entry))?.name ?? "";
}

export function resolveReverseGeocodeLocation(payload: ReverseGeocodeResponse): ResolvedReverseGeocodeLocation {
  const administrative = payload.localityInfo?.administrative ?? [];

  const cityFromAdministrative =
    pickAdministrativeCandidate(administrative, (entry) => entry.adminLevel === 8) ||
    pickAdministrativeCandidate(administrative, (entry) => entry.adminLevel === 7);
  const cityName =
    cleanLabel(payload.city) ||
    cleanLabel(cityFromAdministrative) ||
    cleanLabel(payload.localityName) ||
    cleanLabel(payload.locality);

  const provinceFromLevel6 = pickAdministrativeCandidate(administrative, (entry) => entry.adminLevel === 6);
  const provinceFromDescription = pickAdministrativeCandidate(administrative, (entry) => {
    const description = cleanLabel(entry.description).toLowerCase();
    const level = typeof entry.adminLevel === "number" ? entry.adminLevel : -1;
    if (level < 3 || level > 7) return false;
    return /\bprovince\b|\bcounty\b|\bdistrict\b|\bdepartment\b|\bprefecture\b|\bcanton\b|\bparish\b/.test(
      description,
    );
  });
  const provinceFromPrincipalSubdivision = cleanLabel(payload.principalSubdivision);
  const provinceName = stripProvincePrefix(
    provinceFromLevel6 || provinceFromDescription || provinceFromPrincipalSubdivision,
  );

  return {
    provinceName,
    cityName,
    provinceSource: provinceFromLevel6
      ? "administrative:6"
      : provinceFromDescription
        ? "administrative:description"
        : provinceFromPrincipalSubdivision
          ? "principalSubdivision"
          : "",
    citySource: cleanLabel(payload.city)
      ? "city"
      : cityFromAdministrative
        ? "administrative"
        : cleanLabel(payload.localityName)
          ? "localityName"
          : cleanLabel(payload.locality)
            ? "locality"
            : "",
  };
}
