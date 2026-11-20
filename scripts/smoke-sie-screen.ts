// npm run smoke:sie-screen - live SIE allergen screen over the fixture catalog for a few households. Prints flags only.
import { CATALOG, HOUSEHOLD } from "../src/lib/domain/fixture";
import { applyHouseholdUpdate } from "../src/lib/domain/household";
import { hardRestrictions } from "../src/lib/domain/rules";
import { getAllergenScreen } from "../src/lib/allergen";

async function main() {
  const screen = getAllergenScreen();
  for (const allergies of [["peanuts"], ["peanuts", "sesame"], ["dairy"]]) {
    const { household } = applyHouseholdUpdate(HOUSEHOLD, { allergies: allergies.map((text) => ({ text, crossContact: true })) });
    const r = await screen.screen(CATALOG.map((s) => ({ id: s.id, text: s.label.sourceText })), hardRestrictions(household));
    const flagged = [...r.values()].filter((x) => x.risk).map((x) => `${x.skuId} ${x.score.toFixed(2)}`);
    const near = [...r.values()].filter((x) => !x.risk && x.label.startsWith("contains") && !x.label.includes("other") || (!x.risk && x.label.startsWith("may"))).map((x) => `${x.skuId} ${x.label} ${x.score.toFixed(2)}`);
    console.log(`${allergies.join("+").padEnd(16)} flagged: ${flagged.join(", ") || "none"}`);
    if (near.length) console.log(`${"".padEnd(16)} below threshold: ${near.join("; ")}`);
  }
}
main();
