import type { SwapExplainer } from "@/lib/domain/types";
import { AnthropicExplainer, DEFAULT_MODEL } from "./anthropic";
import { TemplateExplainer } from "./template";

export { AnthropicExplainer, DEFAULT_MODEL } from "./anthropic";
export { TemplateExplainer, templateRationale, topEligible } from "./template";

/** LLM_PROVIDER=anthropic|template; defaults to anthropic when ANTHROPIC_API_KEY is set. */
export function getExplainer(): SwapExplainer {
  const key = process.env.ANTHROPIC_API_KEY;
  const provider = process.env.LLM_PROVIDER ?? (key ? "anthropic" : "template");
  if (provider === "anthropic" && key) return new AnthropicExplainer(key, process.env.LLM_MODEL || DEFAULT_MODEL);
  return new TemplateExplainer();
}
