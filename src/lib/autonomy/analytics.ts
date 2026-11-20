// Statsig event logging over HTTPS. Best effort: never throws. Synthetic ids and numbers only.
import type { Analytics, AnalyticsEvent } from "@/lib/domain/types";

const LOG_EVENT_URL = "https://events.statsigapi.net/v1/log_event";
const TIMEOUT_MS = 3_000;

export interface RawEvent {
  eventName: string;
  value?: string | number;
  metadata: Record<string, string>;
}

export class StatsigAnalytics implements Analytics {
  constructor(private readonly serverSecret: string) {}

  log(userId: string, events: AnalyticsEvent[]): Promise<{ ok: boolean; error?: string }> {
    return this.logRaw(userId, events);
  }

  /** Same as log() but accepts any event name (used by the smoke script). */
  async logRaw(userId: string, events: RawEvent[]): Promise<{ ok: boolean; error?: string }> {
    if (!events.length) return { ok: true };
    const time = Date.now();
    try {
      const r = await fetch(LOG_EVENT_URL, {
        method: "POST",
        headers: { "statsig-api-key": this.serverSecret, "Content-Type": "application/json", "STATSIG-CLIENT-TIME": String(time) },
        body: JSON.stringify({
          events: events.map((e) => ({
            eventName: e.eventName,
            user: { userID: userId },
            ...(e.value !== undefined ? { value: e.value } : {}),
            metadata: e.metadata,
            time,
          })),
        }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      return r.ok ? { ok: true } : { ok: false, error: `statsig log_event HTTP ${r.status}` };
    } catch (e) {
      return { ok: false, error: `statsig log_event failed: ${e instanceof Error ? e.name : "error"}` };
    }
  }
}

/** No-op analytics for the offline KPI harness. */
export class NullAnalytics implements Analytics {
  async log(): Promise<{ ok: boolean; error?: string }> {
    return { ok: true };
  }
}

/** Used when STATSIG_SERVER_SECRET is missing: drops events and says why. */
export class DisabledAnalytics implements Analytics {
  constructor(private readonly reason: string) {}
  async log(): Promise<{ ok: boolean; error?: string }> {
    return { ok: false, error: this.reason };
  }
}
