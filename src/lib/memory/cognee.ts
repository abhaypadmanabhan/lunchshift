// Cognee Cloud memory over REST. Server-side only: reads COGNEE_API_KEY / COGNEE_BASE_URL.
// Facts are stored with stable markers; recall returns the ids, the worker resolves them
// against the authoritative household record. Never throws: failures fall back with `error`.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { HOUSEHOLD } from "@/lib/domain/fixture";
import type { Household, MemoryProvider, MemoryRecall } from "@/lib/domain/types";
import { extractFactMarkers, factMarker, fallbackRecall } from "./fallback";

const SEARCH_TIMEOUT_MS = 20_000;
const WRITE_TIMEOUT_MS = 30_000;
const COGNIFY_MAX_WAIT_MS = 180_000;
const COGNIFY_POLL_MS = 4_000;
const STATE_FILE = path.join(process.cwd(), ".data", "cognee.json");

export const datasetNameFor = (householdId: string) => `${householdId}-household`;

type Json = unknown;
interface CogneeState {
  [datasetName: string]: { datasetId: string; policyRevision: number; seededAt: string; cognify: string };
}

export interface CogneeSearchTiming {
  searchType: string;
  ms: number;
  ok: boolean;
}

export class CogneeMemory implements MemoryProvider {
  /** Timings of the last recall, for the smoke script and audit data. */
  lastTimings: CogneeSearchTiming[] = [];

  constructor(
    private readonly baseUrl: string,
    private readonly apiKey: string,
    private readonly fallbackHousehold: Household = HOUSEHOLD,
  ) {}

  async seed(household: Household): Promise<{ datasetId?: string; ok: boolean; error?: string }> {
    const datasetName = datasetNameFor(household.id);
    try {
      const form = new FormData();
      form.append("datasetName", datasetName);
      form.append("data", new Blob([householdDocument(household)], { type: "text/plain" }), `${household.id}-r${household.policyRevision}.txt`);
      const added = await this.call("POST", "/api/v1/add", form, WRITE_TIMEOUT_MS);
      if (!added.ok) return { ok: false, error: `cognee add failed: ${added.error}` };

      const datasetId = findString(added.body, ["dataset_id", "datasetId"]) ?? (await this.lookupDatasetId(datasetName));
      if (!datasetId) return { ok: false, error: "cognee add returned no dataset id" };

      const cog = await this.call("POST", "/api/v1/cognify", { datasetIds: [datasetId], runInBackground: true }, WRITE_TIMEOUT_MS);
      if (!cog.ok) {
        await this.saveState(datasetName, { datasetId, policyRevision: household.policyRevision, seededAt: new Date().toISOString(), cognify: "not_started" });
        return { datasetId, ok: false, error: `cognee cognify failed: ${cog.error}` };
      }

      const status = await this.waitForCognify(datasetId);
      await this.saveState(datasetName, { datasetId, policyRevision: household.policyRevision, seededAt: new Date().toISOString(), cognify: status });
      if (status !== "DATASET_PROCESSING_COMPLETED") {
        return { datasetId, ok: false, error: `cognify not completed within ${COGNIFY_MAX_WAIT_MS / 1000}s (last status ${status})` };
      }
      return { datasetId, ok: true };
    } catch (e) {
      return { ok: false, error: `cognee seed error: ${errText(e)}` };
    }
  }

  async recall(householdId: string, query: string): Promise<MemoryRecall> {
    this.lastTimings = [];
    try {
      const datasetName = datasetNameFor(householdId);
      const datasetId = (await this.loadState())[datasetName]?.datasetId ?? (await this.lookupDatasetId(datasetName));
      if (!datasetId) return fallbackRecall(this.fallbackHousehold, householdId, query, `cognee dataset ${datasetName} not found; run seed`);

      // Graph context connects member -> rule; the chunk read returns the exact stored markers.
      const [graph, chunks] = await Promise.all([
        this.search(datasetId, "GRAPH_COMPLETION", query, {
          systemPrompt:
            "Answer using only the provided context, briefly. Quote every bracketed fact marker you rely on exactly as written, e.g. [fact-x r1].",
        }),
        this.search(datasetId, "CHUNKS", query, { topK: 5 }),
      ]);

      const graphTexts = graph.ok ? collectText(graph.body) : [];
      const chunkTexts = chunks.ok ? collectText(chunks.body) : [];
      const snippets = [...graphTexts, ...chunkTexts].map((s) => s.trim()).filter(Boolean);
      const markers = extractFactMarkers(snippets);
      const errors = [graph.ok ? "" : `GRAPH_COMPLETION: ${graph.error}`, chunks.ok ? "" : `CHUNKS: ${chunks.error}`].filter(Boolean);

      if (!graph.ok && !chunks.ok) {
        return fallbackRecall(this.fallbackHousehold, householdId, query, `cognee search failed (${errors.join("; ")})`);
      }
      return {
        provider: "cognee",
        datasetId,
        query,
        factIds: markers.map((m) => m.id),
        snippets,
        ...(errors.length ? { error: errors.join("; ") } : markers.length ? {} : { error: "cognee returned no fact markers" }),
      };
    } catch (e) {
      return fallbackRecall(this.fallbackHousehold, householdId, query, `cognee recall error: ${errText(e)}`);
    }
  }

  private async search(datasetId: string, searchType: string, query: string, extra: Record<string, Json>) {
    const t0 = Date.now();
    const res = await this.call("POST", "/api/v1/search", { searchType, query, datasetIds: [datasetId], ...extra }, SEARCH_TIMEOUT_MS);
    this.lastTimings.push({ searchType, ms: Date.now() - t0, ok: res.ok });
    return res;
  }

  private async waitForCognify(datasetId: string): Promise<string> {
    const deadline = Date.now() + COGNIFY_MAX_WAIT_MS;
    let status = "unknown";
    while (Date.now() < deadline) {
      const res = await this.call("GET", `/api/v1/datasets/status?dataset=${encodeURIComponent(datasetId)}`, undefined, 10_000);
      if (res.ok) {
        const found = findString(res.body, ["status"]) ?? (typeof res.body === "object" && res.body ? findStatusValue(res.body) : undefined);
        if (found) status = found;
        if (status === "DATASET_PROCESSING_COMPLETED" || status === "DATASET_PROCESSING_ERRORED") return status;
      }
      await new Promise((r) => setTimeout(r, COGNIFY_POLL_MS));
    }
    return status;
  }

  private async lookupDatasetId(name: string): Promise<string | undefined> {
    const res = await this.call("GET", "/api/v1/datasets/", undefined, 10_000);
    if (!res.ok || !Array.isArray(res.body)) return undefined;
    const match = (res.body as { id?: string; name?: string }[]).find((d) => d.name === name);
    return match?.id;
  }

  private async call(method: "GET" | "POST", route: string, body: FormData | Record<string, Json> | undefined, timeoutMs: number) {
    const headers: Record<string, string> = { "X-Api-Key": this.apiKey, Accept: "application/json" };
    if (body && !(body instanceof FormData)) headers["Content-Type"] = "application/json";
    try {
      const r = await fetch(`${this.baseUrl}${route}`, {
        method,
        headers,
        body: body instanceof FormData ? body : body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!r.ok) {
        const hint = r.status === 402 ? " (payment required: stop, free tier exhausted)" : "";
        return { ok: false as const, error: `HTTP ${r.status}${hint}` };
      }
      const text = await r.text();
      return { ok: true as const, body: text ? (JSON.parse(text) as Json) : null };
    } catch (e) {
      return { ok: false as const, error: errText(e) };
    }
  }

  private async loadState(): Promise<CogneeState> {
    try {
      return JSON.parse(await readFile(STATE_FILE, "utf8")) as CogneeState;
    } catch {
      return {};
    }
  }

  private async saveState(datasetName: string, entry: CogneeState[string]) {
    try {
      const state = await this.loadState();
      state[datasetName] = entry;
      await mkdir(path.dirname(STATE_FILE), { recursive: true });
      await writeFile(STATE_FILE, JSON.stringify(state, null, 2));
    } catch {
      // best effort: recall falls back to a dataset lookup by name
    }
  }
}

/** The text document seeded into Cognee: one active fact per line, each with its stable marker. */
export function householdDocument(h: Household): string {
  const kindLabel = { hard_restriction: "hard restriction", preference: "preference", member: "household member" } as const;
  const lines = h.facts
    .filter((f) => f.active)
    .map((f) => `${factMarker(f)} (${kindLabel[f.kind]}, confirmed by ${f.confirmedBy} on ${f.confirmedAt}) ${f.text}`);
  return [
    `LunchShift household memory for household ${h.id}, policy revision ${h.policyRevision}.`,
    "Each fact line starts with a stable marker [fact-id rN]; cite markers exactly as written.",
    "",
    ...lines,
    "",
  ].join("\n");
}

/** Collect human-readable text from a Cognee search response of unknown nesting. */
function collectText(x: Json): string[] {
  if (typeof x === "string") return [x];
  if (Array.isArray(x)) return x.flatMap(collectText);
  if (x && typeof x === "object") {
    const o = x as Record<string, Json>;
    for (const k of ["text", "search_result", "answer", "content", "completion", "context"]) {
      if (k in o) {
        const got = collectText(o[k]);
        if (got.length) return got;
      }
    }
  }
  return [];
}

function findString(x: Json, keys: string[]): string | undefined {
  if (Array.isArray(x)) {
    for (const v of x) {
      const f = findString(v, keys);
      if (f) return f;
    }
  } else if (x && typeof x === "object") {
    const o = x as Record<string, Json>;
    for (const k of keys) if (typeof o[k] === "string") return o[k] as string;
    for (const v of Object.values(o)) {
      const f = findString(v, keys);
      if (f) return f;
    }
  }
  return undefined;
}

/** datasets/status may return {datasetId: "STATUS"} or {datasetId: {pipeline: "STATUS"}}. */
function findStatusValue(x: object): string | undefined {
  for (const v of Object.values(x)) {
    if (typeof v === "string" && v.startsWith("DATASET_PROCESSING_")) return v;
    if (v && typeof v === "object") {
      const f = findStatusValue(v);
      if (f) return f;
    }
  }
  return undefined;
}

const errText = (e: unknown) => e instanceof Error && e.name === "TimeoutError" ? "request timed out" : "request failed";
