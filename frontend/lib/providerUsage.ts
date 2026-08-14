export type ProviderUsageKind = "cartesia" | "assembly-inworld";

export interface ProviderUsageDelta {
  requestId: string;
  sttSeconds?: number;
  ttsCharacters?: number;
  assemblySessionSeconds?: number;
  inworldTtsCharacters?: number;
}

/**
 * The server scopes provider request IDs to a Coach session. Keeping the ID
 * stable for a frozen delta makes an ambiguous network retry idempotent.
 */
export function createProviderUsageDelta(
  provider: ProviderUsageKind,
  sequence: number,
  quantities: Omit<ProviderUsageDelta, "requestId">,
): ProviderUsageDelta {
  return {
    ...quantities,
    requestId: `${provider}-usage-${sequence}`,
  };
}
