// Claude explainer. The model sees only ELIGIBLE recipes, their ranking scores and the
// parent's preference facts. It never sees allergen rules or refusals and cannot widen the list:
// code validates choiceId against the eligible ids and falls back to the ranking top.
import Anthropic from "@anthropic-ai/sdk";
import type { SwapExplainer } from "@/lib/domain/types";
import { TemplateExplainer, topEligible } from "./template";

type ExplainInput = Parameters<SwapExplainer["explain"]>[0];
type ExplainOutput = Awaited<ReturnType<SwapExplainer["explain"]>>;

export const DEFAULT_MODEL = "claude-sonnet-5-5";
const TIMEOUT_MS = 10_000;

const SYSTEM = [
  "You help a parent's grocery assistant pick a replacement school lunch.",
  "Every option you are given has already passed the household's safety, stock and budget checks.",
  "Choose exactly one option id from the list. Weigh the ranking score and the parent's preferences.",
  "Write a rationale for the parent: at most two short, plain sentences, no jargon, no scores, no safety claims.",
].join(" ");

export class AnthropicExplainer implements SwapExplainer {
  /** Why the last call fell back to the template, if it did. */
  lastError?: string;
  private readonly client: Anthropic;

  constructor(
    apiKey: string,
    private readonly model: string = DEFAULT_MODEL,
    private readonly fallback: SwapExplainer = new TemplateExplainer(),
  ) {
    this.client = new Anthropic({ apiKey, timeout: TIMEOUT_MS, maxRetries: 0 });
  }

  async explain(input: ExplainInput): Promise<ExplainOutput> {
    this.lastError = undefined;
    if (!input.eligible.length) return this.fallback.explain(input);
    try {
      const scores = new Map(input.ranking.ranked.map((c) => [c.id, c]));
      const options = input.eligible.map((r) => ({
        id: r.id,
        name: r.name,
        prepMinutes: r.prepMinutes,
        tags: r.tags,
        description: r.description,
        rankingScore: scores.get(r.id)?.score ?? null,
        rank: scores.get(r.id)?.rank ?? null,
      }));
      const prompt = JSON.stringify({
        day: input.affectedDay,
        brokenLunch: input.fromRecipe.name,
        parentPreferences: input.preferenceFacts.filter((f) => f.kind === "preference" && f.active).map((f) => f.text),
        options,
      });

      const msg = await this.client.messages.create({
        model: this.model,
        max_tokens: 400,
        system: SYSTEM,
        messages: [{ role: "user", content: prompt }],
        output_config: {
          effort: "low",
          format: {
            type: "json_schema",
            schema: {
              type: "object",
              properties: {
                choiceId: { type: "string", enum: options.map((o) => o.id) },
                rationale: { type: "string" },
              },
              required: ["choiceId", "rationale"],
              additionalProperties: false,
            },
          },
        },
      });

      const text = msg.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
      const parsed = JSON.parse(text) as { choiceId?: unknown; rationale?: unknown };
      const eligibleIds = new Set(input.eligible.map((r) => r.id));
      const rationale = typeof parsed.rationale === "string" ? clampSentences(parsed.rationale, 2) : "";
      if (typeof parsed.choiceId !== "string" || !eligibleIds.has(parsed.choiceId) || !rationale) {
        // Never trust an out-of-list choice: use the ranking top with the template rationale.
        this.lastError = `model returned invalid choice ${JSON.stringify(parsed.choiceId)}`;
        return this.fallback.explain(input);
      }
      return { choiceId: parsed.choiceId, rationale, provider: "anthropic" };
    } catch (e) {
      this.lastError = e instanceof Error ? `${e.name}: ${e.message.slice(0, 200)}` : String(e);
      return this.fallback.explain(input);
    }
  }
}

function clampSentences(text: string, max: number): string {
  const parts = text.trim().match(/[^.!?]+[.!?]+(\s|$)|[^.!?]+$/g) ?? [text.trim()];
  return parts.slice(0, max).join("").trim();
}

export { topEligible };
