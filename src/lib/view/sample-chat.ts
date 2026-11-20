// Sample replies for POST /api/chat and /api/chat/confirm, used only when the app runs on a static sample
// (`?state=…`). The real endpoints use Claude; this is a small keyword reader so the design can be driven offline.
import type { ProposedFact } from "@/lib/domain/view";

export interface ChatReply {
  ok: boolean;
  reply: string;
  facts: ProposedFact[];
  provider: "anthropic" | "rules";
}
export interface ConfirmReply {
  ok: boolean;
  saved: { label: string; memory: "cognee" | "fallback" }[];
  runId?: string;
  reason?: string;
}

const ALLERGENS: { re: RegExp; text: string; label: string }[] = [
  { re: /peanut/i, text: "peanuts", label: "Peanut allergy (avoid may-contain too)" },
  { re: /tree ?nut|almond|cashew|walnut/i, text: "tree nuts", label: "Tree nut allergy" },
  { re: /sesame/i, text: "sesame", label: "Sesame allergy" },
  { re: /milk|dairy|lactose/i, text: "milk", label: "Milk allergy" },
  { re: /gluten|wheat|celiac|coeliac/i, text: "gluten", label: "Gluten-free" },
  { re: /\beggs?\b/i, text: "eggs", label: "Egg allergy" },
  { re: /\bsoy/i, text: "soy", label: "Soy allergy" },
  { re: /shellfish|shrimp/i, text: "shellfish", label: "Shellfish allergy" },
];

const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

export function sampleChatReply(message: string, mode: "onboarding" | "assistant"): ChatReply {
  const facts: ProposedFact[] = [];
  const name = message.match(/\b([A-Z][a-z]+)\s+is\s+(\d{1,2})\b/);
  if (name) facts.push({ id: "child", kind: "child", label: `${name[1]}, ${name[2]}`, value: { name: name[1], age: Number(name[2]) } });
  for (const a of ALLERGENS) {
    if (a.re.test(message)) facts.push({ id: `allergy:${a.text}`, kind: "allergy", label: a.label, value: { text: a.text, crossContact: true } });
  }
  const dislike = message.match(/(?:hates|doesn'?t like|won'?t eat|no)\s+([a-z]+)/i);
  if (dislike && !ALLERGENS.some((a) => a.re.test(dislike[1]))) {
    facts.push({ id: `pref:${dislike[1].toLowerCase()}`, kind: "preference", label: `No ${dislike[1].toLowerCase()}`, value: { avoid: dislike[1].toLowerCase() } });
  }
  const budget = message.match(/\$\s?(\d{2,3})/);
  if (budget) facts.push({ id: "budget", kind: "budget", label: `$${budget[1]} a week`, value: { budgetCents: Number(budget[1]) * 100 } });
  const pickup = DAYS.find((d) => new RegExp(`pick ?up\\s+(on\\s+)?${d}|${d}\\s+pick ?up`, "i").test(message));
  if (pickup) facts.push({ id: "pickup", kind: "pickup", label: `Pickup ${pickup}`, value: { day: pickup } });
  const swap = message.match(/swap\s+(\w+day)\s+(?:to|for)\s+([a-z ]+)/i);
  if (swap) facts.push({ id: `plan:${swap[1].toLowerCase()}`, kind: "plan_change", label: `${swap[1]}: ${swap[2].trim()}`, value: { day: swap[1], to: swap[2].trim() } });

  const child = name?.[1] ?? "your child";
  let reply: string;
  if (!facts.length) {
    reply =
      mode === "onboarding"
        ? "Tell me your child's name and age, any allergies, foods they won't eat, a weekly budget and your pickup day."
        : "I can change a lunch, add an allergy or adjust the budget. What would you like?";
  } else if (mode === "onboarding") {
    reply = `Got it. Here's what I'll remember about ${child}. Check each one, then save it to memory.`;
  } else {
    reply = "Here's the change. Confirm it and I'll re-check the week.";
  }
  return { ok: true, reply, facts, provider: "rules" };
}

export function sampleConfirm(facts: ProposedFact[]): ConfirmReply {
  return { ok: true, saved: facts.map((f) => ({ label: f.label, memory: "cognee" })), runId: "run-sample" };
}
