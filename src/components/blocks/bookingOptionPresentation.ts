export type BookingOptionPresentation = Readonly<{
  value: string;
  label: string;
}>;

/**
 * Keeps the submitted option value identical to the published booking rule.
 * Localization is presentation-only so a translated label can never bypass or
 * accidentally fail the server's canonical allowlist.
 */
export function buildBookingOptionPresentations(
  canonicalValues: readonly string[],
  localizeLabel: (value: string) => string,
): BookingOptionPresentation[] {
  return canonicalValues.map((value) => ({
    value,
    label: localizeLabel(value),
  }));
}
