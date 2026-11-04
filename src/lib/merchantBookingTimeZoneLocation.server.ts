import type { SiteLocation } from "@/data/platformControlStore";
import { getEuropeProvinceOptions } from "./europeLocationOptions";
import { normalizeBookingTimeZone } from "./merchantBookingTime";
import { BOOKING_COUNTRY_TIME_ZONES } from "./merchantBookingTimeZoneData";
import { bookingTimeZoneSearchKey, type BookingTimeZoneDefault } from "./merchantBookingTimeZoneOptions";

function geographyKey(value: string) {
  // The merchant address catalog uses e.g. "Palmas de Gran Canaria, Las".
  return bookingTimeZoneSearchKey(value.replace(/^(.+),\s*(El|La|Los|Las|A|O|Os|As)$/i, "$2 $1")).replace(/\s+/g, " ");
}

// Only saved merchant geography is used. No visitor/browser/server time zone,
// IP geolocation, offset guessing, or first-zone-of-country fallback.
export function resolveMerchantBookingTimeZoneDefault(location?: Partial<SiteLocation> | null): BookingTimeZoneDefault {
  const codeValue = String(location?.countryCode ?? "").trim().toUpperCase();
  const countryCode = /^[A-Z]{2}$/.test(codeValue) ? codeValue : "";
  const zones = BOOKING_COUNTRY_TIME_ZONES[countryCode] ?? [];
  const result = (zone = "") => ({ countryCode, timeZone: normalizeBookingTimeZone(zone) });
  if (zones.length === 1) return result(zones[0]);
  if (countryCode !== "ES" && countryCode !== "PT") return result();

  const provinces = getEuropeProvinceOptions(countryCode);
  const code = String(location?.provinceCode ?? "").trim().replace(new RegExp(`^${countryCode}-`, "i"), "");
  const name = geographyKey(location?.province ?? "");
  const city = geographyKey(location?.city ?? "");
  const byCode = provinces.find((province) => province.code === code);
  const byName = provinces.find((province) => geographyKey(province.name) === name);
  const byCity = city ? provinces.filter((province) => province.cities.some((value) => geographyKey(value) === city)) : [];
  // Conflicting or ambiguous saved geography must be confirmed manually.
  if (byCode && byName && byCode.code !== byName.code) return result();
  const province = byCode ?? byName ?? (byCity.length === 1 ? byCity[0] : undefined);
  if (!province || (byCity.length && !byCity.some((value) => value.code === province.code))) return result();
  if (countryCode === "ES") {
    return result(["35", "38"].includes(province.code) ? "Atlantic/Canary" : ["51", "52"].includes(province.code) ? "Africa/Ceuta" : "Europe/Madrid");
  }
  return result(province.code === "20" ? "Atlantic/Azores" : province.code === "30" ? "Atlantic/Madeira" : "Europe/Lisbon");
}
