export const PERSONAL_CONSUMPTION_CHANGED_MESSAGE = "faolla:personal-consumption-changed";

export function notifyPersonalConsumptionChanged() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(PERSONAL_CONSUMPTION_CHANGED_MESSAGE));
  if (window.parent && window.parent !== window) {
    window.parent.postMessage({ type: PERSONAL_CONSUMPTION_CHANGED_MESSAGE }, "*");
  }
}
