// npm run test:chat - the no-Claude fallback must turn every stated setup fact into a chip (the /demo sentence first).
import { parseWithRules, toFacts } from "../src/lib/llm/chat";

const cases: { say: string; want: string[] }[] = [
  {
    say: "Maya is 8, peanut allergy, hates mushrooms, $35 a week, pickup Sunday",
    want: ["Maya, 8", "Peanuts allergy · avoid may-contain", "Maya dislikes mushrooms", "$35 a week", "Pickup Sunday"],
  },
  { say: "Leo is 6, dislikes tomatoes and pick up on Saturday, $40", want: ["Leo, 6", "Leo dislikes tomatoes", "Pickup Saturday", "$40 a week"] },
];

let failures = 0;
for (const c of cases) {
  const labels = toFacts(parseWithRules(c.say)).map((f) => f.label);
  const missing = c.want.filter((w) => !labels.includes(w));
  console.log(`${missing.length ? "FAIL" : "PASS"}  ${c.say}\n      chips: ${labels.join(" | ")}${missing.length ? `\n      missing: ${missing.join(" | ")}` : ""}`);
  if (missing.length) failures++;
}
console.log(failures ? `${failures} FAILURE(S)` : "ALL PASS");
process.exit(failures ? 1 : 0);
