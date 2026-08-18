/**
 * Tracks the one enterprise auth context that is allowed to publish UI state.
 * A generation is started before every async session resolution and every auth
 * event; binding and publishing fail closed after any newer generation.
 */
export class MerchantEnterpriseAuthGeneration {
  private generation = 0;
  private currentSessionToken = "";

  begin() {
    this.generation += 1;
    return this.generation;
  }

  bindSessionToken(generation: number, token: string) {
    if (generation !== this.generation) return false;
    this.currentSessionToken = token;
    return true;
  }

  isGenerationCurrent(generation: number, cancelled = false) {
    return !cancelled && generation === this.generation;
  }

  isCurrent(generation: number, token: string, cancelled = false) {
    return (
      this.isGenerationCurrent(generation, cancelled) &&
      this.currentSessionToken === token
    );
  }
}
