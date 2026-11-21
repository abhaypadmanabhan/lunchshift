import type { MemoryProvider } from "@/lib/domain/types";
import { CogneeMemory } from "./cognee";
import { FallbackMemory } from "./fallback";

export { CogneeMemory, datasetNameFor, householdDocument } from "./cognee";
export { COGNEE_BUILDING, isMemoryBuilding } from "./status";
export { FallbackMemory, extractFactMarkers, factMarker } from "./fallback";

/** Cognee when COGNEE_API_KEY and COGNEE_BASE_URL are set, else the labelled fallback. */
export function getMemory(): MemoryProvider {
  const key = process.env.COGNEE_API_KEY;
  const base = process.env.COGNEE_BASE_URL?.replace(/\/+$/, "");
  if (key && base) return new CogneeMemory(base, key);
  return new FallbackMemory("COGNEE_API_KEY or COGNEE_BASE_URL not set");
}
