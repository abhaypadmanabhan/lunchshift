// Labelled memory fallback: recalls the fixture household's confirmed facts locally.
// The worker still resolves every id against the authoritative household record.
import { HOUSEHOLD } from "@/lib/domain/fixture";
import type { Household, MemoryProvider, MemoryRecall } from "@/lib/domain/types";

/** The marker every fact line carries in the Cognee document, e.g. "[fact-allergy-peanut r3]". */
export const factMarker = (f: { id: string; revision: number }) => `[${f.id} r${f.revision}]`;

const MARKER_RE = /\[(fact-[a-z0-9-]+) r(\d+)\]/g;

/** Extract unique fact markers (id + revision) from retrieved text, first occurrence wins. */
export function extractFactMarkers(texts: string[]): { id: string; revision: number }[] {
  const seen = new Map<string, number>();
  for (const t of texts) {
    for (const m of t.matchAll(MARKER_RE)) {
      if (!seen.has(m[1])) seen.set(m[1], Number(m[2]));
    }
  }
  return [...seen].map(([id, revision]) => ({ id, revision }));
}

export class FallbackMemory implements MemoryProvider {
  constructor(
    private readonly reason: string,
    private readonly household: Household = HOUSEHOLD,
  ) {}

  async seed(): Promise<{ datasetId?: string; ok: boolean; error?: string }> {
    return { ok: false, error: `fallback memory: nothing seeded (${this.reason})` };
  }

  async recall(householdId: string, query: string): Promise<MemoryRecall> {
    return fallbackRecall(this.household, householdId, query, this.reason);
  }
}

export function fallbackRecall(household: Household, householdId: string, query: string, reason: string): MemoryRecall {
  const facts = household.id === householdId ? household.facts.filter((f) => f.active) : [];
  return {
    provider: "fallback",
    query,
    factIds: facts.map((f) => f.id),
    snippets: facts.map((f) => `${factMarker(f)} ${f.text}`),
    error: facts.length ? reason : `${reason}; no local facts for household ${householdId}`,
  };
}
