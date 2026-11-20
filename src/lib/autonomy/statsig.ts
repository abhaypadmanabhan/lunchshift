// Statsig Dynamic Config read over HTTPS. Server-side only: reads STATSIG_SERVER_SECRET.
// Anything missing, invalid, slow or failing resolves to suggest_only with source "default".
import { isAutonomyMode, type AutonomyMode, type AutonomyProvider, type AutonomyReading } from "@/lib/domain/types";

export const AUTONOMY_CONFIG = "autonomy_mode";
const GET_CONFIG_URL = "https://api.statsig.com/v1/get_config";
const TIMEOUT_MS = 3_000;

export class StatsigAutonomy implements AutonomyProvider {
  constructor(private readonly serverSecret: string) {}

  async read(userId: string): Promise<AutonomyReading> {
    const fetchedAt = new Date().toISOString();
    try {
      const r = await fetch(GET_CONFIG_URL, {
        method: "POST",
        headers: { "statsig-api-key": this.serverSecret, "Content-Type": "application/json" },
        body: JSON.stringify({ configName: AUTONOMY_CONFIG, user: { userID: userId } }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!r.ok) return defaultReading(fetchedAt, `statsig get_config HTTP ${r.status}`);
      const body = (await r.json()) as { value?: { mode?: unknown }; rule_id?: unknown };
      const ruleId = typeof body.rule_id === "string" && body.rule_id ? body.rule_id : undefined;
      const mode = body.value?.mode;
      if (!isAutonomyMode(mode)) {
        const why = mode === undefined ? `config ${AUTONOMY_CONFIG} missing or has no value.mode` : `invalid mode ${JSON.stringify(mode)}`;
        return { ...defaultReading(fetchedAt, why), ...(ruleId ? { ruleId } : {}) };
      }
      return { mode, source: "statsig", ruleId, fetchedAt };
    } catch (e) {
      return defaultReading(fetchedAt, `statsig get_config failed: ${e instanceof Error ? e.name : "error"}`);
    }
  }
}

/** Fixed mode for the offline KPI harness and tests. */
export class StaticAutonomy implements AutonomyProvider {
  constructor(private readonly mode: AutonomyMode) {}
  async read(): Promise<AutonomyReading> {
    return { mode: this.mode, source: "default", ruleId: "static", fetchedAt: new Date().toISOString() };
  }
}

export function defaultReading(fetchedAt: string, error: string): AutonomyReading {
  return { mode: "suggest_only", source: "default", fetchedAt, error };
}
