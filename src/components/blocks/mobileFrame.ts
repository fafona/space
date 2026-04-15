export function resolveMobileFitSectionClass(baseClassName: string, enabled: boolean) {
  return enabled ? `${baseClassName} mobile-fit-screen-section` : baseClassName;
}

export function resolveMobileFitCardClass(baseClassName: string, enabled: boolean) {
  return enabled ? `${baseClassName} mobile-fit-screen-card` : baseClassName;
}
