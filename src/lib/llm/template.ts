// Deterministic explainer: picks the ranking's top eligible recipe and writes a plain rationale.
import type { Recipe, SwapExplainer } from "@/lib/domain/types";

type ExplainInput = Parameters<SwapExplainer["explain"]>[0];

/** Highest-ranked recipe that is in the eligible list; falls back to the first eligible one. */
export function topEligible(input: Pick<ExplainInput, "eligible" | "ranking">): Recipe | undefined {
  const byId = new Map(input.eligible.map((r) => [r.id, r]));
  const ranked = [...input.ranking.ranked].sort((a, b) => a.rank - b.rank).find((c) => byId.has(c.id));
  return ranked ? byId.get(ranked.id) : input.eligible[0];
}

export function templateRationale(input: ExplainInput, choice: Recipe): string {
  const prefs = input.preferenceFacts.map((f) => f.text.toLowerCase());
  const reasons: string[] = [];
  if (prefs.some((p) => p.includes("rice")) && choice.tags.includes("rice_bowl")) reasons.push("it matches the request for rice bowls");
  if (prefs.some((p) => p.includes("20 minutes")) && choice.prepMinutes <= 20) reasons.push(`it takes about ${choice.prepMinutes} minutes to prep`);
  const why = reasons.length ? `, because ${reasons.join(" and ")}` : "";
  return `${input.affectedDay}'s ${input.fromRecipe.name} can't be made this week, so we picked ${choice.name}${why}. It ranked first among the options that passed the safety checks.`;
}

export class TemplateExplainer implements SwapExplainer {
  async explain(input: ExplainInput): Promise<{ choiceId: string; rationale: string; provider: "template" }> {
    const choice = topEligible(input);
    if (!choice) {
      return { choiceId: "", rationale: `No safe alternative was found for ${input.affectedDay}'s lunch, so nothing was changed.`, provider: "template" };
    }
    return { choiceId: choice.id, rationale: templateRationale(input, choice), provider: "template" };
  }
}
