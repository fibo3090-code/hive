/**
 * Coarse pre-session cost / token estimate, shared by Onboarding,
 * AgentSpawnModal, and CostForecastModal so all three surfaces
 * agree. Real costs come from the backend's cost_events stream;
 * these numbers exist purely to set expectations before a session
 * starts.
 *
 * The factor mirrors the original Onboarding formula: cloud is
 * the most expensive (paid providers), hybrid the default, local
 * the cheapest (Ollama). The token estimate scales with agent
 * count because more agents → more parallel work in a session.
 */
export type SovereigntyTier = 'local' | 'hybrid' | 'cloud';

export function tierFactor(tier: SovereigntyTier): number {
  switch (tier) {
    case 'local':
      return 0.6;
    case 'hybrid':
      return 1.0;
    case 'cloud':
      return 1.4;
  }
}

export function estimateAgentCost(
  agentCount: number,
  tier: SovereigntyTier,
): { usdPerHour: number; tokensPerHour: number } {
  const factor = tierFactor(tier);
  // Empirical baseline: ~$8.50 per agent-hour, ~25k tokens per
  // agent-hour at the hybrid tier.
  const usdPerHour = +(agentCount * 8.5 * factor).toFixed(2);
  const tokensPerHour = Math.round(agentCount * 25_000 * factor);
  return { usdPerHour, tokensPerHour };
}
