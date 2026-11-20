// Demo operator actions (fixture and gate controls). Never counted as shopper clicks; each is audited as actor "operator".
import { activeCatalog } from "../lib/domain/catalog";
import { HOUSEHOLD } from "../lib/domain/fixture";
import { activeHousehold, ensureSeeded, grocerOperator, runIdNow } from "./deps";
import { currentWeekOf, PRESETS, writePointer } from "../lib/domain/families";

export type OperatorAction = "reset" | "stockout" | "drop" | "run";

export async function operatorAction(action: OperatorAction): Promise<{ ok: true; detail: string }> {
  const store = await ensureSeeded();
  const op = grocerOperator();
  const DEMO_RUN_ID = await runIdNow(store);
  const note = async (summary: string) => {
    if (await store.getRun(DEMO_RUN_ID)) {
      await store.appendEvent({ runId: DEMO_RUN_ID, actor: "operator", type: "note", summary: `Demo operator: ${summary}`, data: { action } });
    }
  };
  switch (action) {
    case "reset":
      await store.reset();
      for (const p of PRESETS) await store.saveHousehold(p); // back to the preset families (Maya: peanut, revision 3)
      writePointer({ householdId: HOUSEHOLD.id, weekIndex: 0, newFamilies: 0 }); // hides families made during the demo
      await op.reset();
      return { ok: true, detail: "Store and app state reset to the clean fixture" };
    case "stockout":
      await op.setStock(activeCatalog().stockoutSku, 0);
      await note("usual bread set to 0 stock at the sandbox store");
      return { ok: true, detail: "Usual bread sold out at the store; the worker sees the stockout event on its next tick" };
    case "drop":
      await op.dropNextHoldResponse(true);
      await note("store will commit the next hold and drop its response");
      return { ok: true, detail: "Next hold response will be dropped after commit" };
    case "run": {
      const now = new Date().toISOString();
      if (!(await store.getRun(DEMO_RUN_ID))) {
        await store.upsertRun({
          id: DEMO_RUN_ID,
          householdId: (await activeHousehold(store)).id,
          weekOf: currentWeekOf(),
          trigger: "schedule",
          status: "scheduled",
          observedMode: "suggest_only",
          effectiveMode: "suggest_only",
          basketVersion: 0,
          createdAt: now,
          updatedAt: now,
        });
      }
      return { ok: true, detail: "Sunday run marked due; the worker picks it up on its next tick" };
    }
  }
}

if (process.argv[1]?.endsWith("operator.ts")) {
  const a = process.argv[2] as OperatorAction;
  operatorAction(a).then(
    (r) => {
      console.log(r.detail);
      process.exit(0);
    },
    (e) => {
      console.error(e instanceof Error ? e.message : String(e));
      process.exit(1);
    },
  );
}
