import { normalizeBookingTimeZone } from "./merchantBookingTime";
import { BOOKING_COUNTRY_TIME_ZONES } from "./merchantBookingTimeZoneData";

export type BookingTimeZoneDefault = { countryCode: string; timeZone: string };
export type BookingTimeZoneOption = { value: string; label: string; local: boolean };

const regionLabels: Record<string, readonly [string, string, string]> = {
  "Europe/Madrid": ["西班牙本土 / 巴利阿里", "España peninsular y Baleares", "Mainland Spain and Balearic Islands"],
  "Atlantic/Canary": ["加那利群岛", "Islas Canarias", "Canary Islands"],
  "Africa/Ceuta": ["休达及梅利利亚", "Ceuta y Melilla", "Ceuta and Melilla"],
  "Europe/Lisbon": ["葡萄牙本土", "Portugal continental", "Mainland Portugal"],
  "Atlantic/Azores": ["亚速尔群岛", "Azores", "Azores"],
  "Atlantic/Madeira": ["马德拉群岛", "Madeira", "Madeira"],
  "Asia/Shanghai": ["中国标准时间", "Hora estándar de China", "China Standard Time"],
  "UTC": ["协调世界时", "Tiempo universal coordinado", "Coordinated Universal Time"],
};

export function readBookingTimeZoneDefault(value: unknown): BookingTimeZoneDefault {
  const source = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const countryCode = typeof source.countryCode === "string" && /^[A-Z]{2}$/.test(source.countryCode) ? source.countryCode : "";
  const timeZone = normalizeBookingTimeZone(source.timeZone);
  return { countryCode, timeZone: BOOKING_COUNTRY_TIME_ZONES[countryCode]?.includes(timeZone) ? timeZone : "" };
}

export function bookingTimeZoneSearchKey(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[_/]+/g, " ").toLowerCase().trim();
}

export function getBookingTimeZoneOptions(locale: string, countryCode = "", savedZone = ""): BookingTimeZoneOption[] {
  const localZones = new Set(BOOKING_COUNTRY_TIME_ZONES[countryCode] ?? []);
  const index = locale.startsWith("zh") ? 0 : locale.startsWith("es") ? 1 : 2;
  const zones = [...new Set([savedZone, "UTC", ...Object.values(BOOKING_COUNTRY_TIME_ZONES).flat()])];
  return zones.filter((zone) => Boolean(normalizeBookingTimeZone(zone))).map((zone) => {
    let name = regionLabels[zone]?.[index] ?? "";
    if (!name) {
      try {
        name = new Intl.DateTimeFormat(locale || "en-GB", { timeZone: zone, timeZoneName: "longGeneric" })
          .formatToParts(new Date("2026-01-01T12:00:00Z")).find((part) => part.type === "timeZoneName")?.value ?? "";
      } catch { /* The IANA identifier remains an accessible fallback. */ }
    }
    return { value: zone, label: name ? `${name} · ${zone}` : zone, local: localZones.has(zone) };
  }).sort((left, right) => Number(right.local) - Number(left.local) || left.value.localeCompare(right.value, "en"));
}

export function filterBookingTimeZoneOptions(options: BookingTimeZoneOption[], query: string, selectedZone: string) {
  const words = bookingTimeZoneSearchKey(query).split(/\s+/).filter(Boolean);
  return options.filter((option) => option.value === selectedZone || words.every((word) => bookingTimeZoneSearchKey(option.label).includes(word)));
}
