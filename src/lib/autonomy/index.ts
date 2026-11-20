import type { Analytics, AutonomyProvider, AutonomyReading } from "@/lib/domain/types";
import { DisabledAnalytics, StatsigAnalytics } from "./analytics";
import { defaultReading, StatsigAutonomy } from "./statsig";

export { AUTONOMY_CONFIG, StaticAutonomy, StatsigAutonomy } from "./statsig";
export { DisabledAnalytics, NullAnalytics, StatsigAnalytics } from "./analytics";

/** Statsig when STATSIG_SERVER_SECRET is set, else a provider that always reads suggest_only. */
export function getAutonomy(): AutonomyProvider {
  const secret = process.env.STATSIG_SERVER_SECRET;
  if (secret) return new StatsigAutonomy(secret);
  return {
    read: async (): Promise<AutonomyReading> => defaultReading(new Date().toISOString(), "STATSIG_SERVER_SECRET not set"),
  };
}

export function getAnalytics(): Analytics {
  const secret = process.env.STATSIG_SERVER_SECRET;
  return secret ? new StatsigAnalytics(secret) : new DisabledAnalytics("STATSIG_SERVER_SECRET not set");
}
